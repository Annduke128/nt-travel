import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";

const admin = { userId: "admin-1", email: "admin@nttravel.vn", displayName: "Quản trị viên", role: "admin", status: "active", mustChangePassword: false };
const staff = { ...admin, userId: "staff-1", email: "staff@nttravel.vn", displayName: "Nhân viên", role: "staff" };

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/me") return json({ data: { profile: admin } });
    if (url.startsWith("/api/properties")) return json({ data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang" }] });
    if (url === "/api/availability/hotels") return json({ data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", quantity: 4, fromPrice: 2450000, currency: "VND" }] });
    if (url === "/api/availability/rooms") return json({ data: [{ propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Linh hoạt · Bao gồm bữa sáng", quantity: 4, total: 4900000, average: 2450000, tax: 490000, currency: "VND", maxOccupancy: 3 }] });
    if (url === "/api/availability/detail") return json({ data: { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Linh hoạt · Bao gồm bữa sáng", quantity: 4, total: 4900000, average: 2450000, tax: 490000, currency: "VND", dailyRates: [{ date: "2026-07-23", amount: 2450000, tax: 245000 }, { date: "2026-07-24", amount: 2450000, tax: 245000 }], policies: [{ type: "Hủy phòng", description: "Miễn phí hủy trước 3 ngày." }] } });
    if (url === "/api/admin/users") return init?.method === "POST" ? json({ data: staff }, 201) : json({ data: [admin, staff] });
    return json({ error: { code: "VALIDATION_ERROR", message: `Unexpected ${url}` } }, 400);
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("NT Travel bedbank v1", () => {
  test("login is required before staff can search", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => json({ error: { code: "AUTH_REQUIRED", message: "Vui lòng đăng nhập" } }, 401));
    vi.mocked(fetch).mockImplementationOnce(() => json({ data: { profile: staff } }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Email"), "staff@nttravel.vn");
    await user.type(screen.getByLabelText("Mật khẩu"), "temporary-password");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(await screen.findByRole("heading", { name: "Tìm kỳ nghỉ xứng tầm." })).toBeVisible();
  });

  test("a forced-password user only sees password change", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => json({ data: { profile: { ...staff, mustChangePassword: true } } }));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Đổi mật khẩu tạm" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Tìm khách sạn" })).not.toBeInTheDocument();
  });

  test("staff searches hotel, room rate, and safe rate detail", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Tìm kỳ nghỉ xứng tầm." });
    await user.type(screen.getByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    await user.click(await screen.findByRole("button", { name: /xem giá chi tiết deluxe ocean/i }));

    expect(await screen.findByRole("heading", { name: "Chi tiết giá net" })).toBeVisible();
    expect(screen.getAllByText(/4\.900\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText("Miễn phí hủy trước 3 ngày.")).toBeVisible();
    expect(screen.queryByText(/tiếp tục đặt phòng/i)).not.toBeInTheDocument();
  });

  test("admin can open staff management", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Nhân viên" }));

    expect(await screen.findByRole("heading", { name: "Quản lý nhân viên" })).toBeVisible();
    expect(screen.getByText("staff@nttravel.vn")).toBeVisible();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/users", expect.anything()));
  });

  test("admin can create a staff account with a temporary password", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Nhân viên" }));
    await user.click(await screen.findByRole("button", { name: "Thêm nhân viên" }));
    await user.type(screen.getByLabelText("Họ tên"), "Nhân viên mới");
    await user.type(screen.getByLabelText("Email"), "new@nttravel.vn");
    await user.type(screen.getByLabelText("Mật khẩu tạm"), "temporary-1234");
    await user.click(screen.getByRole("button", { name: "Tạo tài khoản" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/users", expect.objectContaining({ method: "POST" })));
  });

  test("admin can reset a staff temporary password", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Nhân viên" }));
    await user.click(await screen.findByRole("button", { name: "Đặt lại mật khẩu cho Nhân viên" }));
    await user.type(screen.getByLabelText("Mật khẩu tạm mới"), "new-temporary-123");
    await user.click(screen.getByRole("button", { name: "Xác nhận đặt lại" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/users/staff-1/reset-password", expect.objectContaining({ method: "POST" })));
  });

  test("modules outside v1 are hidden", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Tìm kỳ nghỉ xứng tầm." });
    expect(screen.queryByText("Allotment")).not.toBeInTheDocument();
    expect(screen.queryByText("Đơn đặt")).not.toBeInTheDocument();
    expect(screen.queryByText("Booking của tôi")).not.toBeInTheDocument();
  });
});
