import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BookingCheckout, type BookingDraftFields, type BookingSelection } from "./Booking";
import { stayDates } from "../shared/roomStays";
import { closeGuestRoom, openGuestRoom } from "./test/guestRooms";

afterEach(() => vi.unstubAllGlobals());
const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
const rate = (roomTypeId: string, average: number) => ({ propertyId: "p1", roomTypeId, roomTypeName: roomTypeId, ratePlanId: "rate", ratePlanName: "Rate", allotmentId: "agent", allotmentName: "Agent", quantity: 5, maxOccupancy: 4, total: average * 2, average, currency: "VND", dailyRates: [], policies: [] });
const rates = [rate("A", 2000000), rate("B", 3000000), rate("C", 1000000)];
function fixture(unavailable = false, stock = 5) {
  const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Hotel", detail: rates[0]!, search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 2, children: 0, infants: 0 }, { adults: 1, children: 0, infants: 0 }] }, items: [{ detail: rates[0]!, quantity: 1 }, { detail: rates[2]!, quantity: 1 }] };
  const draft: BookingDraftFields = { step: "guests", accepted: true, roomGuests: [[guest, guest], [guest]], roomStays: [
    [{ arrivalDate: "2099-06-01", departureDate: "2099-06-02", detail: { ...rates[0]!, total: 2000000 } }, { arrivalDate: "2099-06-02", departureDate: "2099-06-03", detail: { ...rates[1]!, total: 3000000 } }],
    [{ arrivalDate: "2099-06-01", departureDate: "2099-06-03", detail: rates[2]! }],
  ] };
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const query = JSON.parse(String(init.body));
    if (url === "/api/availability/rooms") return new Response(JSON.stringify({ data: (unavailable ? rates.slice(0, 2) : rates).map((item) => ({ ...item, quantity: stock })) }), { status: 200 });
    if (url === "/api/availability/detail") {
      const chosen = rates.find((item) => item.roomTypeId === query.roomTypeId)!;
      const dates = stayDates(query.arrivalDate, query.departureDate);
      return new Response(JSON.stringify({ data: { ...chosen, quantity: stock, total: chosen.average * dates.length, dailyRates: dates.map((date) => ({ date, amount: chosen.average })) } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { selection, draft, fetcher };
}
async function editDates(user: ReturnType<typeof userEvent.setup>, arrival = "2099-06-02", departure = "2099-06-05") {
  fireEvent.change(screen.getByLabelText("Ngày nhận phòng"), { target: { value: arrival } });
  fireEvent.change(screen.getByLabelText("Ngày trả phòng"), { target: { value: departure } });
  await user.click(screen.getByRole("button", { name: "Áp dụng ngày" }));
}

test("edits dates for all rooms, preserves nightly code order and guests, and restores the new dates", async () => {
  const { selection, draft, fetcher } = fixture();
  const user = userEvent.setup();
  const onDraftChange = vi.fn();
  const view = render(<BookingCheckout selection={selection} initialDraft={draft} onDraftChange={onDraftChange} onCreated={vi.fn()} onBack={vi.fn()} />);
  await editDates(user);
  const days = screen.getByRole("list", { name: "Giá từng ngày · Phòng 1" });
  await waitFor(() => expect(within(days).getAllByRole("listitem")).toHaveLength(3));
  expect(Array.from(days.querySelectorAll("time")).map((time) => time.dateTime)).toEqual(["2099-06-02", "2099-06-03", "2099-06-04"]);
  expect(Array.from(days.querySelectorAll(".configuration-day-program > strong")).map((item) => item.textContent)).toEqual(["A", "B", "B"]);
  await openGuestRoom(user, 1);
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("Nguyen");
  await closeGuestRoom(user);
  await openGuestRoom(user, 2);
  expect(screen.getByLabelText("Họ khách · Phòng 2")).toHaveValue("Nguyen");
  await closeGuestRoom(user);
  expect(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i })).not.toBeChecked();
  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ dates: { arrivalDate: "2099-06-02", departureDate: "2099-06-05" } }));
  await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  const posted = JSON.parse(String(fetcher.mock.calls.find(([url]) => url === "/api/bookings")![1].body));
  expect(posted).toMatchObject({ arrivalDate: "2099-06-02", departureDate: "2099-06-05", expectedTotal: 11000000, roomStaySelections: [
    [{ roomTypeId: "A", arrivalDate: "2099-06-02", departureDate: "2099-06-03" }, { roomTypeId: "B", arrivalDate: "2099-06-03", departureDate: "2099-06-05" }],
    [{ roomTypeId: "C", arrivalDate: "2099-06-02", departureDate: "2099-06-05" }],
  ] });
  expect(posted.roomGuests).toEqual([[guest, guest], [guest]]);
  const saved = onDraftChange.mock.lastCall![0];
  view.unmount();
  render(<BookingCheckout selection={selection} initialDraft={saved} onCreated={vi.fn()} onBack={vi.fn()} />);
  expect(screen.getByLabelText("Ngày nhận phòng")).toHaveValue("2099-06-02");
  expect(screen.getByLabelText("Ngày trả phòng")).toHaveValue("2099-06-05");
  expect(within(screen.getByRole("list", { name: "Giá từng ngày · Phòng 1" })).getAllByRole("listitem")).toHaveLength(3);
});

test("keeps every original room and quote if a code is unavailable, and blocks booking unapplied dates", async () => {
  const { selection, draft, fetcher } = fixture(true);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} initialDraft={draft} onCreated={vi.fn()} onBack={vi.fn()} />);
  await editDates(user);
  expect(await screen.findByRole("alert")).toHaveTextContent(/không còn|không khả dụng/);
  expect(within(screen.getByRole("list", { name: "Giá từng ngày · Phòng 1" })).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Tạo đặt phòng" })).toBeDisabled();
  fireEvent.submit(screen.getByRole("button", { name: "Tạo đặt phòng" }).closest("form")!);
  expect(fetcher.mock.calls.some(([url]) => url === "/api/bookings")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Hủy thay đổi ngày" }));
  expect(screen.getByLabelText("Ngày nhận phòng")).toHaveValue("2099-06-01");
  expect(screen.getByRole("button", { name: "Tạo đặt phòng" })).toBeEnabled();
});

test("shortens the itinerary and books only the remaining nights with the updated dates", async () => {
  const { selection, draft, fetcher } = fixture();
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} initialDraft={draft} onCreated={vi.fn()} onBack={vi.fn()} />);
  await editDates(user, "2099-06-02", "2099-06-03");
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Giá từng ngày · Phòng 1" })).getAllByRole("listitem")).toHaveLength(1));
  expect(screen.getByRole("list", { name: "Giá từng ngày · Phòng 1" }).querySelector(".configuration-day-program > strong")).toHaveTextContent("A");
  await user.click(screen.getByRole("checkbox", { name: /đã đọc.*chính sách/i }));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  const posted = JSON.parse(String(fetcher.mock.calls.find(([url]) => url === "/api/bookings")![1].body));
  expect(posted).toMatchObject({ arrivalDate: "2099-06-02", departureDate: "2099-06-03", expectedTotal: 3000000, roomSelections: [{ roomTypeId: "A", expectedUnitTotal: 2000000 }, { roomTypeId: "C", expectedUnitTotal: 1000000 }] });
  expect(posted.roomStaySelections).toBeUndefined();
});

test("rejects dates when the combined rooms exceed the shared allotment inventory", async () => {
  const { selection, draft } = fixture(false, 1);
  const user = userEvent.setup();
  render(<BookingCheckout selection={selection} initialDraft={draft} onCreated={vi.fn()} onBack={vi.fn()} />);
  await editDates(user);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không còn đủ phòng");
  expect(within(screen.getByRole("list", { name: "Giá từng ngày · Phòng 1" })).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Tạo đặt phòng" })).toBeDisabled();
});

test.each([["2099-06-03", "2099-06-03"], ["2099-06-05", "2099-06-04"], ["2099-06-01", "2099-07-03"], ["2020-06-01", "2020-06-03"]])("rejects invalid stay dates %s to %s before fetching", async (arrivalDate, departureDate) => {
  const { selection, draft, fetcher } = fixture();
  render(<BookingCheckout selection={selection} initialDraft={draft} onCreated={vi.fn()} onBack={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Ngày nhận phòng"), { target: { value: arrivalDate } });
  fireEvent.change(screen.getByLabelText("Ngày trả phòng"), { target: { value: departureDate } });
  fireEvent.submit(screen.getByRole("form", { name: "Ngày lưu trú" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
});
