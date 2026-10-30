import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";
import type { RoomAvailabilityDto } from "../shared/contracts";
import { closeGuestRoom, fillRequiredGuestCountries, openGuestRoom } from "./test/guestRooms";

const admin = { userId: "admin-1", email: "admin@nttravel.vn", displayName: "Quản trị viên", role: "admin", status: "active", mustChangePassword: false };
const staff = { ...admin, userId: "staff-1", email: "staff@nttravel.vn", displayName: "Nhân viên", role: "staff" };

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/me") return json({ data: { profile: admin } });
    if (url.startsWith("/api/properties")) return json({ data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang" }] });
    if (url === "/api/availability/hotels") return json({ data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", quantity: 4, fromPrice: 2450000, currency: "VND" }] });
    if (url === "/api/availability/rooms") return json({ data: [{ propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Linh hoạt · Bao gồm bữa sáng", quantity: 4, total: 4900000, average: 2450000, tax: 490000, currency: "VND", maxOccupancy: 3 }] });
    if (url === "/api/availability/detail") return json({ data: { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Linh hoạt · Bao gồm bữa sáng", quantity: 4, total: 4900000, average: 2450000, tax: 490000, currency: "VND", dailyRates: [{ date: "2026-07-23", amount: 2450000, tax: 245000 }, { date: "2026-07-24", amount: 2450000, tax: 245000 }], policies: [{ type: "Hủy phòng", description: "Miễn phí hủy trước 3 ngày." }] } });
    if (url.startsWith("/api/journeys/")) return json({ data: [] });
    if (url === "/api/bookings" && init?.method !== "POST") return json({ data: [] });
    if (url === "/api/admin/users") return init?.method === "POST" ? json({ data: staff }, 201) : json({ data: [admin, staff] });
    return json({ error: { code: "VALIDATION_ERROR", message: `Unexpected ${url}` } }, 400);
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("NT Travel bedbank v1", () => {
  /** Thay riêng một endpoint, các endpoint còn lại giữ mock mặc định. */
  function stubEndpoint(path: string, body: unknown, status: number) {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => String(url) === path ? json(body, status) : original(url, init));
  }

  async function searchFor(destination: string) {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), destination);
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    return user;
  }

  test.each([1, 2, 5])("shows nightly hotel and allotment prices for a %i-night stay while preserving the selected total", async (nights) => {
    const nightly = 2659475;
    const total = nightly * nights;
    const rate = { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "breakfast", ratePlanName: "Bao gồm bữa sáng", allotmentId: "agent", allotmentName: "Agent", quantity: 4, total, average: 0, currency: "VND" };
    stubEndpoint("/api/availability/hotels", { data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", quantity: 4, fromPrice: total, currency: "VND", programs: [{ total, currency: "VND" }] }] }, 200);
    stubEndpoint("/api/availability/rooms", { data: [rate] }, 200);
    stubEndpoint("/api/availability/detail", { data: { ...rate, dailyRates: [], policies: [] } }, 200);
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    fireEvent.change(screen.getByLabelText("Ngày nhận phòng"), { target: { value: "2099-11-25" } });
    const departure = new Date(Date.UTC(2099, 10, 25 + nights)).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText("Ngày trả phòng"), { target: { value: departure } });
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    const hotel = (await screen.findByRole("heading", { name: "Vinpearl Beachfront Nha Trang" })).closest("article")!;
    expect(within(hotel).getByText(/2\.659\.475/)).toBeVisible();
    expect(within(hotel).getByText("Từ / phòng / đêm")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Tầm giá / phòng / đêm"), "2-5");
    await user.click(screen.getByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    const toggle = await screen.findByRole("button", { name: "Allotment Deluxe Ocean" });
    expect(within(toggle.closest("tr")!).getByText(/2\.659\.475/)).toBeVisible();
    await user.click(toggle);
    const choose = screen.getByRole("button", { name: "Chọn Deluxe Ocean · Agent · Bao gồm bữa sáng" });
    expect(choose).toHaveTextContent(/2\.659\.475/);
    await user.click(choose);
    const quantity = await screen.findByLabelText("Số phòng Deluxe Ocean · Agent · Bao gồm bữa sáng");
    fireEvent.change(quantity, { target: { value: "2" } });
    const sidebar = screen.getByRole("complementary", { name: "Hạng phòng đã chọn" });
    const formattedTotal = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(total * 2).replace(/\s+/g, " ");
    expect(within(sidebar).getAllByText(formattedTotal)).toHaveLength(2);
    expect(within(screen.getByRole("table", { name: "Giá theo allotment · Deluxe Ocean" })).getByRole("button", { name: "Bỏ chọn Deluxe Ocean · Agent · Bao gồm bữa sáng" })).toHaveTextContent(/2\.659\.475/);
  });

  test("uses a compact search form and leaves guest counts for room assignment", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Tìm phòng" });
    expect(screen.queryByText("Tìm kỳ nghỉ xứng tầm.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tồn phòng, giá net và chính sách lấy từ CloudHMS/)).not.toBeInTheDocument();
    const dates = screen.getByRole("group", { name: "Nhận phòng – Trả phòng" });
    expect(within(dates).getByLabelText("Ngày nhận phòng")).toBeVisible();
    expect(within(dates).getByLabelText("Ngày trả phòng")).toBeVisible();
    expect(screen.queryByLabelText("Số phòng", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Người lớn mỗi phòng")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Trẻ em mỗi phòng")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Em bé mỗi phòng")).not.toBeInTheDocument();
  });

  test("keeps legacy drafts out of search and restores them from the booking list", async () => {
    const detail = { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Breakfast", maxOccupancy: 3, quantity: 4, total: 4900000, average: 2450000, currency: "VND", dailyRates: [], policies: [] };
    const drafts = [1, 2, 3].map((index) => ({ requestId: `draft-${index}`, journeyId: `old-journey-${index}`, journeyLeg: 1, propertyName: "Vinpearl Beachfront Nha Trang", detail,
      search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] } }));
    localStorage.setItem("nt-journey-drafts:admin-1", JSON.stringify({ legs: drafts, fields: { "draft-2": { notes: "Giường đôi" } } }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Tìm phòng" });
    expect(screen.queryByText("Chặng đang lưu nháp")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mở chặng/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Đặt phòng của tôi" }));
    const saved = await screen.findByRole("region", { name: "Đặt phòng đang soạn" });
    expect(within(saved).getAllByRole("listitem")).toHaveLength(3);
    await user.click(within(saved).getByRole("button", { name: "Mở bản nháp 2" }));
    expect(await screen.findByLabelText("Yêu cầu chung cho đặt phòng")).toHaveValue("Giường đôi");
    expect(screen.queryByRole("button", { name: "Thêm chặng" })).not.toBeInTheDocument();
  });

  test("filters available programs by stay type, stars, price, policy and services and resets filters", async () => {
    const base = { city: "Nha Trang", quantity: 4, currency: "VND" };
    const hotel = { ...base, id: "p1", name: "Khách sạn Biển", propertyType: "Khách sạn", starRating: 5, services: ["Hồ bơi", "Spa"], fromPrice: 1500000,
      programs: [{ total: 1500000, currency: "VND", cancellationPolicy: "non-refundable" }, { total: 4000000, currency: "VND", cancellationPolicy: "refundable" }] };
    const villa = { ...base, id: "p2", name: "Villa Vườn", propertyType: "Villa", services: ["Hồ bơi"], fromPrice: 7000000,
      programs: [{ total: 7000000, currency: "VND", cancellationPolicy: "refundable" }] };
    stubEndpoint("/api/availability/hotels", { data: [hotel, villa] }, 200);
    const user = await searchFor("Nha Trang");
    expect(await screen.findByRole("heading", { name: "2 khách sạn còn phòng" })).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Loại lưu trú"), "Villa");
    expect(screen.queryByRole("heading", { name: "Khách sạn Biển" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Villa Vườn" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Bỏ lọc" }));
    await user.selectOptions(screen.getByLabelText("Hạng sao"), "5");
    expect(screen.queryByRole("heading", { name: "Villa Vườn" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Tầm giá / phòng / đêm"), "2-5");
    await user.selectOptions(screen.getByLabelText("Chính sách"), "refundable");
    await user.selectOptions(screen.getByLabelText("Dịch vụ / tiện ích"), "Spa");
    expect(screen.getByRole("heading", { name: "Khách sạn Biển" })).toBeVisible();
    expect(screen.getByText(/2\.000\.000/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Chính sách"), "non-refundable");
    expect(screen.getByText("Không có kết quả phù hợp bộ lọc.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Bỏ lọc" }));
    expect(screen.getByRole("heading", { name: "2 khách sạn còn phòng" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Villa Vườn" })).toBeVisible();
  });

  test("does not invent stars, types or services when the upstream metadata is missing", async () => {
    await searchFor("Nha Trang");
    await screen.findByRole("heading", { name: "1 khách sạn còn phòng" });
    expect(screen.getByLabelText("Hạng sao")).toBeDisabled();
    expect(screen.getByLabelText("Loại lưu trú")).toBeDisabled();
    expect(screen.getByLabelText("Dịch vụ / tiện ích")).toBeDisabled();
    expect(screen.getByLabelText("Chính sách")).toBeDisabled();
    expect(screen.getByLabelText("Tầm giá / phòng / đêm")).toBeEnabled();
  });

  function stubRoomPrograms() {
    const base = { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", quantity: 4, currency: "VND", maxOccupancy: 3 };
    const rates: RoomAvailabilityDto[] = [
      { ...base, ratePlanId: "breakfast", ratePlanName: "Bao gồm bữa sáng", total: 5500000, average: 2750000, tax: 550000 },
      { ...base, ratePlanId: "room-only", ratePlanName: "Chỉ phòng", total: 4200000, average: 2100000 },
      { ...base, ratePlanId: "promo", ratePlanName: "Ưu đãi sớm", quantity: 0, total: 3000000, average: 1500000 },
      { ...base, roomTypeId: "r2", roomTypeName: "Suite", ratePlanId: "flex", ratePlanName: "Linh hoạt", total: 7000000, average: 3500000 },
    ];
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === "/api/availability/rooms") return json({ data: rates });
      if (url === "/api/availability/detail") {
        const query = JSON.parse(String(init?.body));
        const rate = rates.find((item) => item.roomTypeId === query.roomTypeId && item.ratePlanId === query.ratePlanId)!;
        return json({ data: { ...rate, dailyRates: [{ date: "2026-07-23", amount: rate.total }], policies: [{ type: "Hủy phòng", description: `Chính sách ${rate.ratePlanName}` }] } });
      }
      return original(url, init);
    });
  }

  test("compares the same program across horizontal allotments and preserves each chosen price", async () => {
    const base = { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "breakfast", ratePlanName: "Bao gồm bữa sáng", quantity: 4, currency: "VND", maxOccupancy: 3 };
    const rates = [
      { ...base, allotmentId: "agent", allotmentName: "BEST RATES - AGENT", total: 5500000, average: 2750000 },
      { ...base, allotmentId: "agent", allotmentName: "BEST RATES - AGENT", ratePlanId: "room-only", ratePlanName: "Chỉ phòng", total: 5000000, average: 2500000 },
      { ...base, allotmentId: "summer", allotmentName: "SUMMER PROMOTION", total: 4500000, average: 2250000 },
    ];
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === "/api/availability/rooms") return json({ data: rates });
      if (url === "/api/availability/detail") {
        const query = JSON.parse(String(init?.body));
        const rate = rates.find((item) => item.ratePlanId === query.ratePlanId && item.allotmentId === query.allotmentId)!;
        return json({ data: { ...rate, dailyRates: [], policies: [] } });
      }
      return original(url, init);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    const roomToggle = await screen.findByRole("button", { name: "Allotment Deluxe Ocean" });
    expect(screen.queryByText("BEST RATES - AGENT")).not.toBeInTheDocument();
    await user.click(within(roomToggle.closest("tr")!).getByText("Deluxe Ocean"));
    const comparison = screen.getByRole("table", { name: "Giá theo allotment · Deluxe Ocean" });
    expect(within(comparison).getByRole("columnheader", { name: "BEST RATES - AGENT" })).toBeVisible();
    expect(within(comparison).getByRole("columnheader", { name: "SUMMER PROMOTION" })).toBeVisible();
    const breakfast = within(comparison).getByRole("rowheader", { name: "Bao gồm bữa sáng" }).closest("tr")!;
    const prices = within(breakfast).getAllByRole("cell");
    expect(prices[0]).toHaveTextContent(/2\.750\.000/);
    expect(prices[1]).toHaveTextContent(/2\.250\.000/);
    const roomOnly = within(comparison).getByRole("rowheader", { name: "Chỉ phòng" }).closest("tr")!;
    expect(within(roomOnly).getAllByRole("cell")[1]).toHaveTextContent("Chưa có giá");
    await user.click(screen.getByRole("button", { name: "Chọn Deluxe Ocean · BEST RATES - AGENT · Bao gồm bữa sáng" }));
    expect(await screen.findByRole("button", { name: "Tiếp tục với 1 phòng" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Số phòng Deluxe Ocean · BEST RATES - AGENT · Bao gồm bữa sáng"), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Chọn Deluxe Ocean · SUMMER PROMOTION · Bao gồm bữa sáng" }));
    const summerQuantity = await screen.findByLabelText("Số phòng Deluxe Ocean · SUMMER PROMOTION · Bao gồm bữa sáng");
    fireEvent.change(summerQuantity, { target: { value: "3" } });
    expect(screen.getByLabelText("Số phòng Deluxe Ocean · BEST RATES - AGENT · Bao gồm bữa sáng")).toHaveValue(2);
    expect(summerQuantity).toHaveValue(3);
    fireEvent.change(summerQuantity, { target: { value: "5" } });
    expect(summerQuantity).toHaveValue(3);
    await user.click(roomToggle);
    expect(within(roomToggle.closest("tr")!).getByText(/24\.500\.000/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Tiếp tục với 5 phòng" }));
    await user.click(await screen.findByRole("button", { name: "Xác nhận phòng" }));
    const priceLines = within(await screen.findByRole("list", { name: "Giá từng phòng" })).getAllByRole("listitem");
    expect(priceLines).toHaveLength(5);
    priceLines.slice(0, 2).forEach((line) => expect(line).toHaveTextContent(/BEST RATES - AGENT.*5\.500\.000/));
    priceLines.slice(2).forEach((line) => expect(line).toHaveTextContent(/SUMMER PROMOTION.*4\.500\.000/));
  });

  test("groups matching room types into one expandable row with the lowest available program price", async () => {
    stubRoomPrograms();
    const user = await searchFor("Nha Trang");
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    const table = await screen.findByRole("table", { name: "Hạng phòng tại Vinpearl Beachfront Nha Trang" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    const toggle = within(table).getByRole("button", { name: "Chương trình giá Deluxe Ocean" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle.closest("tr")!).getByText(/2\.100\.000/)).toBeVisible();
    expect(within(table).queryByText(/3\.000\.000/)).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /Chọn Deluxe Ocean/ })).not.toBeInTheDocument();

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeVisible();
    expect(within(table).getByText("Bao gồm bữa sáng")).toBeVisible();
    expect(within(table).getByText("Chỉ phòng")).toBeVisible();
    expect(within(table).getByRole("button", { name: "Chọn Deluxe Ocean · Ưu đãi sớm" })).toBeDisabled();
    expect(within(table).getByRole("button", { name: "Đặt phòng Deluxe Ocean · Ưu đãi sớm" })).toBeDisabled();
    expect(within(table).getByRole("button", { name: "Chương trình giá Suite" })).toHaveAttribute("aria-expanded", "false");

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  test("preserves the selected program and quantity when a room dropdown is collapsed and books that program", async () => {
    stubRoomPrograms();
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    const toggle = await screen.findByRole("button", { name: "Chương trình giá Deluxe Ocean" });
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Chọn Deluxe Ocean · Bao gồm bữa sáng" }));
    const quantity = await screen.findByLabelText("Số phòng Deluxe Ocean · Bao gồm bữa sáng");
    fireEvent.change(quantity, { target: { value: "2" } });
    await user.click(toggle);
    expect(within(toggle.closest("tr")!).getByText(/11\.000\.000/)).toBeVisible();
    await user.click(toggle);
    expect(screen.getByLabelText("Số phòng Deluxe Ocean · Bao gồm bữa sáng")).toHaveValue(2);
    expect(screen.getByRole("button", { name: "Chọn Deluxe Ocean · Chỉ phòng" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Tiếp tục với 2 phòng" }));
    expect(await screen.findByRole("heading", { name: "Vinpearl Beachfront Nha Trang", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
    const lines = within(screen.getByRole("list", { name: "Giá từng phòng" })).getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(line).toHaveTextContent(/Bao gồm bữa sáng.*5\.500\.000/));
  });

  test("opens policies and quick-books the exact program from a grouped room", async () => {
    stubRoomPrograms();
    const user = await searchFor("Nha Trang");
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    await user.click(await screen.findByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
    await user.click(screen.getByRole("button", { name: "Xem giá chi tiết Deluxe Ocean · Chỉ phòng" }));
    expect(await screen.findByText("Chính sách Chỉ phòng")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Đặt phòng Deluxe Ocean · Bao gồm bữa sáng" }));
    expect(await screen.findByRole("heading", { name: "Vinpearl Beachfront Nha Trang", level: 1 })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
    expect(within(screen.getByRole("list", { name: "Giá từng phòng" })).getByRole("listitem")).toHaveTextContent(/Bao gồm bữa sáng.*5\.500\.000/);
  });

  test("tên không khớp khách sạn nào thì báo sửa tên, không phải lỗi hệ thống", async () => {
    stubEndpoint("/api/availability/hotels", { error: { code: "PROPERTY_NOT_FOUND", message: "Không có khách sạn nào khớp với “vinperl hue”" } }, 404);

    await searchFor("vinperl hue");

    expect(await screen.findByRole("heading", { name: "Không tìm thấy khách sạn nào." })).toBeVisible();
    expect(screen.getByText(/vinperl hue/)).toBeVisible();
    // Sai tên không phải sự cố hệ thống: không hiện alert đỏ kèm "Thử lại".
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
  });

  test("ngày đã chọn hết phòng thì vẫn liệt kê khách sạn khớp tên để đổi ngày", async () => {
    stubEndpoint("/api/availability/hotels", { error: {
      code: "NO_AVAILABILITY",
      message: "2 khách sạn khớp “vinpearl hai phong” nhưng không còn phòng từ 15/10/2026 đến 17/10/2026",
      details: { properties: [
        { id: "hp1", name: "Vinpearl Hotel Imperia Hải Phòng", city: "Hải Phòng" },
        { id: "hp2", name: "Vinpearl Hotel Rivera Hải Phòng", city: "Hải Phòng" },
      ] },
    } }, 404);

    const user = await searchFor("vinpearl hai phong");

    expect(await screen.findByRole("heading", { name: "Không còn phòng cho ngày đã chọn." })).toBeVisible();
    expect(screen.getByText("Vinpearl Hotel Imperia Hải Phòng")).toBeVisible();
    expect(screen.getByText("Vinpearl Hotel Rivera Hải Phòng")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Đổi ngày" }));

    expect(screen.getByLabelText("Ngày nhận phòng")).toHaveFocus();
  });

  test("lỗi upstream thật vẫn hiện alert đỏ kèm thử lại", async () => {
    stubEndpoint("/api/availability/hotels", { error: { code: "UPSTREAM_UNAVAILABLE", message: "CloudHMS tạm thời không khả dụng" } }, 503);

    await searchFor("nha trang");

    expect(await screen.findByRole("alert")).toHaveTextContent("CloudHMS tạm thời không khả dụng");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeVisible();
  });

  test("nhân viên chọn khách sạn từ danh sách gợi ý bằng bàn phím", async () => {
    const user = userEvent.setup();
    render(<App />);
    const field = await screen.findByLabelText("Điểm đến hoặc khách sạn");

    await user.type(field, "vinpearl");

    // Gợi ý phải hiện đúng những gì API trả về, kể cả khi tên không chứa chuỗi đang gõ.
    expect(await screen.findByRole("option", { name: /vinpearl beachfront nha trang/i })).toBeVisible();
    expect(field).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}");
    expect(field).toHaveAttribute("aria-activedescendant", "property-suggestions-option-0");
    await user.keyboard("{Enter}");
    expect(field).toHaveValue("Vinpearl Beachfront Nha Trang");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  test("đóng danh sách gợi ý bằng Escape", async () => {
    const user = userEvent.setup();
    render(<App />);
    const field = await screen.findByLabelText("Điểm đến hoặc khách sạn");
    await user.type(field, "vinpearl");
    expect(await screen.findByRole("option", { name: /vinpearl beachfront nha trang/i })).toBeVisible();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field).toHaveAttribute("aria-expanded", "false");
  });

  test("báo lỗi khi không tải được gợi ý thay vì hiện danh sách trống", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) =>
      String(url).startsWith("/api/properties")
        ? json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Dữ liệu từ CloudHMS không dùng được" } }, 503)
        : original(url, init));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "vinpearl");

    expect(await screen.findByText(/chưa tải được gợi ý/i)).toBeVisible();
  });

  test("staff books a room and must review the guarantee before confirming", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let booking: Record<string, unknown>;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === "/api/bookings" && init?.method === "POST") {
        const input = JSON.parse(String(init.body));
        booking = { id: input.requestId, reference: `NT-${input.requestId}`, request: input, status: "created", mode: "mock", createdAt: new Date().toISOString(),
          propertyName: "Vinpearl Beachfront Nha Trang", roomTypeName: "Deluxe Ocean", ratePlanName: "Breakfast", total: 4900000, currency: "VND",
          reservations: [{ id: "res1", confirmationNumber: "DEMO-123", status: "Prospect" }] };
        return json({ data: booking }, 201);
      }
      if (String(url).endsWith("/guarantees")) return json({ data: { version: "a".repeat(64), guarantees: [{ reservationId: "res1", amount: 1000000, currency: "VND", methods: [{ id: "g1", type: "Deposit", amount: 1000000, currency: "VND" }] }] } });
      if (String(url).endsWith("/confirm")) return json({ data: { ...booking, status: "confirmed", reservations: [{ id: "res1", confirmationNumber: "DEMO-123", status: "Reserved" }] } });
      return original(url, init);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    await user.click(await screen.findByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
    await user.click(await screen.findByRole("button", { name: "Đặt phòng Deluxe Ocean" }));
    await user.click(await screen.findByRole("button", { name: "Xác nhận phòng" }));
    await openGuestRoom(user);
    await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
    await user.type(screen.getByLabelText("Tên khách · Phòng 1"), "An");
    await user.type(screen.getByLabelText("Email · Phòng 1"), "guest@example.com");
    await user.type(screen.getByLabelText("Điện thoại · Phòng 1"), "0912345678");
    await user.type(screen.getByLabelText("Họ khách · Phòng 1 · Khách 2"), "Tran");
    await user.type(screen.getByLabelText("Tên khách · Phòng 1 · Khách 2"), "Binh");
    await user.type(screen.getByLabelText("Email · Phòng 1 · Khách 2"), "binh@example.com");
    await user.type(screen.getByLabelText("Điện thoại · Phòng 1 · Khách 2"), "0912345679");
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
    await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
    await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
    expect((await screen.findAllByText("Chờ xác nhận"))[0]).toBeVisible();
    expect(await screen.findByRole("button", { name: "Xác nhận đặt phòng" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /đồng ý.*bảo đảm/i }));
    await user.click(screen.getByRole("button", { name: "Xác nhận đặt phòng" }));
    expect(await screen.findByRole("heading", { name: "Đặt phòng đã xác nhận" })).toBeVisible();
    expect(screen.getByText("DEMO-123")).toBeVisible();
  });

  test("creates independent bookings without hotel journey controls", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    const created: { requestId: string; arrivalDate: string }[] = [];
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === "/api/bookings" && init?.method === "POST") {
        const request = JSON.parse(String(init.body));
        created.push(request);
        return json({ data: { id: request.requestId, reference: `NT-${request.requestId}`, request, status: "confirmed", mode: "mock", createdAt: new Date().toISOString(), propertyName: "Demo hotel", roomTypeName: "Deluxe Ocean", ratePlanName: "Breakfast", total: request.expectedTotal, currency: "VND", reservations: [{ id: request.requestId, confirmationNumber: "DEMO", status: "Reserved" }] } }, 201);
      }
      return original(url, init);
    });
    const user = userEvent.setup();
    render(<App />);
    const bookStay = async () => {
      await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
      await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
      await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
      await user.click(await screen.findByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
      await user.click(await screen.findByRole("button", { name: "Đặt phòng Deluxe Ocean" }));
      await user.click(await screen.findByRole("button", { name: "Giảm người lớn · Phòng 1" }));
      await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(1));
      await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
      await openGuestRoom(user);
      await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
      await user.type(screen.getByLabelText("Tên khách · Phòng 1"), "An");
      await user.type(screen.getByLabelText("Email · Phòng 1"), "an@example.com");
      await user.type(screen.getByLabelText("Điện thoại · Phòng 1"), "0912345678");
      await fillRequiredGuestCountries(user);
      await closeGuestRoom(user);
      await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
      await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
      await screen.findByRole("heading", { name: "Đặt phòng đã xác nhận" });
    };
    await bookStay();
    expect(screen.queryByText(/Mã hành trình/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm chặng" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tìm phòng" }));
    await bookStay();
    expect(created).toHaveLength(2);
    expect(created[0]!.requestId).not.toBe(created[1]!.requestId);
    expect(created.every((item) => !("journeyId" in item))).toBe(true);
  });

  test("keeps independent drafts and restores one without mixing guest details", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === "/api/bookings" && init?.method === "POST") {
        const request = JSON.parse(String(init.body));
        return json({ data: { id: request.requestId, reference: `NT-${request.requestId}`, request, status: "confirmed", mode: "mock", createdAt: new Date().toISOString(), propertyName: "Vinpearl Beachfront Nha Trang", roomTypeName: "Deluxe Ocean", ratePlanName: "Breakfast", total: request.expectedTotal, currency: "VND", reservations: [{ id: "res1", confirmationNumber: "DEMO", status: "Reserved" }] } }, 201);
      }
      return original(url, init);
    });
    const user = userEvent.setup();
    render(<App />);
    const selectStay = async () => {
      await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
      await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
      await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
      await user.click(await screen.findByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
      await user.click(await screen.findByRole("button", { name: "Đặt phòng Deluxe Ocean" }));
      await screen.findByRole("heading", { name: "Vinpearl Beachfront Nha Trang", level: 1 });
      await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
    };
    await selectStay();
    await openGuestRoom(user);
    await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
    await user.type(screen.getByLabelText("Yêu cầu đặc biệt"), "Nhận phòng muộn");
    await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
    await user.click(screen.getByRole("button", { name: "Tìm phòng" }));
    await selectStay();
    await user.click(screen.getByRole("button", { name: "Đặt phòng của tôi" }));
    await user.click(await screen.findByRole("button", { name: "Mở bản nháp 1" }));
    expect(await screen.findByRole("heading", { name: "Vinpearl Beachfront Nha Trang", level: 1 })).toBeVisible();
    await openGuestRoom(user);
    expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
    expect(screen.getByLabelText("Yêu cầu đặc biệt")).toHaveValue("Nhận phòng muộn");
    expect(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i })).toBeChecked();
    await openGuestRoom(user);
    await user.type(screen.getByLabelText("Tên khách · Phòng 1"), "An");
    await user.type(screen.getByLabelText("Email · Phòng 1"), "an@example.com");
    await user.type(screen.getByLabelText("Điện thoại · Phòng 1"), "0912345678");
    await user.type(screen.getByLabelText("Họ khách · Phòng 1 · Khách 2"), "Tran");
    await user.type(screen.getByLabelText("Tên khách · Phòng 1 · Khách 2"), "Binh");
    await user.type(screen.getByLabelText("Email · Phòng 1 · Khách 2"), "binh@example.com");
    await user.type(screen.getByLabelText("Điện thoại · Phòng 1 · Khách 2"), "0912345679");
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
    await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
    expect(await screen.findByRole("heading", { name: "Đặt phòng đã xác nhận" })).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Đặt phòng của tôi" })[0]!);
    await user.click(await screen.findByRole("button", { name: "Mở bản nháp 1" }));
    expect(await screen.findByRole("heading", { name: "Vinpearl Beachfront Nha Trang", level: 1 })).toBeVisible();
  });

  test("restores an unbooked stay and its guest details after reload", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (String(url) !== "/api/availability/detail") return response;
      const payload = await response.json();
      const adults = JSON.parse(String(init?.body)).rooms[0].adults;
      return json({ data: { ...payload.data, maxOccupancy: 3, total: adults === 3 ? 6000000 : 4900000 } });
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    await user.click(await screen.findByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
    await user.click(await screen.findByRole("button", { name: "Đặt phòng Deluxe Ocean" }));
    await user.click(await screen.findByRole("button", { name: "Thêm khách vào phòng 1" }));
    await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(3));
    await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
    await openGuestRoom(user);
    await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
    await user.type(screen.getByLabelText("Tên khách · Phòng 1 · Khách 3"), "Chi");
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
    await user.type(screen.getByLabelText("Yêu cầu đặc biệt"), "Giường phụ");
    await waitFor(() => expect(localStorage.getItem("nt-journey-drafts:admin-1")).toContain("Giường phụ"));
    cleanup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Đặt phòng của tôi" }));
    await user.click(await screen.findByRole("button", { name: "Mở bản nháp 1" }));
    await openGuestRoom(user);
    expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
    expect(screen.getByLabelText("Tên khách · Phòng 1 · Khách 3")).toHaveValue("Chi");
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
    expect(screen.getByRole("button", { name: "Thông tin khách · Phòng 1" })).toHaveAttribute("title", expect.stringContaining("3/3 khách"));
    expect(screen.getByLabelText("Yêu cầu đặc biệt")).toHaveValue("Giường phụ");
  });

  test("keeps the room-list capacity when the detail quote omits it", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const response = await original(url, init);
      if (String(url) !== "/api/availability/rooms") return response;
      const payload = await response.json();
      return json({ data: payload.data.map((room: Record<string, unknown>) => ({ ...room, maxOccupancy: 8 })) });
    });
    const user = await searchFor("Nha Trang");
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    expect(screen.getByText("Tối đa 8 khách/phòng")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
    await user.click(screen.getByRole("button", { name: "Đặt phòng Deluxe Ocean" }));
    expect(await screen.findByText(/2\/8 khách/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 1" }));
    await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(3));
  });

  test("old booking records no longer offer hotel journey actions", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    const journeyId = "11111111-1111-4111-8111-111111111111";
    const request = { requestId: "22222222-2222-4222-8222-222222222222", journeyId, journeyLeg: 1, destination: "Nha Trang",
      arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 1, children: 0, infants: 0 }],
      propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1", expectedTotal: 4900000, currency: "VND", guests: [], roomGuests: [], notes: "", acceptedPolicies: true };
    const first = { id: request.requestId, reference: `NT-${request.requestId}`, request, status: "confirmed", mode: "mock", createdAt: "2099-01-01",
      propertyName: "Hotel One", roomTypeName: "Deluxe", ratePlanName: "Breakfast", total: 4900000, currency: "VND", reservations: [{ id: "res1", confirmationNumber: "A", status: "Reserved" }] };
    const second = { ...first, id: "33333333-3333-4333-8333-333333333333", propertyName: "Hotel Two", request: { ...request, requestId: "33333333-3333-4333-8333-333333333333", journeyLeg: 2 } };
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === "/api/bookings") return json({ data: [first] });
      if (url === `/api/journeys/${journeyId}/bookings`) return json({ data: [first, second] });
      return original(url, init);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Đặt phòng của tôi" }));
    await user.click(await screen.findByRole("button", { name: "Xem đặt phòng" }));
    await screen.findByRole("heading", { name: "Đặt phòng đã xác nhận" });
    expect(screen.queryByRole("button", { name: "Thêm chặng" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mã hành trình/)).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/journeys/"))).toBe(false);
  });

  test("changing search dates clears old room choices", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    await screen.findByText("Deluxe Ocean");
    await user.clear(screen.getByLabelText("Ngày nhận phòng"));
    expect(screen.queryByText("Deluxe Ocean")).not.toBeInTheDocument();
  });
  test("login is required before staff can search", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => json({ error: { code: "AUTH_REQUIRED", message: "Vui lòng đăng nhập" } }, 401));
    vi.mocked(fetch).mockImplementationOnce(() => json({ data: { profile: staff } }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText("Email"), "staff@nttravel.vn");
    await user.type(screen.getByLabelText("Mật khẩu"), "temporary-password");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));

    expect(await screen.findByRole("heading", { name: "Tìm phòng" })).toBeVisible();
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
    await screen.findByRole("heading", { name: "Tìm phòng" });
    await user.type(screen.getByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    expect(await screen.findByText("Giá net / phòng / đêm")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
    await user.click(await screen.findByRole("button", { name: /xem giá chi tiết deluxe ocean/i }));

    expect(await screen.findByRole("heading", { name: "Chi tiết giá net" })).toBeVisible();
    expect(screen.getAllByText("Giá net / phòng / đêm")).toHaveLength(2);
    expect(screen.getAllByText(/4\.900\.000/).length).toBeGreaterThan(0);
    expect(screen.getByText("Miễn phí hủy trước 3 ngày.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Tiếp tục đặt phòng" })).toBeVisible();
  });

  test("selects two room categories and shows each unit price before booking", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (url === "/api/availability/hotels") return json({ data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", imageUrl: "https://example.com/hotel.jpg", quantity: 4, fromPrice: 2450000, currency: "VND" }] });
      if (url === "/api/availability/rooms") return json({ data: [
        { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Breakfast", quantity: 4, total: 4900000, average: 2450000, currency: "VND", maxOccupancy: 8 },
        { propertyId: "p1", roomTypeId: "r2", roomTypeName: "Suite", ratePlanId: "rate2", ratePlanName: "Flexible", quantity: 2, total: 7000000, average: 3500000, currency: "VND", maxOccupancy: 4 },
      ] });
      if (url === "/api/availability/detail") {
        const query = JSON.parse(String(init?.body));
        const suite = query.roomTypeId === "r2";
        return json({ data: { propertyId: "p1", roomTypeId: query.roomTypeId, ratePlanId: query.ratePlanId,
          roomTypeName: suite ? "Suite" : "Deluxe Ocean", ratePlanName: suite ? "Flexible" : "Breakfast",
          quantity: suite ? 2 : 4, total: suite ? 7000000 : 4900000, average: suite ? 3500000 : 2450000,
          currency: "VND", dailyRates: [], policies: [] } });
      }
      return original(url, init);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/availability/hotels")?.[1]?.body)).rooms).toHaveLength(1);
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));
    expect(await screen.findByRole("table", { name: "Hạng phòng tại Vinpearl Beachfront Nha Trang" })).toBeVisible();
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/availability/rooms")?.[1]?.body)).rooms).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
    await user.click(screen.getByRole("button", { name: "Chương trình giá Suite" }));
    await user.click(await screen.findByRole("button", { name: "Chọn Deluxe Ocean" }));
    expect(screen.getByLabelText("Số phòng Deluxe Ocean")).toHaveValue(1);
    await user.click(screen.getByRole("button", { name: "Chọn Suite" }));
    const sidebar = screen.getByRole("complementary", { name: "Hạng phòng đã chọn" });
    const selectedRooms = within(sidebar).getAllByRole("listitem");
    expect(selectedRooms[0]).toHaveTextContent(/Deluxe Ocean.*4\.900\.000/);
    expect(selectedRooms[1]).toHaveTextContent(/Suite.*7\.000\.000/);
    expect(screen.getByText(/11\.900\.000/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Đặt phòng Deluxe Ocean" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Xem giá chi tiết Deluxe Ocean" }));
    await user.click(await screen.findByRole("button", { name: "Tiếp tục đặt phòng" }));
    expect(await screen.findByRole("heading", { name: "Vinpearl Beachfront Nha Trang", level: 1 })).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Xác nhận phòng" }));
    const priceLines = within(screen.getByRole("list", { name: "Giá từng phòng" })).getAllByRole("listitem");
    expect(priceLines[0]).toHaveTextContent(/Deluxe Ocean.*4\.900\.000/);
    expect(priceLines[1]).toHaveTextContent(/Suite.*7\.000\.000/);
    const guestInformation = within(screen.getByRole("region", { name: "Thông tin khách trong từng phòng" }));
    expect(guestInformation.getByRole("button", { name: "Thông tin khách · Phòng 1" })).toHaveAttribute("title", expect.stringContaining("2/8 khách"));
    expect(guestInformation.getByRole("button", { name: "Thông tin khách · Phòng 2" })).toHaveAttribute("title", expect.stringContaining("2/4 khách"));
  });

  test("a rate plan without upstream tax shows a dash, never zero", async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ data: { profile: admin } });
      if (url === "/api/availability/hotels") return json({ data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", quantity: 4, fromPrice: 2450000, currency: "VND" }] });
      if (url === "/api/availability/rooms") return json({ data: [{ propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Chỉ phòng", quantity: 4, total: 4900000, average: 2450000, currency: "VND" }] });
      if (url === "/api/availability/detail") return json({ data: { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe Ocean", ratePlanId: "rate1", ratePlanName: "Chỉ phòng", quantity: 0, total: 4900000, average: 2450000, currency: "VND", dailyRates: [{ date: "2026-07-23", amount: 2450000 }], policies: [] } });
      return json({ data: [] });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Tìm phòng" });
    await user.type(screen.getByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));

    await user.click(await screen.findByRole("button", { name: "Chương trình giá Deluxe Ocean" }));
    expect(await screen.findByText("Thuế: chưa có dữ liệu")).toBeVisible();

    await user.click(await screen.findByRole("button", { name: /xem giá chi tiết deluxe ocean/i }));

    expect(await screen.findByText("CloudHMS không trả dữ liệu thuế cho hạng phòng này.")).toBeVisible();
    expect(screen.queryByText("0 ₫")).not.toBeInTheDocument();
  });

  test("a hotel without room rates explains why nothing appeared", async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ data: { profile: admin } });
      if (url === "/api/availability/hotels") return json({ data: [{ id: "p1", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", quantity: 4, fromPrice: 2450000, currency: "VND" }] });
      if (url === "/api/availability/rooms") return json({ data: [] });
      return json({ data: [] });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Tìm phòng" });
    await user.type(screen.getByLabelText("Điểm đến hoặc khách sạn"), "Nha Trang");
    await user.click(screen.getByRole("button", { name: "Tìm khách sạn" }));
    await user.click(await screen.findByRole("button", { name: /xem phòng tại vinpearl beachfront/i }));

    expect(await screen.findByText(/chưa có hạng phòng khả dụng/i)).toBeVisible();
  });

  test("a failing session check is reported instead of looking like a logout", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Dịch vụ tạm thời không khả dụng" } }, 503));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Đăng nhập Bedbank" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Dịch vụ tạm thời không khả dụng");
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

  test("booking navigation is visible to staff", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Tìm phòng" });
    expect(screen.queryByText("Allotment")).not.toBeInTheDocument();
    expect(screen.queryByText("Đơn đặt")).not.toBeInTheDocument();
    expect(screen.queryByText("Booking của tôi")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đặt phòng của tôi" })).toBeVisible();
  });
});
