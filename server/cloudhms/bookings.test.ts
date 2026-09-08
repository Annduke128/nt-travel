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
  rooms: [{ adults: 2, children: 1, infants: 0 }], guests: [{ firstName: "An", lastName: "Nguyen", email: "guest@example.com", phoneNumber: "0912345678" }],
  expectedTotal: 1800000, currency: "VND", acceptedPolicies: true, notes: "Late arrival",
};
function setup() {
  const request = vi.fn(async () => structuredClone(inventory));
  const bedbank = new MockBedbankService();
  vi.spyOn(bedbank, "detail").mockResolvedValue({ propertyId: input.propertyId, roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId,
    roomTypeName: "Standard King", ratePlanName: "PHMS-T18", quantity: 0, total: 1800000, average: 900000, currency: "VND", maxOccupancy: 4,
    dailyRates: [{ date: "2026-06-01", amount: 900000 }, { date: "2026-06-02", amount: 900000 }], policies: [] });
  const gateway = new CloudHmsBookingGateway({ request } as unknown as CloudHmsClient, bedbank, { organizationCode: "org", distributionChannelId: "channel", requestorId: "requestor", sourceCode: "CRO" });
  return { request, gateway };
}
describe("CiHMS booking contract", () => {
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
  test("refuses an unrelated room rate instead of taking the first returned rate", async () => {
    const { gateway } = setup();
    await expect(gateway.prepare({ ...input, ratePlanId: "another-plan" }, actor, "ref")).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
  });
  test("creates one reservation per room with its own guest", async () => {
    const { gateway } = setup();
    const prepared = await gateway.prepare({ ...input, rooms: [input.rooms[0]!, input.rooms[0]!], guests: [input.guests[0]!, { ...input.guests[0]!, firstName: "Binh" }] }, actor, "ref");
    expect(prepared.total).toBe(3600000);
    expect((prepared.body as { reservations: unknown[] }).reservations).toHaveLength(2);
  });
  test("reads documented creation, guarantee, and per-item commit envelopes", () => {
    expect(parseBookingReservations(created, false)[0]).toMatchObject({ id: "52ccb695-fbd8-4ed4-bcf0-8a05a6412f58", status: "Prospect", confirmationNumber: "VOPQ24407" });
    expect(parseBookingReservations(confirmed, true)[0]).toMatchObject({ status: "Reserved", confirmationNumber: "VOPQ24410" });
    expect(parseBookingGuarantee(guarantees)).toMatchObject({ amount: 20000015, currency: "VND", methods: expect.arrayContaining([expect.objectContaining({ amount: 4000003 })]) });
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
