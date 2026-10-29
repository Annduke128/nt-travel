// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { CloudHmsBookingGateway, parseBookingReservations, parseBookingGuarantee } from "./bookings.js";
import { MockBedbankService } from "./mock.js";
import type { CloudHmsClient } from "./client.js";
import type { BookingCreateRequest, Profile } from "../../shared/contracts.js";
import inventory from "./fixtures/booking-inventory.json";
import created from "./fixtures/booking-create.json";
import confirmed from "./fixtures/booking-confirm.json";
import guarantees from "./fixtures/booking-guarantees.json";

const actor: Profile = { userId: "staff", email: "staff@example.com", displayName: "NT Staff", role: "staff", status: "active", mustChangePassword: false };
const input: BookingCreateRequest = {
  requestId: "22222222-2222-4222-8222-222222222222", destination: "Phú Quốc", arrivalDate: "2026-06-01", departureDate: "2026-06-03",
  propertyId: "c67377fc-d81d-4208-add9-47e32b69f998", roomTypeId: "5051e26c-e710-4028-90ae-ad929b0309e7", ratePlanId: "1604924a-a9c1-4197-b013-2e61d6a193d0",
  rooms: [{ adults: 2, children: 1, infants: 0 }], guests: [{ firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "guest@example.com", phoneNumber: "0912345678" }],
  roomGuests: [[{ firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "guest@example.com", phoneNumber: "0912345678" }, { firstName: "Binh", lastName: "Tran", country: "VN", nationality: "VN", email: "binh@example.com", phoneNumber: "0912345679" }, { firstName: "Chi", lastName: "Le", country: "VN", nationality: "VN", email: "chi@example.com", phoneNumber: "0912345680" }]],
  expectedTotal: 1800000, currency: "VND", acceptedPolicies: true, notes: "Late arrival",
};
function setup() {
  const request = vi.fn(async (_path: string) => structuredClone(inventory));
  const bedbank = new MockBedbankService();
  vi.spyOn(bedbank, "detail").mockResolvedValue({ propertyId: input.propertyId, roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId,
    roomTypeName: "Standard King", ratePlanName: "PHMS-T18", quantity: 0, total: 1800000, average: 900000, currency: "VND", maxOccupancy: 4,
    dailyRates: [{ date: "2026-06-01", amount: 900000 }, { date: "2026-06-02", amount: 900000 }], policies: [] });
  const gateway = new CloudHmsBookingGateway({ request } as unknown as CloudHmsClient, bedbank, { organizationCode: "org", distributionChannelId: "channel", requestorId: "requestor", sourceCode: "CRO",
    travelAgentName: "NT_Travel", travelAgentProfileId: "ta-profile" });
  return { request, gateway, bedbank };
}
describe("CiHMS booking contract", () => {
  test("keeps the same guests in one reservation with different room codes on successive nights", async () => {
    const { gateway, bedbank, request } = setup();
    const available = structuredClone(inventory);
    const first = available.data.rates[0]!.rates[0]!;
    const second = structuredClone(first);
    second.roomTypeID = "room-two";
    second.rateAvailablity.roomTypeId = "room-two";
    second.rateAvailablity.roomTypeCode = "SUITE";
    second.rateAvailablity.allotments = [{ ...second.rateAvailablity.allotments[0]!, allotmentId: "all-suite", name: "Suite agent" }];
    available.data.rates[0]!.rates.push(second);
    request.mockResolvedValue(available);
    vi.mocked(bedbank.detail).mockImplementation(async (search) => {
      const suite = search.roomTypeId === "room-two";
      const amount = suite ? 1500000 : 900000;
      return { propertyId: input.propertyId, roomTypeId: search.roomTypeId, ratePlanId: search.ratePlanId, roomTypeName: suite ? "Suite" : "Standard King", ratePlanName: "Rate", quantity: 0, maxOccupancy: 4, total: amount, average: amount, currency: "VND", dailyRates: [{ date: search.arrivalDate, amount }], policies: [] };
    });
    const prepared = await gateway.prepare({ ...input, allotmentId: first.rateAvailablity.allotments[0]!.allotmentId, expectedTotal: 2400000, roomStaySelections: [[
      { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, allotmentId: first.rateAvailablity.allotments[0]!.allotmentId, arrivalDate: input.arrivalDate, departureDate: "2026-06-02", expectedUnitTotal: 900000 },
      { roomTypeId: "room-two", ratePlanId: input.ratePlanId, allotmentId: "all-suite", arrivalDate: "2026-06-02", departureDate: input.departureDate, expectedUnitTotal: 1500000 },
    ]] }, actor, "ref");
    expect(prepared.body).toMatchObject({ arrivalDate: input.arrivalDate, departureDate: input.departureDate, reservations: [{ totalAmount: { amount: 2400000 }, roomRates: [
      { stayDate: "2026-06-01", roomTypeRefID: input.roomTypeId, roomTypeCode: "BKSDG" },
      { stayDate: "2026-06-02", roomTypeRefID: "room-two", roomTypeCode: "SUITE", allotmentId: "all-suite" },
    ] }] });
    const reservations = (prepared.body as { reservations: { profiles: { profileType: string; email?: string }[] }[] }).reservations;
    expect(reservations).toHaveLength(1);
    expect(reservations[0]!.profiles.filter((profile) => profile.profileType === "Guest").map((profile) => profile.email)).toEqual(input.roomGuests[0]!.map((guest) => guest.email));
    expect(prepared.roomLines).toHaveLength(2);
  });

  test("uses the exact selected allotment instead of the first eligible allotment", async () => {
    const { gateway } = setup();
    const selected = inventory.data.rates[0]!.rates[0]!.rateAvailablity.allotments[1]!;
    const prepared = await gateway.prepare({ ...input, allotmentId: selected.allotmentId }, actor, "ref");
    expect(prepared.body).toMatchObject({ reservations: [{ roomRates: [{ allotmentId: selected.allotmentId }, { allotmentId: selected.allotmentId }] }] });
    expect(prepared.roomLines?.[0]).toMatchObject({ allotmentId: selected.allotmentId, allotmentName: selected.name });
  });

  test("rejects an unavailable selected allotment without substituting another agency's allotment", async () => {
    const { gateway, request } = setup();
    const available = structuredClone(inventory);
    const selected = available.data.rates[0]!.rates[0]!.rateAvailablity.allotments[1]!;
    selected.quantity = 0;
    request.mockResolvedValue(available);
    await expect(gateway.prepare({ ...input, allotmentId: selected.allotmentId }, actor, "ref")).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
    await expect(gateway.prepare({ ...input, allotmentId: "unknown-agency" }, actor, "ref")).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
  });

  test("keeps two selected allotments distinct when room and rate-plan IDs are identical", async () => {
    const { gateway, request } = setup();
    const available = structuredClone(inventory);
    const rate = available.data.rates[0]!.rates[0]!;
    rate.quantity = 2;
    rate.rateAvailablity.allotments.forEach((allotment) => { allotment.quantity = 1; });
    request.mockResolvedValue(available);
    const allotments = rate.rateAvailablity.allotments;
    const prepared = await gateway.prepare({ ...input, rooms: [input.rooms[0]!, input.rooms[0]!], guests: [input.guests[0]!, input.guests[0]!], roomGuests: [input.roomGuests[0]!, input.roomGuests[0]!], expectedTotal: 3600000,
      roomSelections: allotments.map((allotment) => ({ roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, allotmentId: allotment.allotmentId, expectedUnitTotal: 1800000 })) }, actor, "ref");
    expect(prepared.body).toMatchObject({ reservations: allotments.map((allotment) => ({ roomRates: [{ allotmentId: allotment.allotmentId }, { allotmentId: allotment.allotmentId }] })) });
  });

  test("prepares daily room rates using real allotments and current detail pricing", async () => {
    const { gateway } = setup();
    const prepared = await gateway.prepare(input, actor, "NT-reference");
    expect(prepared.total).toBe(1800000);
    expect(prepared.body).toMatchObject({ organization: "org", distributionChannel: "channel", requestorId: "requestor", sourceCode: "CRO",
      reservations: [{ numberOfRoom: 1, totalAmount: { amount: 1800000, currencyCode: "VND" },
        referenceIds: [{ type: "Opera_TA_Rec_Loc", value: "NT-reference" }],
        roomRates: [{ stayDate: "2026-06-01", allotmentId: "103688ee-b772-45a6-ab51-2129610d9e57", roomTypeCode: "BKSDG" },
          { stayDate: "2026-06-02", ratePlanCode: "PHMS-T18" }] }] });
  });
  test("links each reservation to the configured travel agent and the booking portal client", async () => {
    const { gateway } = setup();
    const prepared = await gateway.prepare(input, actor, "ref");
    const profiles = (prepared.body as { reservations: { profiles: unknown[] }[] }).reservations[0]!.profiles;
    expect(profiles).toContainEqual({ firstName: "NT_Travel", profileRefID: "ta-profile", profileType: "TravelAgent" });
    expect(profiles).toContainEqual({ profileRefID: "BookingPortal", profileType: "BookingClient" });
  });
  test("sends every named occupant as a Guest profile for the room", async () => {
    const { gateway } = setup();
    const roomGuests = [input.guests[0]!,
      { firstName: "Binh", lastName: "Tran", country: "VN", nationality: "VN", email: "binh@example.com", phoneNumber: "0912345679" },
      { firstName: "Chi", lastName: "Le", country: "VN", nationality: "VN", email: "chi@example.com", phoneNumber: "0912345680" }];
    const prepared = await gateway.prepare({ ...input, roomGuests: [roomGuests] }, actor, "ref");
    const profiles = (prepared.body as { reservations: { profiles: { profileType: string; firstName: string }[] }[] }).reservations[0]!.profiles;
    expect(profiles.filter((profile) => profile.profileType === "Guest").map((profile) => profile.firstName)).toEqual(["An", "Binh", "Chi"]);
  });
  test("sends guest country/nationality and omits empty contact/search fields", async () => {
    const { gateway } = setup();
    const guest = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "US", email: "", phoneNumber: "" };
    const roomGuests = [guest, { ...guest, firstName: "Binh", email: "binh@example.com" }, { ...guest, firstName: "Chi", phoneNumber: "0912345678" }];
    const prepared = await gateway.prepare({ ...input, guests: [guest], roomGuests: [roomGuests] }, actor, "ref");
    const profiles = (prepared.body as { reservations: { profiles: Record<string, unknown>[] }[] }).reservations[0]!.profiles.filter((profile) => profile.profileType === "Guest");
    expect(profiles[0]).toEqual({ firstName: "An", lastName: "Nguyen", country: "VN", nationality: "US", profileRefID: "", profileType: "Guest" });
    expect(profiles[1]).toMatchObject({ country: "VN", nationality: "US", email: "binh@example.com", primarySearchValues: { email: "binh@example.com" } });
    expect(profiles[1]).not.toHaveProperty("phoneNumber");
    expect(profiles[2]).toMatchObject({ phoneNumber: "0912345678", primarySearchValues: { phoneNumber: "0912345678" } });
    expect(profiles[2]).not.toHaveProperty("email");
  });
  test("refuses an unrelated room rate instead of taking the first returned rate", async () => {
    const { gateway } = setup();
    await expect(gateway.prepare({ ...input, ratePlanId: "another-plan" }, actor, "ref")).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
  });
  test("creates one reservation per room with its own guest", async () => {
    const { gateway } = setup();
    const prepared = await gateway.prepare({ ...input, rooms: [input.rooms[0]!, input.rooms[0]!], guests: [input.guests[0]!, { ...input.guests[0]!, firstName: "Binh" }],
      roomGuests: [input.roomGuests[0]!, [{ ...input.guests[0]!, firstName: "Binh" }, ...input.roomGuests[0]!.slice(1)]], expectedTotal: 3600000 }, actor, "ref");
    expect(prepared.total).toBe(3600000);
    expect((prepared.body as { reservations: unknown[] }).reservations).toHaveLength(2);
  });
  test("quotes and sends the occupancy and price of each room when guest counts differ", async () => {
    const { gateway, request, bedbank } = setup();
    const available = structuredClone(inventory);
    available.data.rates[0]!.rates[0]!.quantity = 2;
    available.data.rates[0]!.rates[0]!.rateAvailablity.allotments[0]!.quantity = 2;
    request.mockResolvedValue(available);
    vi.mocked(bedbank.detail).mockImplementation(async (query) => ({
      propertyId: input.propertyId, roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId,
      roomTypeName: "Standard King", ratePlanName: "PHMS-T18", quantity: 2, maxOccupancy: 4,
      total: query.rooms[0]!.adults === 3 ? 2400000 : 1800000, average: 900000, currency: "VND",
      dailyRates: [{ date: "2026-06-01", amount: 900000 }, { date: "2026-06-02", amount: 900000 }], policies: [],
    }));
    const lead = { ...input.guests[0]!, firstName: "Binh" };
    const secondRoomGuests = [lead, ...input.roomGuests[0]!.slice(1), { ...lead, firstName: "Dung" }];
    const prepared = await gateway.prepare({ ...input,
      rooms: [input.rooms[0]!, { adults: 3, children: 1, infants: 0 }],
      guests: [input.guests[0]!, lead], roomGuests: [input.roomGuests[0]!, secondRoomGuests],
      roomSelections: [
        { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, expectedUnitTotal: 1800000 },
        { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, expectedUnitTotal: 2400000 },
      ], expectedTotal: 4200000,
    }, actor, "ref");
    expect(prepared.total).toBe(4200000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, "/common-trd/v1/crs/booking/get-hotel-availability", expect.objectContaining({ body: expect.objectContaining({ roomOccupancy: expect.objectContaining({ numberOfAdult: 2 }) }) }));
    expect(request).toHaveBeenNthCalledWith(2, "/common-trd/v1/crs/booking/get-hotel-availability", expect.objectContaining({ body: expect.objectContaining({ roomOccupancy: expect.objectContaining({ numberOfAdult: 3 }) }) }));
    expect((prepared.body as { reservations: { totalAmount: { amount: number }; roomOccupancy: { numberOfAdult: number } }[] }).reservations)
      .toMatchObject([{ totalAmount: { amount: 1800000 }, roomOccupancy: { numberOfAdult: 2 } }, { totalAmount: { amount: 2400000 }, roomOccupancy: { numberOfAdult: 3 } }]);
  });
  test("prepares different rate plans with a checked price for each room in one booking", async () => {
    const { gateway, request, bedbank } = setup();
    const mixedInventory = structuredClone(inventory);
    const secondRate = structuredClone(mixedInventory.data.rates[0]!.rates[0]!);
    secondRate.roomTypeID = "second-room";
    secondRate.ratePlanID = "second-plan";
    secondRate.quantity = 1;
    secondRate.rateAvailablity.roomTypeId = "second-room";
    secondRate.rateAvailablity.ratePlanId = "second-plan";
    secondRate.rateAvailablity.roomTypeCode = "SECOND";
    secondRate.rateAvailablity.ratePlanCode = "PLAN2";
    secondRate.rateAvailablity.allotments = [{ ...secondRate.rateAvailablity.allotments[0]!, id: "second-allotment", allotmentId: "second-allotment", quantity: 1 }];
    mixedInventory.data.rates[0]!.rates.push(secondRate);
    request.mockResolvedValue(mixedInventory);
    vi.mocked(bedbank.detail).mockImplementation(async (query) => ({
      propertyId: input.propertyId, roomTypeId: query.roomTypeId, ratePlanId: query.ratePlanId,
      roomTypeName: query.roomTypeId === "second-room" ? "Suite" : "Standard King",
      ratePlanName: query.ratePlanId === "second-plan" ? "Flexible" : "PHMS-T18",
      quantity: 2, maxOccupancy: 4, total: query.roomTypeId === "second-room" ? 3000000 : 1800000,
      average: 900000, currency: "VND", dailyRates: [
        { date: "2026-06-01", amount: 900000 }, { date: "2026-06-02", amount: 900000 },
      ], policies: [],
    }));
    const mixed = { ...input, rooms: [input.rooms[0]!, input.rooms[0]!],
      guests: [input.guests[0]!, { ...input.guests[0]!, firstName: "Binh" }],
      roomGuests: [input.roomGuests[0]!, [{ ...input.guests[0]!, firstName: "Binh" }, ...input.roomGuests[0]!.slice(1)]],
      roomSelections: [
        { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, expectedUnitTotal: 1800000 },
        { roomTypeId: "second-room", ratePlanId: "second-plan", expectedUnitTotal: 3000000 },
      ], expectedTotal: 4800000 };
    const prepared = await gateway.prepare(mixed, actor, "ref");
    const reservations = (prepared.body as { reservations: { totalAmount: { amount: number }; roomRates: { roomTypeRefID: string }[] }[] }).reservations;
    expect(prepared.total).toBe(4800000);
    expect(reservations.map((item) => item.totalAmount.amount)).toEqual([1800000, 3000000]);
    expect(reservations.map((item) => item.roomRates[0]?.roomTypeRefID)).toEqual([input.roomTypeId, "second-room"]);
    expect(request).toHaveBeenCalledWith("/common-trd/v1/crs/booking/get-hotel-availability", expect.objectContaining({ body: expect.objectContaining({ numberOfRoom: 1 }) }));
  });
  test("does not count the same allotment twice across rate plans", async () => {
    const { gateway, request, bedbank } = setup();
    const sharedInventory = structuredClone(inventory);
    const firstRate = sharedInventory.data.rates[0]!.rates[0]!;
    firstRate.quantity = 1;
    firstRate.rateAvailablity.allotments = [{ ...firstRate.rateAvailablity.allotments[0]!, quantity: 1 }];
    const secondRate = structuredClone(firstRate);
    secondRate.ratePlanID = "second-plan";
    secondRate.rateAvailablity.ratePlanId = "second-plan";
    secondRate.rateAvailablity.ratePlanCode = "PLAN2";
    sharedInventory.data.rates[0]!.rates.push(secondRate);
    request.mockResolvedValue(sharedInventory);
    vi.mocked(bedbank.detail).mockImplementation(async (query) => ({ propertyId: input.propertyId, roomTypeId: input.roomTypeId, ratePlanId: query.ratePlanId,
      roomTypeName: "Standard King", ratePlanName: "PHMS-T18", quantity: 2, maxOccupancy: 4, total: 1800000, average: 900000, currency: "VND",
      dailyRates: [{ date: "2026-06-01", amount: 900000 }, { date: "2026-06-02", amount: 900000 }], policies: [] }));
    const mixed = { ...input, rooms: [input.rooms[0]!, input.rooms[0]!], guests: [input.guests[0]!, input.guests[0]!], expectedTotal: 3600000,
      roomSelections: [
        { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, expectedUnitTotal: 1800000 },
        { roomTypeId: input.roomTypeId, ratePlanId: "second-plan", expectedUnitTotal: 1800000 },
      ] };
    await expect(gateway.prepare(mixed, actor, "ref")).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
  });
  test("reads documented creation, guarantee, and per-item commit envelopes", () => {
    expect(parseBookingReservations(created, false)[0]).toMatchObject({ id: "52ccb695-fbd8-4ed4-bcf0-8a05a6412f58", status: "Prospect", confirmationNumber: "VOPQ24407" });
    expect(parseBookingReservations(confirmed, true)[0]).toMatchObject({ status: "Reserved", confirmationNumber: "VOPQ24410" });
    expect(parseBookingGuarantee(guarantees)).toMatchObject({ amount: 20000015, currency: "VND", methods: expect.arrayContaining([expect.objectContaining({ amount: 4000003 })]) });
  });
  test("loads guarantees for a group in bounded parallel batches", async () => {
    const { gateway, request } = setup();
    let active = 0;
    let peak = 0;
    request.mockImplementation(async (path) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      const id = String(path).split("/").at(-2)!;
      const payload = structuredClone(guarantees);
      payload.data.reservationId = id;
      payload.data.guaranteeMethods.forEach((method) => { method.reservationId = id; });
      return payload as never;
    });
    const ids = Array.from({ length: 8 }, (_, index) => `reservation-${index}`);
    expect((await gateway.guarantees(ids)).map((item) => item.reservationId)).toEqual(ids);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });
  test("rejects a guarantee method without its policy reference", () => {
    const payload = structuredClone(guarantees);
    delete (payload.data.guaranteeMethods[0]!.detail as { id?: string }).id;
    expect(() => parseBookingGuarantee(payload)).toThrow();
  });
  test("commits each guarantee once without recording a payment", async () => {
    const { gateway, request } = setup();
    request.mockResolvedValue(confirmed as never);
    await gateway.confirm([parseBookingGuarantee(guarantees)]);
    // guaranteeMethods made CiHMS record Complete/Credit; guaranteeInfos without a value stays unpaid (verified 2026-09-17).
    expect(request).toHaveBeenLastCalledWith("/common-trd/v1/crs/booking/batch-commit", { retry: false, body: {
      isSendMail: false, organization: "org",
      items: [{ reservationId: "d84e2a16-c2c8-481a-87df-83aa63c69086",
        guaranteeInfos: [{ guaranteePolicyId: "b5002a8e-4c4f-4591-8b42-baa123fe156f", guaranteeRefID: "00000001-0000-0000-0000-000000000000" }] }],
    } });
  });
  test("rejects a business failure even with HTTP success", () => {
    expect(() => parseBookingReservations({ ...created, isSuccess: false, errors: [{ message: "private upstream data" }] }, false)).toThrow();
  });
  test("preserves successful rooms when another commit item has no reservation", () => {
    const payload = { ...confirmed, data: { items: [...confirmed.data.items, { reservation: null, errorMessages: ["Rejected"] }] } };
    expect(parseBookingReservations(payload, true)).toEqual([expect.objectContaining({ status: "Reserved", confirmationNumber: "VOPQ24410" })]);
  });
  test("retains per-item commit failure and disables transport replay", async () => {
    const { gateway, request } = setup();
    const failed = structuredClone(confirmed);
    failed.data.items[0]!.errorMessages = ["unavailable"] as never[];
    expect(parseBookingReservations(failed, true)[0]?.error).toBeTruthy();
    request.mockResolvedValue(confirmed as never);
    await gateway.confirm([parseBookingGuarantee(guarantees)]);
    expect(request).toHaveBeenLastCalledWith("/common-trd/v1/crs/booking/batch-commit", expect.objectContaining({ retry: false, body: expect.objectContaining({ isSendMail: false }) }));
  });
});
