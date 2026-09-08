import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { BookingCheckout, type BookingSelection } from "./Booking";

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
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Tạo đặt phòng" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.getByRole("button", { name: "Tạo đặt phòng" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Kiểm tra trạng thái đơn" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: selection.requestId, status: "created" }));
  expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  expect(fetcher).toHaveBeenLastCalledWith(`/api/bookings/${selection.requestId}`, expect.not.objectContaining({ method: "POST" }));
});
