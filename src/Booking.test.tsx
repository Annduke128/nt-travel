import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BookingCheckout, BookingDetails, type BookingSelection } from "./Booking";

afterEach(() => vi.unstubAllGlobals());
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
  await user.type(screen.getByLabelText("Họ khách · Phòng 1"), "Nguyen");
  await user.type(screen.getByLabelText("Tên khách · Phòng 1"), "An");
  await user.type(screen.getByLabelText("Email · Phòng 1"), "guest@example.test");
  await user.type(screen.getByLabelText("Điện thoại · Phòng 1"), "0912345678");
  await user.type(screen.getByLabelText("Họ khách · Phòng 1 · Khách 2"), "Tran");
  await user.type(screen.getByLabelText("Tên khách · Phòng 1 · Khách 2"), "Binh");
  await user.type(screen.getByLabelText("Email · Phòng 1 · Khách 2"), "binh@example.test");
  await user.type(screen.getByLabelText("Điện thoại · Phòng 1 · Khách 2"), "0912345679");
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
  const guest = { firstName: "An", lastName: "Nguyen", email: "an@example.com", phoneNumber: "0912345678" };
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
  for (const room of [1, 2]) {
    await user.type(screen.getByLabelText(`Họ khách · Phòng ${room}`), "Nguyen");
    await user.type(screen.getByLabelText(`Tên khách · Phòng ${room}`), "An");
    await user.type(screen.getByLabelText(`Email · Phòng ${room}`), `an${room}@example.com`);
    await user.type(screen.getByLabelText(`Điện thoại · Phòng ${room}`), "0912345678");
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
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 2" }));
  expect(await screen.findByLabelText("Tên khách · Phòng 2 · Khách 3")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Thêm khách vào phòng 2" }));
  expect(await screen.findByLabelText("Tên khách · Phòng 2 · Khách 4")).toBeVisible();
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 2" })).toBeDisabled();
  for (const [room, count] of [[1, 2], [2, 4]]) {
    for (let guest = 1; guest <= count; guest += 1) {
      const suffix = ` · Phòng ${room}${guest > 1 ? ` · Khách ${guest}` : ""}`;
      await user.type(screen.getByLabelText(`Họ khách${suffix}`), "Nguyen");
      await user.type(screen.getByLabelText(`Tên khách${suffix}`), `An${guest}`);
      await user.type(screen.getByLabelText(`Email${suffix}`), `an${room}${guest}@example.com`);
      await user.type(screen.getByLabelText(`Điện thoại${suffix}`), "0912345678");
    }
  }
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === "/api/bookings")).toBe(true));
  const posted = JSON.parse(String(fetcher.mock.calls.find(([url]) => url === "/api/bookings")![1].body));
  expect(posted.rooms.map((room: { adults: number }) => room.adults)).toEqual([2, 4]);
  expect(posted.roomGuests.map((guests: unknown[]) => guests.length)).toEqual([2, 4]);
  expect(posted.roomSelections.map((room: { expectedUnitTotal: number }) => room.expectedUnitTotal)).toEqual([4000000, 7000000]);
  expect(posted.expectedTotal).toBe(11000000);
});

test("restores room capacity for an older saved stay whose quote omitted it", async () => {
  const detail = { propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1", roomTypeName: "Deluxe", ratePlanName: "Breakfast", quantity: 2, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Demo hotel",
    search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }] }, detail };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ ...detail, maxOccupancy: 8 }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  render(<BookingCheckout selection={selection} draftLegs={[selection]} onCreated={vi.fn()} onBack={vi.fn()} />);
  expect(await screen.findByText(/2\/8 khách/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Thêm khách vào phòng 1" })).toBeEnabled();
  expect(fetcher).toHaveBeenCalledWith("/api/availability/rooms", expect.objectContaining({ method: "POST" }));
});

test("journey details list every stay and open another leg", async () => {
  const request = { requestId: "22222222-2222-4222-8222-222222222222", journeyId: "11111111-1111-4111-8111-111111111111", journeyLeg: 1,
    destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1",
    rooms: [{ adults: 1, children: 0, infants: 0 }], expectedTotal: 4000000, currency: "VND", guests: [], roomGuests: [], notes: "", acceptedPolicies: true as const };
  const first = { id: request.requestId, reference: "NT-1", createdAt: "2099-01-01", mode: "mock" as const, status: "confirmed" as const,
    propertyName: "Hotel One", roomTypeName: "Deluxe", ratePlanName: "Breakfast", total: 4000000, currency: "VND", request,
    reservations: [{ id: "a", confirmationNumber: "A", status: "Reserved" }] };
  const second = { ...first, id: "33333333-3333-4333-8333-333333333333", reference: "NT-2", propertyName: "Hotel Two",
    request: { ...request, requestId: "33333333-3333-4333-8333-333333333333", journeyLeg: 2, arrivalDate: "2099-06-04", departureDate: "2099-06-06" } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [first, second] }), { status: 200 })));
  const onSelectLeg = vi.fn();
  const user = userEvent.setup();
  render(<BookingDetails initial={first} onBack={vi.fn()} onSelectLeg={onSelectLeg} />);
  expect(await screen.findByText(/Chặng 2 · Hotel Two/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Xem chặng 2/ }));
  expect(onSelectLeg).toHaveBeenCalledWith(second);
});

test("booking details offer the next selected stay that has not been booked", async () => {
  const request = { requestId: "22222222-2222-4222-8222-222222222222", journeyId: "11111111-1111-4111-8111-111111111111", journeyLeg: 1,
    destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1",
    rooms: [{ adults: 1, children: 0, infants: 0 }], expectedTotal: 4000000, currency: "VND", guests: [], roomGuests: [], notes: "", acceptedPolicies: true as const };
  const detail = { propertyId: "p2", roomTypeId: "r2", ratePlanId: "rate2", roomTypeName: "Suite", ratePlanName: "Flexible", quantity: 2, total: 5000000, average: 2500000, currency: "VND", dailyRates: [], policies: [] };
  const draft: BookingSelection = { requestId: "33333333-3333-4333-8333-333333333333", journeyId: request.journeyId, journeyLeg: 2,
    propertyName: "Hotel Two", search: { destination: "Hà Nội", arrivalDate: "2099-06-04", departureDate: "2099-06-06", rooms: request.rooms }, detail };
  const onOpenDraft = vi.fn();
  const user = userEvent.setup();
  render(<BookingDetails initial={{ id: request.requestId, reference: "NT-1", createdAt: "2099-01-01", mode: "mock", status: "confirmed",
    propertyName: "Hotel One", roomTypeName: "Deluxe", ratePlanName: "Breakfast", total: 4000000, currency: "VND", request,
    reservations: [{ id: "a", confirmationNumber: "A", status: "Reserved" }] }} onBack={vi.fn()} pendingLegs={[draft]} onOpenDraft={onOpenDraft} />);
  await user.click(screen.getByRole("button", { name: "Tiếp tục chặng 2" }));
  expect(onOpenDraft).toHaveBeenCalledWith(draft);
});
