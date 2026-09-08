import { randomUUID } from "node:crypto";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { bookingCreateSchema, bookingConfirmSchema, detailSearchSchema, hotelAvailabilitySchema, propertySchema, rateDetailSchema, roomAvailabilitySchema, roomSearchSchema, searchRequestSchema } from "./contracts.js";
import type { BookingService } from "./bookings/service.js";
import { AppError, errorHandler, notFound } from "./errors.js";
import type { AuthService, BedbankService, Profile } from "./services.js";

declare global {
  namespace Express { interface Request { profile?: Profile; accessToken?: string } }
}

type Dependencies = {
  auth: AuthService;
  bedbank: BedbankService;
  bookings?: BookingService;
  production?: boolean;
  publicDir?: string;
  readiness?: () => Promise<void>;
  readinessCacheMs?: number;
  trustProxyHops?: number;
  rateLimitMaxKeys?: number;
};
const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
const newUserSchema = z.object({ email: z.string().email(), displayName: z.string().trim().min(1).max(120), role: z.enum(["admin", "staff"]), temporaryPassword: z.string().min(12).max(200) });
const updateUserSchema = z.object({ displayName: z.string().trim().min(1).max(120).optional(), role: z.enum(["admin", "staff"]).optional(), status: z.enum(["active", "disabled"]).optional() });
const resetSchema = z.object({ temporaryPassword: z.string().min(12).max(200) });

const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);

const routeId = (request: Request) => String(request.params.id);

// Hợp đồng đầu ra chỉ có giá trị khi được kiểm tra. Không kiểm tra thì upstream đổi shape sẽ lọt
// thẳng xuống trình duyệt — đã xảy ra thật: `get-room-availability` trả GUID toàn số 0 nên mọi
// hạng phòng trùng ID và màn hình chi tiết giá nhận 400. Chặn tại biên và trả 503 thay vì để FE
// render dữ liệu không dùng được.
function contracted<T>(schema: z.ZodType<T>, value: unknown, request: Request): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.error(JSON.stringify({
    level: "error",
    message: "Phản hồi CloudHMS không khớp hợp đồng",
    path: request.path,
    requestId: request.header("x-request-id"),
    issues: parsed.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join("."), code: issue.code })),
  }));
  throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Dữ liệu từ CloudHMS không dùng được");
}

function setSessionCookies(response: Response, session: { accessToken: string; refreshToken: string; expiresIn: number }, production: boolean) {
  const common = { httpOnly: true, secure: production, sameSite: "strict" as const, path: "/" };
  response.cookie("nt_access", session.accessToken, { ...common, maxAge: session.expiresIn * 1000 });
  response.cookie("nt_refresh", session.refreshToken, { ...common, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

function rateLimit(limit: number, windowMs: number, maxKeys: number) {
  const attempts = new Map<string, number[]>();
  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const key = request.ip ?? "unknown";
    if (!attempts.has(key) && attempts.size >= maxKeys) {
      for (const [storedKey, timestamps] of attempts) {
        if (timestamps.every((timestamp) => timestamp <= now - windowMs)) attempts.delete(storedKey);
      }
      while (attempts.size >= maxKeys) {
        const oldest = attempts.keys().next().value as string | undefined;
        if (!oldest) break;
        attempts.delete(oldest);
      }
    }
    const recent = (attempts.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
    if (recent.length >= limit) {
      response.status(429).json({ error: { code: "UPSTREAM_RATE_LIMITED", message: "Thao tác quá thường xuyên, vui lòng thử lại sau" } });
      return;
    }
    recent.push(now);
    attempts.delete(key);
    attempts.set(key, recent);
    next();
  };
}

export function createApp({
  auth,
  bedbank,
  bookings,
  production = false,
  publicDir,
  readiness = async () => undefined,
  readinessCacheMs = 10_000,
  trustProxyHops = 0,
  rateLimitMaxKeys = 10_000,
}: Dependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxyHops);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
    strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  }));
  // Gắn request id trước khi parse body: lỗi body hỏng/quá lớn cũng phải truy vết được.
  app.use((request, response, next) => {
    const id = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", id);
    if (request.path.startsWith("/api/")) response.setHeader("cache-control", "private, no-store");
    if (request.path.startsWith("/health/")) response.setHeader("cache-control", "no-store");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  let readinessState: { ready: boolean; expiresAt: number } | undefined;
  let readinessPromise: Promise<boolean> | undefined;
  const isReady = async () => {
    const now = Date.now();
    if (readinessState && readinessState.expiresAt > now) return readinessState.ready;
    readinessPromise ??= readiness().then(() => true, () => false).then((ready) => {
      readinessState = { ready, expiresAt: Date.now() + readinessCacheMs };
      return ready;
    }).finally(() => { readinessPromise = undefined; });
    return readinessPromise;
  };
  app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
  app.get("/health/ready", asyncRoute(async (_request, response) => {
    if (await isReady()) {
      response.json({ status: "ready" });
      return;
    }
    response.status(503).json({ status: "not_ready" });
  }));

  const requireAuth = asyncRoute(async (request, response, next) => {
    const token = request.cookies.nt_access as string | undefined;
    const refreshToken = request.cookies.nt_refresh as string | undefined;
    if (!token && !refreshToken) throw new AppError(401, "AUTH_REQUIRED", "Vui lòng đăng nhập");
    let profile: Profile;
    try {
      if (!token) throw new AppError(401, "AUTH_REQUIRED", "Phiên đăng nhập đã hết hạn");
      profile = await auth.authenticate(token);
      request.accessToken = token;
    } catch (error) {
      if (!refreshToken || !(error instanceof AppError) || error.status !== 401) throw error;
      const session = await auth.refresh(refreshToken);
      setSessionCookies(response, session, production);
      profile = session.profile;
      request.accessToken = session.accessToken;
    }
    if (profile.status !== "active") throw new AppError(403, "FORBIDDEN", "Tài khoản đã bị khóa");
    request.profile = profile;
    next();
  });
  const requireReady = (request: Request, _response: Response, next: NextFunction) => {
    if (request.profile?.mustChangePassword) return next(new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Bạn phải đổi mật khẩu trước khi tiếp tục"));
    next();
  };
  const requireAdmin = (request: Request, _response: Response, next: NextFunction) => {
    if (request.profile?.role !== "admin") return next(new AppError(403, "FORBIDDEN", "Chỉ Admin được thực hiện thao tác này"));
    next();
  };

  app.post("/api/auth/login", rateLimit(8, 15 * 60_000, rateLimitMaxKeys), asyncRoute(async (request, response) => {
    const input = credentialsSchema.parse(request.body);
    const session = await auth.login(input.email, input.password);
    setSessionCookies(response, session, production);
    response.json({ data: { profile: session.profile } });
  }));
  app.get("/api/me", requireAuth, (request, response) => response.json({ data: { profile: request.profile } }));
  app.post("/api/auth/change-password", requireAuth, asyncRoute(async (request, response) => {
    const { password } = z.object({ password: z.string().min(12).max(200) }).parse(request.body);
    await auth.changePassword(request.profile!, password);
    response.status(204).end();
  }));
  app.post("/api/auth/logout", requireAuth, asyncRoute(async (request, response) => {
    await auth.logout(request.accessToken ?? "");
    response.clearCookie("nt_access", { path: "/" });
    response.clearCookie("nt_refresh", { path: "/" });
    response.status(204).end();
  }));

  app.get("/api/admin/users", requireAuth, requireReady, requireAdmin, asyncRoute(async (_request, response) => response.json({ data: await auth.listUsers() })));
  app.post("/api/admin/users", requireAuth, requireReady, requireAdmin, asyncRoute(async (request, response) => response.status(201).json({ data: await auth.createUser(request.profile!, newUserSchema.parse(request.body)) })));
  app.patch("/api/admin/users/:id", requireAuth, requireReady, requireAdmin, asyncRoute(async (request, response) => response.json({ data: await auth.updateUser(request.profile!, routeId(request), updateUserSchema.parse(request.body)) })));
  app.post("/api/admin/users/:id/reset-password", rateLimit(10, 15 * 60_000, rateLimitMaxKeys), requireAuth, requireReady, requireAdmin, asyncRoute(async (request, response) => {
    const input = resetSchema.parse(request.body);
    await auth.resetPassword(request.profile!, routeId(request), input.temporaryPassword);
    response.status(204).end();
  }));

  app.get("/api/properties", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: contracted(z.array(propertySchema), await bedbank.properties(String(request.query.query ?? "")), request) })));
  app.post("/api/availability/hotels", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: contracted(z.array(hotelAvailabilitySchema), await bedbank.hotels(searchRequestSchema.parse(request.body)), request) })));
  app.post("/api/availability/rooms", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: contracted(z.array(roomAvailabilitySchema), await bedbank.rooms(roomSearchSchema.parse(request.body)), request) })));
  app.post("/api/availability/detail", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: contracted(rateDetailSchema, await bedbank.detail(detailSearchSchema.parse(request.body)), request) })));

  const bookingService = () => {
    if (!bookings) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Dịch vụ đặt phòng chưa được cấu hình");
    return bookings;
  };
  app.get("/api/bookings", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: await bookingService().list(request.profile!) })));
  app.post("/api/bookings", requireAuth, requireReady, rateLimit(20, 60_000, rateLimitMaxKeys), asyncRoute(async (request, response) => {
    const input = bookingCreateSchema.parse(request.body);
    response.status(201).json({ data: await bookingService().create(request.profile!, input) });
  }));
  app.get("/api/bookings/:id", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: await bookingService().get(request.profile!, z.uuid().parse(routeId(request))) })));
  app.get("/api/bookings/:id/guarantees", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: await bookingService().guarantees(request.profile!, z.uuid().parse(routeId(request))) })));
  app.post("/api/bookings/:id/confirm", requireAuth, requireReady, rateLimit(20, 60_000, rateLimitMaxKeys), asyncRoute(async (request, response) => {
    const input = bookingConfirmSchema.parse(request.body);
    response.json({ data: await bookingService().confirm(request.profile!, z.uuid().parse(routeId(request)), input.guaranteeVersion) });
  }));

  if (publicDir) {
    app.use(express.static(publicDir, {
      index: false,
      fallthrough: true,
      setHeaders: (response, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          response.setHeader("cache-control", "public, max-age=31536000, immutable");
        }
      },
    }));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api/")) {
        response.setHeader("cache-control", "no-cache");
        response.sendFile(path.join(publicDir, "index.html"));
        return;
      }
      next();
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
