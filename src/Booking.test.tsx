import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BookingCheckout, BookingDetails, BookingsList, type BookingSelection } from "./Booking";
import { closeGuestRoom, fillRequiredGuestCountries, openGuestRoom } from "./test/guestRooms";

afterEach(() => vi.unstubAllGlobals());
test("restores the lowest capacity and total from dated codes rather than the initial room", async () => {
  const user = userEvent.setup();
  const first = { propertyId: "p1", roomTypeId: "suite", ratePlanId: "rate", roomTypeName: "Suite", ratePlanName: "Rate", quantity: 4, maxOccupancy: 4, total: 4000000, average: 4000000, currency: "VND", dailyRates: [], policies: [] };
  const second = { ...first, roomTypeId: "deluxe", roomTypeName: "Deluxe", maxOccupancy: 2, total: 2000000 };
  const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Hotel", detail: { ...first, total: 8000000 }, search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 3, children: 0, infants: 0 }] } };
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<BookingCheckout selection={selection} initialDraft={{ step: "guests", accepted: true, roomGuests: [[guest, guest, guest]], roomStays: [[
    { arrivalDate: "2099-06-01", departureDate: "2099-06-02", detail: first },
    { arrivalDate: "2099-06-02", departureDate: "2099-06-03", detail: second },
  ]] }} onCreated={vi.fn()} onBack={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 1" })).toBeDisabled();
  expect(within(screen.getByRole("list", { name: "Giá từng phòng" })).getByRole("listitem")).toHaveTextContent(/6\.000\.000/);
  await openGuestRoom(user);
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  expect(screen.getByRole("button", { name: "Tạo đặt phòng" })).toBeDisabled();
  fireEvent.submit(screen.getByRole("button", { name: "Tạo đặt phòng" }).closest("form")!);
  expect(fetcher).not.toHaveBeenCalled();
});

test("changes the code for one night, preserves the same guests and submits dated room selections", async () => {
  const first = { propertyId: "p1", roomTypeId: "r1", roomTypeCode: "DLX", ratePlanId: "breakfast", roomTypeName: "Deluxe", ratePlanName: "Breakfast", allotmentId: "agent", allotmentName: "Agent", quantity: 2, maxOccupancy: 3, total: 4000000, average: 2000000, currency: "VND", dailyRates: [{ date: "2099-06-01", amount: 2000000 }, { date: "2099-06-02", amount: 2000000 }], policies: [] };
  const second = { ...first, roomTypeId: "r2", roomTypeCode: "STE", roomTypeName: "Suite", allotmentId: "summer", allotmentName: "Summer", maxOccupancy: 2, total: 3000000, average: 3000000 };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel", detail: first,
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] } };
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/availability/rooms") return new Response(JSON.stringify({ data: [{ ...first, total: 2000000 }, second] }), { status: 200 });
    if (url === "/api/availability/detail") {
      const query = JSON.parse(String(init.body));
      const rate = query.roomTypeId === "r2" ? second : first;
      return new Response(JSON.stringify({ data: { ...rate, total: rate.average, dailyRates: [{ date: query.arrivalDate, amount: rate.average }] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 });
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  await openGuestRoom(user);
  await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  const days = within(screen.getByRole("list", { name: "Giá từng ngày · Phòng 1" })).getAllByRole("listitem");
  await user.click(within(days[1]!).getByRole("button", { name: "Đổi mã phòng / dịch vụ" }));
  await user.selectOptions(await screen.findByLabelText("Mã phòng / dịch vụ · Phòng 1 · 2099-06-02"), "r2");
  await user.click(within(days[1]!).getByRole("button", { name: "Áp dụng cho đêm này" }));
  await waitFor(() => expect(within(days[1]!).getByText(/STE · Suite/)).toBeVisible());
  expect(days[0]).toHaveTextContent("DLX · Deluxe");
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 1" })).toBeDisabled();
  await openGuestRoom(user);
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
  const quotes = fetcher.mock.calls.filter(([url]) => url === "/api/availability/detail").map(([, init]) => JSON.parse(String(init.body)));
  expect(quotes).toMatchObject([{ arrivalDate: "2099-06-01", departureDate: "2099-06-02", roomTypeId: "r1" }, { arrivalDate: "2099-06-02", departureDate: "2099-06-03", roomTypeId: "r2" }]);
  for (const guest of [1, 2]) {
    const suffix = ` · Phòng 1${guest > 1 ? ` · Khách ${guest}` : ""}`;
    fireEvent.change(screen.getByLabelText(`Họ khách${suffix}`), { target: { value: "Nguyen" } });
    fireEvent.change(screen.getByLabelText(`Tên khách${suffix}`), { target: { value: "An" } });
    fireEvent.change(screen.getByLabelText(`Email${suffix}`), { target: { value: "an@example.com" } });
    fireEvent.change(screen.getByLabelText(`Điện thoại${suffix}`), { target: { value: "0912345678" } });
  }
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  const posted = JSON.parse(String(fetcher.mock.calls.find(([url]) => url === "/api/bookings")![1].body));
  expect(posted).toMatchObject({ expectedTotal: 5000000, rooms: [{ adults: 2 }], roomStaySelections: [[
    { arrivalDate: "2099-06-01", departureDate: "2099-06-02", roomTypeId: "r1", allotmentId: "agent", expectedUnitTotal: 2000000 },
    { arrivalDate: "2099-06-02", departureDate: "2099-06-03", roomTypeId: "r2", allotmentId: "summer", expectedUnitTotal: 3000000 },
  ]] });
  expect(posted.roomGuests).toHaveLength(1);
  expect(posted.roomGuests[0]).toHaveLength(2);
});

test("keeps entered guests in the room dialog and blocks creation while repricing an edit", async () => {
  const detail = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "breakfast", roomTypeName: "Deluxe", ratePlanName: "Breakfast", allotmentId: "agent", allotmentName: "Agent", quantity: 4, maxOccupancy: 3, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel", detail,
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] } };
  let resolveQuote!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveQuote = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} initialDraft={{ step: "guests", roomGuests: [[guest, guest]], accepted: true }} onCreated={vi.fn()} onBack={vi.fn()} />);
  await openGuestRoom(user);
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 1" }));
  expect(screen.getByRole("button", { name: "Tạo đặt phòng" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Thông tin khách · Phòng 1" })).toBeDisabled();
  resolveQuote(new Response(JSON.stringify({ data: { ...detail, total: 5000000 } }), { status: 200 }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(3));
  await openGuestRoom(user);
  expect(await screen.findByLabelText("Họ khách · Phòng 1 · Khách 3")).toHaveValue("");
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
  expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(3);
  expect(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i })).not.toBeChecked();
  expect(within(screen.getByRole("list", { name: "Giá từng phòng" })).getByRole("listitem")).toHaveTextContent(/5\.000\.000/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("configures rooms in separate tabs and collects guests only after confirming rooms", async () => {
  const first = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "breakfast", roomTypeName: "Deluxe", ratePlanName: "Breakfast", allotmentId: "agent", allotmentName: "Agent", quantity: 4, maxOccupancy: 2, total: 4000000, average: 2000000, currency: "VND", dailyRates: [{ date: "2099-06-01", amount: 1000000 }, { date: "2099-06-02", amount: 3000000 }], policies: [] };
  const second = { ...first, roomTypeId: "r2", roomTypeName: "Suite", allotmentId: "summer", allotmentName: "Summer", maxOccupancy: 4 };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel", detail: first,
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }, { adults: 2, children: 0, infants: 0 }] },
    items: [{ detail: first, quantity: 1 }, { detail: second, quantity: 1 }] };
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { ...second, total: 6000000, average: 3000000, dailyRates: [{ date: "2099-06-01", amount: 2000000 }, { date: "2099-06-02", amount: 4000000 }] } }), { status: 200 })));
  vi.stubGlobal("fetch", fetcher);
  const onDraftChange = vi.fn();
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} onDraftChange={onDraftChange} onCreated={vi.fn()} onBack={vi.fn()} />);
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(screen.queryByLabelText("Họ khách · Phòng 1")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Tạo đặt phòng" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 1" })).toBeDisabled();
  screen.getByRole("tab", { name: "Phòng 1" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Phòng 2" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Phòng 2" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Suite");
  const days = screen.getByRole("list", { name: "Giá từng ngày · Phòng 2" });
  expect(within(days).getAllByRole("listitem")).toHaveLength(2);
  expect(days).toHaveTextContent(/01\/06\/2099.*1\.000\.000/);
  expect(days).toHaveTextContent(/02\/06\/2099.*3\.000\.000/);
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 2" }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 2")).toHaveValue(3));
  expect(days).toHaveTextContent(/02\/06\/2099.*4\.000\.000/);
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 2" }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 2")).toHaveValue(4));
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 2" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Tăng trẻ em · Phòng 2" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  expect(screen.getByRole("tablist", { name: "Các phòng đã chọn" })).toBeVisible();
  expect(screen.queryByLabelText("Họ khách · Phòng 1")).not.toBeInTheDocument();
  await openGuestRoom(user, 1);
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toBeVisible();
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  await openGuestRoom(user, 2);
  expect(screen.getByLabelText("Tên khách · Phòng 2 · Khách 4")).toBeVisible();
  expect(screen.queryByLabelText("Tên khách · Phòng 2 · Khách 5")).not.toBeInTheDocument();
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  expect(fetcher.mock.calls.every(([url]) => url === "/api/availability/detail")).toBe(true);
  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ step: "guests", rooms: [{ adults: 2, children: 0, infants: 0 }, { adults: 4, children: 0, infants: 0 }] }));
  await openGuestRoom(user);
  await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
  await user.click(screen.getByRole("button", { name: "Chỉnh lại phòng" }));
  await openGuestRoom(user);
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  await user.click(screen.getByRole("tab", { name: "Phòng 2" }));
  expect(screen.getByLabelText("Người lớn · Phòng 2")).toHaveValue(4);
  await user.click(screen.getByRole("button", { name: "Giảm người lớn · Phòng 2" }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 2")).toHaveValue(3));
  await openGuestRoom(user, 2);
  expect(screen.queryByLabelText("Tên khách · Phòng 2 · Khách 4")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Tên khách · Phòng 2 · Khách 3")).toBeVisible();
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  expect(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i })).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  await openGuestRoom(user);
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
});

test("assigns adults, children and infants per room and requotes within its capacity", async () => {
  const detail = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "breakfast", roomTypeName: "Deluxe", ratePlanName: "Breakfast", allotmentId: "agent", quantity: 2, maxOccupancy: 3, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] }, detail };
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: detail }), { status: 200 })));
  vi.stubGlobal("fetch", fetcher);
  const onDraftChange = vi.fn();
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} onDraftChange={onDraftChange} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Giảm người lớn · Phòng 1" }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(1));
  fireEvent.change(screen.getByLabelText("Trẻ em · Phòng 1"), { target: { value: "1" } });
  await waitFor(() => expect(screen.getByLabelText("Trẻ em · Phòng 1")).toHaveValue(1));
  fireEvent.change(screen.getByLabelText("Em bé · Phòng 1"), { target: { value: "1" } });
  await waitFor(() => expect(screen.getByLabelText("Em bé · Phòng 1")).toHaveValue(1));
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 1" })).toBeDisabled();
  expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveAttribute("max", "1");
  expect(screen.getByLabelText("Trẻ em · Phòng 1")).toHaveAttribute("max", "1");
  fireEvent.change(screen.getByLabelText("Trẻ em · Phòng 1"), { target: { value: "2" } });
  expect(screen.getByLabelText("Trẻ em · Phòng 1")).toHaveValue(1);
  expect(screen.queryByLabelText("Tên khách · Phòng 1 · Khách 4")).not.toBeInTheDocument();
  expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1].body)).rooms[0])).toEqual([
    { adults: 1, children: 0, infants: 0 }, { adults: 1, children: 1, infants: 0 }, { adults: 1, children: 1, infants: 1 },
  ]);
  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ rooms: [{ adults: 1, children: 1, infants: 1 }], accepted: false }));
});

test("finalizes guest counts below the search default and submits the requoted allotment", async () => {
  const detail = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "breakfast", roomTypeName: "Deluxe", ratePlanName: "Breakfast", allotmentId: "agent", allotmentName: "Agent", quantity: 2, maxOccupancy: 3, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] }, detail };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...detail, total: 3500000 } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} initialDraft={{ roomGuests: [[guest, guest]], accepted: true }} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Giảm người lớn · Phòng 1" }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(1));
  expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toMatchObject({ allotmentId: "agent", rooms: [{ adults: 1, children: 0, infants: 0 }] });
  expect(screen.getByRole("button", { name: "Giảm người lớn · Phòng 1" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  expect(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i })).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  const posted = JSON.parse(String(fetcher.mock.calls[1]![1].body));
  expect(posted).toMatchObject({ rooms: [{ adults: 1, children: 0, infants: 0 }], expectedTotal: 3500000,
    roomSelections: [{ allotmentId: "agent", expectedUnitTotal: 3500000 }], roomGuests: [[guest]] });
});

test("checkout submits each selected allotment even when room and program IDs are identical", async () => {
  const first = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "breakfast", roomTypeName: "Deluxe", ratePlanName: "Breakfast", allotmentId: "agent", allotmentName: "Agent", quantity: 2, maxOccupancy: 3, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const second = { ...first, allotmentId: "summer", allotmentName: "Summer", total: 3500000 };
  const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 1, children: 0, infants: 0 }, { adults: 1, children: 0, infants: 0 }] },
    detail: first, items: [{ detail: first, quantity: 1 }, { detail: second, quantity: 1 }] };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} initialDraft={{ roomGuests: [[guest], [guest]], accepted: true }} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  const posted = JSON.parse(String(fetcher.mock.calls[0]![1].body));
  expect(posted.roomSelections).toEqual([
    { roomTypeId: "r1", ratePlanId: "breakfast", allotmentId: "agent", expectedUnitTotal: 4000000 },
    { roomTypeId: "r1", ratePlanId: "breakfast", allotmentId: "summer", expectedUnitTotal: 3500000 },
  ]);
});

test.each([false, true])("repricing an extra guest preserves the selected allotment (wrong quote: %s)", async (wrongAllotment) => {
  const detail = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "breakfast", roomTypeName: "Deluxe", ratePlanName: "Breakfast", allotmentId: "agent", allotmentName: "Agent", quantity: 2, maxOccupancy: 3, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 1, children: 0, infants: 0 }] }, detail };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...detail, allotmentId: wrongAllotment ? "summer" : "agent", total: 5000000 } }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} initialDraft={{ roomGuests: [[guest]] }} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 1" }));
  expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toMatchObject({ allotmentId: "agent", rooms: [{ adults: 2 }] });
  if (wrongAllotment) {
    expect(await screen.findByRole("alert")).toHaveTextContent("Hạng phòng không còn phù hợp");
    expect(screen.queryByLabelText("Tên khách · Phòng 1 · Khách 2")).not.toBeInTheDocument();
  } else {
    await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 1")).toHaveValue(2));
    await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
    await openGuestRoom(user);
    expect(await screen.findByLabelText("Tên khách · Phòng 1 · Khách 2")).toBeVisible();
    expect(screen.getByText(/Phòng 1 · Deluxe · Agent · Breakfast/)).toBeVisible();
  }
});

test("a lost create response is recovered by reading the same ID, without another POST", async () => {
  const selection: BookingSelection = {
    requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] },
    detail: { propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1", roomTypeName: "Deluxe", ratePlanName: "Breakfast", quantity: 2, total: 2000000, average: 1000000, currency: "VND", dailyRates: [], policies: [] },
  };
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const onCreated = vi.fn();
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} onCreated={onCreated} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  await openGuestRoom(user);
  await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
  await user.type(screen.getByLabelText("Tên khách · Phòng 1"), "An");
  await user.type(screen.getByLabelText("Email · Phòng 1"), "guest@example.test");
  await user.type(screen.getByLabelText("Điện thoại · Phòng 1"), "0912345678");
  await user.type(screen.getByLabelText("Họ khách · Phòng 1 · Khách 2"), "Tran");
  await user.type(screen.getByLabelText("Tên khách · Phòng 1 · Khách 2"), "Binh");
  await user.type(screen.getByLabelText("Email · Phòng 1 · Khách 2"), "binh@example.test");
  await user.type(screen.getByLabelText("Điện thoại · Phòng 1 · Khách 2"), "0912345679");
  await fillRequiredGuestCountries(user);
  await closeGuestRoom(user);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByRole("button", { name: "Tạo đặt phòng" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Kiểm tra trạng thái đơn" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: selection.requestId, status: "created" }));
  expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1].body)).roomGuests[0]).toHaveLength(2);
  expect(fetcher).toHaveBeenLastCalledWith(`/api/bookings/${selection.requestId}`, expect.not.objectContaining({ method: "POST" }));
});

test("booking details retain the price and category of each reserved room", () => {
  const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
  const request = { requestId: "22222222-2222-4222-8222-222222222222", destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03",
    propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1", rooms: [{ adults: 2, children: 0, infants: 0 }, { adults: 2, children: 0, infants: 0 }],
    expectedTotal: 9000000, currency: "VND", guests: [guest, guest], roomGuests: [[guest, guest], [guest, guest]], notes: "", acceptedPolicies: true as const };
  render(<BookingDetails initial={{ id: request.requestId, reference: "NT-1", createdAt: "2099-01-01", mode: "mock", status: "confirmed",
    propertyName: "Demo hotel", roomTypeName: "Nhiều hạng phòng", ratePlanName: "Nhiều gói giá", total: 9000000, currency: "VND", request,
    roomLines: [
      { roomTypeId: "r1", roomTypeName: "Deluxe", ratePlanId: "rate1", ratePlanName: "Breakfast", unitTotal: 4000000 },
      { roomTypeId: "r2", roomTypeName: "Suite", ratePlanId: "rate2", ratePlanName: "Flexible", unitTotal: 5000000 },
    ], reservations: [{ id: "a", confirmationNumber: "A", status: "Reserved" }, { id: "b", confirmationNumber: "B", status: "Reserved" }] }} onBack={vi.fn()} />);
  expect(screen.getByText(/Deluxe.*4\.000\.000/)).toBeVisible();
  expect(screen.getByText(/Suite.*5\.000\.000/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Khách trong từng phòng" })).toBeVisible();
  expect(screen.getAllByText(/Nguyen An.*an@example.com/)).toHaveLength(4);
});

test("checkout submits each chosen room rate and the sum of unit prices", async () => {
  const first = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1", roomTypeName: "Deluxe", ratePlanName: "Breakfast", quantity: 2, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const second = { ...first, roomTypeId: "r2", ratePlanId: "rate2", roomTypeName: "Suite", total: 5000000 };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 1, children: 0, infants: 0 }, { adults: 1, children: 0, infants: 0 }] },
    detail: first, items: [{ detail: first, quantity: 1 }, { detail: second, quantity: 1 }] };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  for (const room of [1, 2]) {
    await openGuestRoom(user, room);
    await user.type(screen.getByLabelText(`Họ khách · Phòng ${room}`), "Nguyen");
    await user.type(screen.getByLabelText(`Tên khách · Phòng ${room}`), "An");
    await user.type(screen.getByLabelText(`Email · Phòng ${room}`), `an${room}@example.com`);
    await user.type(screen.getByLabelText(`Điện thoại · Phòng ${room}`), "0912345678");
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
  }
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  const posted = JSON.parse(String(fetcher.mock.calls[0]![1].body));
  expect(posted.expectedTotal).toBe(9000000);
  expect(posted.roomSelections).toEqual([
    { roomTypeId: "r1", ratePlanId: "rate1", expectedUnitTotal: 4000000 },
    { roomTypeId: "r2", ratePlanId: "rate2", expectedUnitTotal: 5000000 },
  ]);
});

test("adds named guests per room up to that room's capacity and requotes before booking", async () => {
  const first = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1", roomTypeName: "Deluxe", ratePlanName: "Breakfast", quantity: 2, total: 4000000, average: 2000000, currency: "VND", maxOccupancy: 2, dailyRates: [], policies: [] };
  const second = { ...first, roomTypeId: "r2", ratePlanId: "rate2", roomTypeName: "Suite", total: 5000000, maxOccupancy: 4 };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }, { adults: 2, children: 0, infants: 0 }] },
    detail: first, items: [{ detail: first, quantity: 1 }, { detail: second, quantity: 1 }] };
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/availability/detail") {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: { ...second, total: body.rooms[0].adults === 3 ? 6000000 : 7000000 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 });
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} onCreated={vi.fn()} onBack={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 1" })).toBeDisabled();
  await user.click(screen.getByRole("tab", { name: "Phòng 2" }));
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 2" }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 2")).toHaveValue(3));
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 2" }));
  await waitFor(() => expect(screen.getByLabelText("Người lớn · Phòng 2")).toHaveValue(4));
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 2" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Xác nhận phòng" }));
  for (const [room, count] of [[1, 2], [2, 4]]) {
    await openGuestRoom(user, room);
    for (let guest = 1; guest <= count; guest += 1) {
      const suffix = ` · Phòng ${room}${guest > 1 ? ` · Khách ${guest}` : ""}`;
      fireEvent.change(screen.getByLabelText(`Họ khách${suffix}`), { target: { value: "Nguyen" } });
      fireEvent.change(screen.getByLabelText(`Tên khách${suffix}`), { target: { value: `An${guest}` } });
      fireEvent.change(screen.getByLabelText(`Email${suffix}`), { target: { value: `an${room}${guest}@example.com` } });
      fireEvent.change(screen.getByLabelText(`Điện thoại${suffix}`), { target: { value: "0912345678" } });
    }
    await fillRequiredGuestCountries(user);
    await closeGuestRoom(user);
  }
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === "/api/bookings")).toBe(true));
  const posted = JSON.parse(String(fetcher.mock.calls.find(([url]) => url === "/api/bookings")![1].body));
  expect(posted.rooms.map((room: { adults: number }) => room.adults)).toEqual([2, 4]);
  expect(posted.roomGuests.map((guests: unknown[]) => guests.length)).toEqual([2, 4]);
  expect(posted.roomSelections.map((room: { expectedUnitTotal: number }) => room.expectedUnitTotal)).toEqual([4000000, 7000000]);
  expect(posted.expectedTotal).toBe(11000000);
}, 15000);

test("restores room capacity for an older saved stay whose quote omitted it", async () => {
  const detail = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1", roomTypeName: "Deluxe", ratePlanName: "Breakfast", quantity: 2, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] }, detail };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ ...detail, maxOccupancy: 8 }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  render(<BookingCheckout selection={selection} initialDraft={{}} onCreated={vi.fn()} onBack={vi.fn()} />);
  expect(await screen.findByText(/2\/8 khách/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 1" })).toBeEnabled();
  expect(fetcher).toHaveBeenCalledWith("/api/availability/rooms", expect.objectContaining({ method: "POST" }));
});

test("legacy booking records show reservation details without hotel journey controls", () => {
  const request = { requestId: "22222222-2222-4222-8222-222222222222", journeyId: "11111111-1111-4111-8111-111111111111", journeyLeg: 1,
    destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1",
    rooms: [{ adults: 1, children: 0, infants: 0 }], expectedTotal: 4000000, currency: "VND", guests: [], roomGuests: [], notes: "", acceptedPolicies: true as const };
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<BookingDetails initial={{ id: request.requestId, reference: "NT-1", createdAt: "2099-01-01", mode: "mock", status: "confirmed",
    propertyName: "Hotel One", roomTypeName: "Deluxe", ratePlanName: "Breakfast", total: 4000000, currency: "VND", request,
    reservations: [{ id: "a", confirmationNumber: "A", status: "Reserved" }] }} onBack={vi.fn()} />);
  expect(screen.getByText("A")).toBeVisible();
  expect(screen.queryByText(/Mã hành trình/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Thêm chặng" })).not.toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

test("booking list opens saved room configurations as drafts", async () => {
  const detail = { propertyId: "p2", roomTypeId: "r2", ratePlanId: "rate2", roomTypeName: "Suite", ratePlanName: "Flexible", quantity: 2, total: 5000000, average: 2500000, currency: "VND", dailyRates: [], policies: [] };
  const draft: BookingSelection = { requestId: "33333333-3333-4333-8333-333333333333", propertyName: "Hotel Two",
    search: { destination: "Hà Nội", arrivalDate: "2099-06-04", departureDate: "2099-06-06", rooms: [{ adults: 1, children: 0, infants: 0 }] }, detail };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 })));
  const onOpenDraft = vi.fn();
  const user = userEvent.setup();
  render(<BookingsList onSearch={vi.fn()} onSelect={vi.fn()} drafts={[draft]} onOpenDraft={onOpenDraft} />);
  await user.click(screen.getByRole("button", { name: "Mở bản nháp 1" }));
  expect(onOpenDraft).toHaveBeenCalledWith(draft);
});
