// @vitest-environment node
import { expect, test } from "vitest";
import { bookingCreateSchema } from "../contracts.js";
import { MockBedbankService } from "../cloudhms/mock.js";
import { MockBookingGateway } from "./mock.js";
import { BookingService } from "./service.js";
import { MemoryBookingStore } from "./store.js";
import type { BookingCreateRequest, Profile } from "../../shared/contracts.js";

const actor: Profile = { userId: "staff", email: "staff@example.com", displayName: "Staff", role: "staff", status: "active", mustChangePassword: false };
const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
const input = (): BookingCreateRequest => ({ requestId: "22222222-2222-4222-8222-222222222222", destination: "Nha Trang", arrivalDate: "2099-06-01", departureDate: "2099-06-03", propertyId: "mock-nha-trang", roomTypeId: "deluxe-ocean", ratePlanId: "breakfast-flex", allotmentId: "deluxe-ocean-agent",
  rooms: [{ adults: 2, children: 0, infants: 0 }], guests: [guest], roomGuests: [[guest, guest]], expectedTotal: 5735000, currency: "VND", acceptedPolicies: true, notes: "",
  roomStaySelections: [[
    { arrivalDate: "2099-06-01", departureDate: "2099-06-02", roomTypeId: "deluxe-ocean", ratePlanId: "breakfast-flex", allotmentId: "deluxe-ocean-agent", expectedUnitTotal: 2450000 },
    { arrivalDate: "2099-06-02", departureDate: "2099-06-03", roomTypeId: "suite-ocean", ratePlanId: "room-only", allotmentId: "suite-ocean-summer", expectedUnitTotal: 3285000 },
  ]] });

test("retains a room's dated code selections and requires complete non-overlapping stay coverage", () => {
  const request = input();
  expect(bookingCreateSchema.parse(request).roomStaySelections).toEqual(request.roomStaySelections);
  for (const dates of [
    { arrivalDate: "2099-06-01", departureDate: "2099-06-03" },
    { arrivalDate: "2099-06-03", departureDate: "2099-06-04" },
    { arrivalDate: "2099-06-02", departureDate: "2099-06-02" },
  ]) {
    const malformed = input();
    Object.assign(malformed.roomStaySelections![0]![1]!, dates);
    expect(bookingCreateSchema.safeParse(malformed).success).toBe(false);
  }
  expect(bookingCreateSchema.safeParse({ ...request, expectedTotal: 1 }).success).toBe(false);
  expect(bookingCreateSchema.safeParse({ ...request, roomStaySelections: [] }).success).toBe(false);
});

test("books different nightly room codes for the same guests as one room reservation", async () => {
  const gateway = new MockBookingGateway(new MockBedbankService());
  const service = new BookingService(gateway, new MemoryBookingStore());
  const booking = await service.create(actor, input());
  expect(booking.status).toBe("created");
  expect(booking.reservations).toHaveLength(1);
  expect(booking.total).toBe(5735000);
  expect(booking.roomLines).toMatchObject([
    { roomIndex: 0, roomTypeId: "deluxe-ocean", arrivalDate: "2099-06-01", departureDate: "2099-06-02", unitTotal: 2450000 },
    { roomIndex: 0, roomTypeId: "suite-ocean", arrivalDate: "2099-06-02", departureDate: "2099-06-03", unitTotal: 3285000 },
  ]);
  expect(booking.request.roomGuests).toEqual([[guest, guest]]);
});

test("rejects a guest count that exceeds any night and a changed nightly price", async () => {
  const gateway = new MockBookingGateway(new MockBedbankService());
  const tooMany = { ...input(), rooms: [{ adults: 4, children: 0, infants: 0 }], roomGuests: [[guest, guest, guest, guest]] };
  await expect(gateway.prepare(tooMany, actor, "ref")).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
  const repriced = input();
  repriced.roomStaySelections![0]![1]!.expectedUnitTotal = 1;
  await expect(gateway.prepare(repriced, actor, "ref")).rejects.toMatchObject({ code: "PRICE_CHANGED" });
});

test("counts shared inventory by date when guest groups swap codes on different nights", async () => {
  class OneRoomPerNight extends MockBedbankService {
    override async detail(search: Parameters<MockBedbankService["detail"]>[0]) { return { ...await super.detail(search), quantity: 1 }; }
  }
  const request = input();
  const stays = request.roomStaySelections![0]!;
  const reversed = stays.map((stay, index) => ({ ...stays[1 - index]!, arrivalDate: stay.arrivalDate, departureDate: stay.departureDate }));
  const twoGroups = { ...request, rooms: [request.rooms[0]!, request.rooms[0]!], guests: [guest, guest], roomGuests: [[guest, guest], [guest, guest]], expectedTotal: request.expectedTotal * 2, roomStaySelections: [stays, reversed] };
  const gateway = new MockBookingGateway(new OneRoomPerNight());
  await expect(gateway.prepare(twoGroups, actor, "ref")).resolves.toMatchObject({ total: request.expectedTotal * 2 });
  await expect(gateway.prepare({ ...twoGroups, roomStaySelections: [stays, stays] }, actor, "ref")).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
});
