// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "./app.js";
import { AppError } from "./errors.js";
import type { AuthService, BedbankService } from "./services.js";
import { MockBedbankService } from "./cloudhms/mock.js";
import { BookingService } from "./bookings/service.js";
import { MockBookingGateway } from "./bookings/mock.js";
import { MemoryBookingStore } from "./bookings/store.js";

const staff = {
  userId: "staff-1",
  email: "staff@nttravel.vn",
  displayName: "Nhân viên",
  role: "staff" as const,
  status: "active" as const,
  mustChangePassword: false,
};

function services() {
  const auth: AuthService = {
    health: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ profile: staff, accessToken: "access", refreshToken: "refresh", expiresIn: 3600 })),
    authenticate: vi.fn(async () => staff),
    refresh: vi.fn(),
    logout: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => undefined),
    listUsers: vi.fn(async () => []),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetPassword: vi.fn(),
  };
  const bedbank: BedbankService = {
    health: vi.fn(async () => undefined),
    properties: vi.fn(async () => [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang" }]),
    hotels: vi.fn(async () => []),
    rooms: vi.fn(async () => []),
    detail: vi.fn(),
  };
  return { auth, bedbank };
}

describe("BFF", () => {
  test("staff creates, reopens, and confirms a mock booking through the authenticated API", async () => {
    const deps = services();
    const bedbank = new MockBedbankService();
    const bookings = new BookingService(new MockBookingGateway(bedbank), new MemoryBookingStore());
    const app = createApp({ ...deps, bedbank, bookings });
    const input = { requestId: "22222222-2222-4222-8222-222222222222", destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03",
      rooms: [{ adults: 2, children: 0, infants: 0 }], propertyId: "mock-nha-trang", roomTypeId: "deluxe-ocean", ratePlanId: "breakfast-flex",
      expectedTotal: 4900000, currency: "VND", guests: [{ firstName: "An", lastName: "Nguyen", email: "guest@example.com", phoneNumber: "0912345678" }], notes: "", acceptedPolicies: true };
    const created = await request(app).post("/api/bookings").set("Cookie", "nt_access=access").send(input);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("created");
    const duplicate = await request(app).post("/api/bookings").set("Cookie", "nt_access=access").send(input);
    expect(duplicate.body.data.reservations).toEqual(created.body.data.reservations);
    const terms = await request(app).get(`/api/bookings/${input.requestId}/guarantees`).set("Cookie", "nt_access=access");
    expect(terms.status).toBe(200);
    const confirmed = await request(app).post(`/api/bookings/${input.requestId}/confirm`).set("Cookie", "nt_access=access")
      .send({ guaranteeVersion: terms.body.data.version, acceptedGuarantee: true });
    expect(confirmed.body.data.status).toBe("confirmed");
    const list = await request(app).get("/api/bookings").set("Cookie", "nt_access=access");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].status).toBe("confirmed");
    vi.mocked(deps.auth.authenticate).mockResolvedValue({ ...staff, userId: "other" });
    expect((await request(app).get(`/api/bookings/${input.requestId}`).set("Cookie", "nt_access=access")).status).toBe(404);
  });

  test("forced-password users cannot create bookings", async () => {
    const deps = services();
    vi.mocked(deps.auth.authenticate).mockResolvedValue({ ...staff, mustChangePassword: true });
    expect((await request(createApp(deps)).post("/api/bookings").set("Cookie", "nt_access=access").send({})).status).toBe(403);
  });
  test("booking creation requires authentication", async () => {
    const response = await request(createApp(services())).post("/api/bookings").send({});
    expect(response.status).toBe(401);
  });

  test("booking creation validates guest and quote before calling the service", async () => {
    const response = await request(createApp(services())).post("/api/bookings").set("Cookie", "nt_access=access").send({});
    expect(response.status).toBe(400);
  });
  test("liveness is public and independent from dependency readiness", async () => {
    const readiness = vi.fn(async () => { throw new Error("upstream unavailable"); });
    const app = createApp({ ...services(), readiness });

    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(readiness).not.toHaveBeenCalled();
  });

  test("readiness caches a successful dependency probe briefly", async () => {
    const readiness = vi.fn(async () => undefined);
    const app = createApp({ ...services(), readiness, readinessCacheMs: 10_000 });

    const first = await request(app).get("/health/ready");
    const second = await request(app).get("/health/ready");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual({ status: "ready" });
    expect(readiness).toHaveBeenCalledTimes(1);
  });

  test("readiness hides dependency error details", async () => {
    const readiness = vi.fn(async () => { throw new Error("secret upstream hostname"); });
    const app = createApp({ ...services(), readiness, readinessCacheMs: 0 });

    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "not_ready" });
    expect(JSON.stringify(response.body)).not.toContain("secret upstream hostname");
  });

  test("authenticated API responses are non-cacheable and carry hardened headers", async () => {
    const app = createApp(services());

    const response = await request(app).get("/api/me").set("Cookie", "nt_access=access");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  test("production cookies and transport headers require HTTPS", async () => {
    const app = createApp({ ...services(), production: true });

    const response = await request(app).post("/api/auth/login").send({ email: "staff@nttravel.vn", password: "temporary-password" });

    expect(String(response.headers["set-cookie"])).toContain("Secure");
    expect(response.headers["strict-transport-security"]).toContain("max-age=");
  });

  test("serves revalidated HTML and immutable fingerprinted assets", async () => {
    const publicDir = await mkdtemp(path.join(os.tmpdir(), "nt-travel-static-"));
    await mkdir(path.join(publicDir, "assets"));
    await writeFile(path.join(publicDir, "index.html"), "<!doctype html><title>NT Travel</title>");
    await writeFile(path.join(publicDir, "assets", "app-abc123.js"), "console.log('ok')");
    try {
      const app = createApp({ ...services(), publicDir });

      const html = await request(app).get("/");
      const asset = await request(app).get("/assets/app-abc123.js");

      expect(html.headers["cache-control"]).toBe("no-cache");
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    } finally {
      await rm(publicDir, { recursive: true, force: true });
    }
  });

  test("login limiter uses the configured proxy hop and isolates client IPs", async () => {
    const deps = services();
    vi.mocked(deps.auth.login).mockRejectedValue(new AppError(401, "AUTH_REQUIRED", "Email hoặc mật khẩu không đúng"));
    const app = createApp({ ...deps, trustProxyHops: 1 });
    const attempt = (ip: string) => request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: "staff@nttravel.vn", password: "wrong-password" });

    for (let count = 0; count < 8; count += 1) expect((await attempt("198.51.100.10")).status).toBe(401);
    expect((await attempt("198.51.100.10")).status).toBe(429);
    expect((await attempt("203.0.113.20")).status).toBe(401);
  });

  test("login limiter bounds tracked client keys by evicting the oldest", async () => {
    const deps = services();
    vi.mocked(deps.auth.login).mockRejectedValue(new AppError(401, "AUTH_REQUIRED", "Email hoặc mật khẩu không đúng"));
    const app = createApp({ ...deps, trustProxyHops: 1, rateLimitMaxKeys: 2 });
    const attempt = (ip: string) => request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: "staff@nttravel.vn", password: "wrong-password" });

    expect((await attempt("198.51.100.1")).status).toBe(401);
    expect((await attempt("198.51.100.2")).status).toBe(401);
    expect((await attempt("198.51.100.3")).status).toBe(401);
    for (let count = 0; count < 8; count += 1) expect((await attempt("198.51.100.1")).status).toBe(401);
    expect((await attempt("198.51.100.1")).status).toBe(429);
  });

  test("login returns a safe profile and writes httpOnly cookies", async () => {
    const app = createApp(services());
    const response = await request(app).post("/api/auth/login").send({ email: "staff@nttravel.vn", password: "temporary-password" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { profile: staff } });
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(JSON.stringify(response.body)).not.toContain("access");
  });

  test("a malformed request body is a client error and stays traceable", async () => {
    const app = createApp(services());

    const response = await request(app).post("/api/availability/hotels")
      .set("Cookie", "nt_access=access").set("content-type", "application/json").send("{");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  test("a room payload that breaks the response contract is not forwarded to the browser", async () => {
    const deps = services();
    // Đúng hình dạng lỗi đã gặp thật: get-room-availability trả GUID toàn số 0 ở cấp một, khiến
    // mọi hạng phòng trùng ID và màn hình chi tiết giá nhận 400 RATE_PLAN_NOT_FOUND.
    vi.mocked(deps.bedbank.rooms).mockResolvedValue([{
      propertyId: "p1", roomTypeId: "00000000-0000-0000-0000-000000000000", roomTypeName: "Hạng phòng",
      ratePlanId: "00000000-0000-0000-0000-000000000000", ratePlanName: "BABBAG",
      quantity: 10, total: 5_400_000, average: 2_700_000, currency: "VND",
    }]);
    const app = createApp(deps);

    const response = await request(app).post("/api/availability/rooms").set("Cookie", "nt_access=access")
      .send({ destination: "Tây Ninh", arrivalDate: "2026-09-28", departureDate: "2026-09-30", rooms: [{ adults: 2, children: 0, infants: 0 }], propertyId: "p1" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  test("a valid room payload still reaches the browser unchanged", async () => {
    const deps = services();
    const room = {
      propertyId: "p1", roomTypeId: "4ea4ea04-4572-652a-7bd1-ce2c772379f8", roomTypeName: "Presidental Suite",
      ratePlanId: "9fb9d6df-6c05-4202-a08e-57d44f8ce8ae", ratePlanName: "BABBAG",
      quantity: 10, total: 5_400_000, average: 2_700_000, tax: 0, currency: "VND", maxOccupancy: 8,
    };
    vi.mocked(deps.bedbank.rooms).mockResolvedValue([room]);
    const app = createApp(deps);

    const response = await request(app).post("/api/availability/rooms").set("Cookie", "nt_access=access")
      .send({ destination: "Tây Ninh", arrivalDate: "2026-09-28", departureDate: "2026-09-30", rooms: [{ adults: 2, children: 0, infants: 0 }], propertyId: "p1" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([room]);
  });

  test("staff cannot call admin APIs", async () => {
    const app = createApp(services());
    const response = await request(app).get("/api/admin/users").set("Cookie", "nt_access=access");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("forced-password users cannot search", async () => {
    const deps = services();
    vi.mocked(deps.auth.authenticate).mockResolvedValue({ ...staff, mustChangePassword: true });
    const app = createApp(deps);
    const response = await request(app).get("/api/properties").set("Cookie", "nt_access=access");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  test("authenticated staff can complete hotel to room to detail against mock CloudHMS", async () => {
    const deps = services();
    const app = createApp({ auth: deps.auth, bedbank: new MockBedbankService() });
    const body = { destination: "Nha Trang", arrivalDate: "2026-08-10", departureDate: "2026-08-12", rooms: [{ adults: 2, children: 0, infants: 0 }] };
    const hotels = await request(app).post("/api/availability/hotels").set("Cookie", "nt_access=access").send(body);
    const rooms = await request(app).post("/api/availability/rooms").set("Cookie", "nt_access=access").send({ ...body, propertyId: hotels.body.data[0].id });
    const detail = await request(app).post("/api/availability/detail").set("Cookie", "nt_access=access").send({ ...body, propertyId: hotels.body.data[0].id, roomTypeId: rooms.body.data[0].roomTypeId, ratePlanId: rooms.body.data[0].ratePlanId });

    expect(hotels.status).toBe(200);
    expect(rooms.body.data[0]).toMatchObject({ roomTypeName: "Deluxe Ocean", currency: "VND" });
    expect(detail.body.data).toMatchObject({ total: 4900000, quantity: 4 });
    expect(detail.body.data.dailyRates).toHaveLength(2);
  });
});
