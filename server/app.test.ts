// @vitest-environment node
import request from "supertest";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "./app.js";
import type { AuthService, BedbankService } from "./services.js";
import { MockBedbankService } from "./cloudhms/mock.js";

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
    properties: vi.fn(async () => [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang" }]),
    hotels: vi.fn(async () => []),
    rooms: vi.fn(async () => []),
    detail: vi.fn(),
  };
  return { auth, bedbank };
}

describe("BFF", () => {
  test("login returns a safe profile and writes httpOnly cookies", async () => {
    const app = createApp(services());
    const response = await request(app).post("/api/auth/login").send({ email: "staff@nttravel.vn", password: "temporary-password" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { profile: staff } });
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(JSON.stringify(response.body)).not.toContain("access");
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
