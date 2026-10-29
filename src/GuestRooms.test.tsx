import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BookingCheckout, type BookingSelection } from "./Booking";

afterEach(() => vi.unstubAllGlobals());
const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
const blank = { firstName: "", lastName: "", country: "", nationality: "", email: "", phoneNumber: "" };
const detail = { propertyId: "p1", roomTypeId: "r1", roomTypeName: "Deluxe", ratePlanId: "rate", ratePlanName: "Breakfast", maxOccupancy: 3, quantity: 4, total: 4000000, average: 2000000, currency: "VND", dailyRates: [], policies: [] };
const selection: BookingSelection = { requestId: "22222222-2222-4222-8222-222222222222", propertyName: "Hotel", detail, search: { destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", rooms: [{ adults: 1, children: 0, infants: 0 }, { adults: 1, children: 0, infants: 0 }] } };

test("expands a room inline, switches rooms and preserves partial drafts when collapsed", async () => {
  const user = userEvent.setup();
  const onDraftChange = vi.fn();
  render(<BookingCheckout selection={selection} initialDraft={{ step: "guests", roomGuests: [[blank], [blank]] }} onCreated={vi.fn()} onBack={vi.fn()} onDraftChange={onDraftChange} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Họ khách · Phòng 1")).not.toBeInTheDocument();
  const second = screen.getByRole("button", { name: "Thông tin khách · Phòng 2" });
  expect(second).toHaveTextContent("0/1 khách đã điền");
  await user.click(second);
  const panel = screen.getByRole("region", { name: "Thông tin khách · Phòng 2" });
  expect(within(panel).getByLabelText("Họ khách · Phòng 2")).toHaveFocus();
  expect(second).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(panel.closest(".checkout-main")).not.toBeNull();
  expect(document.querySelector("form form")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
  await user.type(screen.getByLabelText("Họ khách · Phòng 2"), "Tran");
  await user.click(second);
  expect(screen.queryByRole("region", { name: "Thông tin khách · Phòng 2" })).not.toBeInTheDocument();
  expect(second).toHaveAttribute("aria-expanded", "false");
  expect(second).toHaveFocus();
  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ roomGuests: [[blank], [{ ...blank, lastName: "Tran" }]] }));
  await user.click(second);
  expect(screen.getByLabelText("Họ khách · Phòng 2")).toHaveValue("Tran");
  await user.click(screen.getByRole("button", { name: "Thông tin khách · Phòng 1" }));
  expect(screen.queryByLabelText("Họ khách · Phòng 2")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Họ khách · Phòng 1")).toHaveValue("");
});

test("validates closed rooms before creating and opens the first invalid guest field", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const onCreated = vi.fn();
  render(<BookingCheckout selection={selection} initialDraft={{ step: "guests", accepted: true, roomGuests: [[guest], [{ ...guest, email: "bad", phoneNumber: "abcdefghi" }]] }} onCreated={onCreated} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(screen.getByRole("region", { name: "Thông tin khách · Phòng 2" })).toBeVisible();
  expect(screen.getByLabelText("Email · Phòng 2")).toHaveFocus();
  expect(screen.getByLabelText("Email · Phòng 2")).toHaveAttribute("aria-invalid", "true");
  expect(fetcher).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("Email · Phòng 2"));
  await user.type(screen.getByLabelText("Email · Phòng 2"), "binh@example.com");
  await user.click(screen.getByRole("button", { name: "Lưu và đóng" }));
  expect(screen.getByLabelText("Điện thoại · Phòng 2")).toHaveFocus();
  await user.clear(screen.getByLabelText("Điện thoại · Phòng 2"));
  await user.type(screen.getByLabelText("Điện thoại · Phòng 2"), "0987654321");
  await user.click(screen.getByRole("button", { name: "Lưu và đóng" }));
  expect(screen.queryByRole("region", { name: "Thông tin khách · Phòng 2" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thông tin khách · Phòng 2" })).toHaveTextContent("1/1 khách đã điền");
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  const input = JSON.parse(String(fetcher.mock.calls[0]![1].body));
  expect(input.roomGuests).toEqual([[guest], [{ ...guest, email: "binh@example.com", phoneNumber: "0987654321" }]]);
  expect(input.expectedTotal).toBe(8000000);
});


test("validates an already open room on every create attempt without creating from the editor form", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<BookingCheckout selection={selection} initialDraft={{ step: "guests", accepted: true, roomGuests: [[guest], [{ ...guest, email: "bad" }]] }} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Thông tin khách · Phòng 2" }));
  expect(screen.getByLabelText("Họ khách · Phòng 2")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(screen.getByLabelText("Email · Phòng 2")).toHaveFocus();
  expect(screen.getByLabelText("Email · Phòng 2")).toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(screen.getByLabelText("Email · Phòng 2")).toHaveFocus();
  expect(fetcher).not.toHaveBeenCalled();
});

test("requires country and nationality but completes and books a room with no email or phone", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: selection.requestId, status: "created" } }), { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  const occupant = { firstName: "An", lastName: "Nguyen", country: "", nationality: "", email: "", phoneNumber: "" };
  render(<BookingCheckout selection={{ ...selection, search: { ...selection.search, rooms: [selection.search.rooms[0]!] } }} initialDraft={{ step: "guests", accepted: true, roomGuests: [[occupant]] }} onCreated={vi.fn()} onBack={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(screen.getByLabelText("Quốc gia · Phòng 1")).toHaveFocus();
  expect(screen.getByLabelText("Quốc gia · Phòng 1")).toBeRequired();
  expect(screen.getByLabelText("Quốc tịch · Phòng 1")).toBeRequired();
  expect(screen.getByLabelText("Email · Phòng 1")).not.toBeRequired();
  expect(screen.getByLabelText("Điện thoại · Phòng 1")).not.toBeRequired();
  expect(fetcher).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText("Quốc gia · Phòng 1"), "VN");
  await user.click(screen.getByRole("button", { name: "Lưu và đóng" }));
  expect(screen.getByLabelText("Quốc tịch · Phòng 1")).toHaveFocus();
  await user.selectOptions(screen.getByLabelText("Quốc tịch · Phòng 1"), "US");
  await user.click(screen.getByRole("button", { name: "Lưu và đóng" }));
  expect(screen.getByRole("button", { name: "Thông tin khách · Phòng 1" })).toHaveAttribute("data-complete", "true");
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1].body)).roomGuests).toEqual([[{ ...occupant, country: "VN", nationality: "US" }]]);
});

test("keeps legacy draft names and contacts but requires missing country fields to be completed", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const legacy = JSON.parse(JSON.stringify({ firstName: "An", lastName: "Nguyen", email: "an@example.com", phoneNumber: "0912345678" }));
  render(<BookingCheckout selection={selection} initialDraft={{ step: "guests", accepted: true, roomGuests: [[legacy], [guest]] }} onCreated={vi.fn()} onBack={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Thông tin khách · Phòng 1" })).toHaveAttribute("data-complete", "false");
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(screen.getByLabelText("Quốc gia · Phòng 1")).toHaveFocus();
  expect(screen.getByLabelText("Quốc gia · Phòng 1")).toHaveValue("");
  expect(screen.getByLabelText("Quốc tịch · Phòng 1")).toHaveValue("");
  expect(screen.getByLabelText("Tên khách · Phòng 1")).toHaveValue("An");
  expect(screen.getByLabelText("Email · Phòng 1")).toHaveValue("an@example.com");
  expect(fetcher).not.toHaveBeenCalled();
});
