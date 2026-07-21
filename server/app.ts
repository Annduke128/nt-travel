import { randomUUID } from "node:crypto";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { detailSearchSchema, roomSearchSchema, searchRequestSchema } from "./contracts.js";
import { AppError, errorHandler, notFound } from "./errors.js";
import type { AuthService, BedbankService, Profile } from "./services.js";

declare global {
  namespace Express { interface Request { profile?: Profile } }
}

type Dependencies = { auth: AuthService; bedbank: BedbankService; production?: boolean; publicDir?: string };
const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
const newUserSchema = z.object({ email: z.string().email(), displayName: z.string().trim().min(1).max(120), role: z.enum(["admin", "staff"]), temporaryPassword: z.string().min(12).max(200) });
const updateUserSchema = z.object({ displayName: z.string().trim().min(1).max(120).optional(), role: z.enum(["admin", "staff"]).optional(), status: z.enum(["active", "disabled"]).optional() });
const resetSchema = z.object({ temporaryPassword: z.string().min(12).max(200) });

const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);

const routeId = (request: Request) => String(request.params.id);

function setSessionCookies(response: Response, session: { accessToken: string; refreshToken: string; expiresIn: number }, production: boolean) {
  const common = { httpOnly: true, secure: production, sameSite: "strict" as const, path: "/" };
  response.cookie("nt_access", session.accessToken, { ...common, maxAge: session.expiresIn * 1000 });
  response.cookie("nt_refresh", session.refreshToken, { ...common, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

function rateLimit(limit: number, windowMs: number) {
  const attempts = new Map<string, number[]>();
  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const key = request.ip ?? "unknown";
    const recent = (attempts.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
    if (recent.length >= limit) {
      response.status(429).json({ error: { code: "UPSTREAM_RATE_LIMITED", message: "Thao tác quá thường xuyên, vui lòng thử lại sau" } });
      return;
    }
    recent.push(now);
    attempts.set(key, recent);
    next();
  };
}

export function createApp({ auth, bedbank, production = false, publicDir }: Dependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use((request, response, next) => {
    const id = request.header("x-request-id") ?? randomUUID();
    response.setHeader("x-request-id", id);
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    next();
  });

  const requireAuth = asyncRoute(async (request, response, next) => {
    const token = request.cookies.nt_access as string | undefined;
    const refreshToken = request.cookies.nt_refresh as string | undefined;
    if (!token && !refreshToken) throw new AppError(401, "AUTH_REQUIRED", "Vui lòng đăng nhập");
    let profile: Profile;
    try {
      if (!token) throw new AppError(401, "AUTH_REQUIRED", "Phiên đăng nhập đã hết hạn");
      profile = await auth.authenticate(token);
    } catch (error) {
      if (!refreshToken || !(error instanceof AppError) || error.status !== 401) throw error;
      const session = await auth.refresh(refreshToken);
      setSessionCookies(response, session, production);
      profile = session.profile;
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

  app.post("/api/auth/login", rateLimit(8, 15 * 60_000), asyncRoute(async (request, response) => {
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
    await auth.logout(request.cookies.nt_access as string);
    response.clearCookie("nt_access", { path: "/" });
    response.clearCookie("nt_refresh", { path: "/" });
    response.status(204).end();
  }));

  app.get("/api/admin/users", requireAuth, requireReady, requireAdmin, asyncRoute(async (_request, response) => response.json({ data: await auth.listUsers() })));
  app.post("/api/admin/users", requireAuth, requireReady, requireAdmin, asyncRoute(async (request, response) => response.status(201).json({ data: await auth.createUser(request.profile!, newUserSchema.parse(request.body)) })));
  app.patch("/api/admin/users/:id", requireAuth, requireReady, requireAdmin, asyncRoute(async (request, response) => response.json({ data: await auth.updateUser(request.profile!, routeId(request), updateUserSchema.parse(request.body)) })));
  app.post("/api/admin/users/:id/reset-password", rateLimit(10, 15 * 60_000), requireAuth, requireReady, requireAdmin, asyncRoute(async (request, response) => {
    const input = resetSchema.parse(request.body);
    await auth.resetPassword(request.profile!, routeId(request), input.temporaryPassword);
    response.status(204).end();
  }));

  app.get("/api/properties", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: await bedbank.properties(String(request.query.query ?? "")) })));
  app.post("/api/availability/hotels", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: await bedbank.hotels(searchRequestSchema.parse(request.body)) })));
  app.post("/api/availability/rooms", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: await bedbank.rooms(roomSearchSchema.parse(request.body)) })));
  app.post("/api/availability/detail", requireAuth, requireReady, asyncRoute(async (request, response) => response.json({ data: await bedbank.detail(detailSearchSchema.parse(request.body)) })));

  if (publicDir) {
    app.use(express.static(publicDir, { index: false, fallthrough: true }));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api/")) {
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
