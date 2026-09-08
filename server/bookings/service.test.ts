// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { BookingCreateRequest, BookingGuarantee, Profile } from "../../shared/contracts.js";
import { AppError } from "../errors.js";
import { MemoryBookingStore } from "./store.js";
import { BookingService, type BookingGateway } from "./service.js";

const actor: Profile = { userId: "user-1", displayName: "NT Staff", email: "staff@example.com", role: "staff", status: "active", mustChangePassword: false };
const input: BookingCreateRequest = {
  requestId: "22222222-2222-4222-8222-222222222222", destination: "Nha Trang", arrivalDate: "2027-06-01", departureDate: "2027-06-03",
  rooms: [{ adults: 2, children: 0, infants: 0 }], propertyId: "p1", roomTypeId: "r1", ratePlanId: "rate1",
  expectedTotal: 1800000, currency: "VND", guests: [{ firstName: "An", lastName: "Nguyen", email: "guest@example.com", phoneNumber: "0912345678" }], notes: "", acceptedPolicies: true,
};
const reservation = { id: "res1", confirmationNumber: "VP123", status: "Prospect" };
const guarantee: BookingGuarantee = { reservationId: "res1", amount: 500000, currency: "VND", methods: [{ id: "g1", type: "Deposit", amount: 500000, currency: "VND" }] };
function setup(store = new MemoryBookingStore()) {
  const gateway: BookingGateway = {
    mode: "mock",
    prepare: vi.fn(async () => ({ propertyName: "Vinpearl", roomTypeName: "Deluxe", ratePlanName: "Breakfast", total: 1800000, currency: "VND", body: {} })),
    create: vi.fn(async () => [reservation]),
    guarantees: vi.fn(async () => [guarantee]),
    confirm: vi.fn(async () => [{ ...reservation, status: "Reserved" }]),
  };
  return { gateway, service: new BookingService(gateway, store), store };
}

describe("booking lifecycle", () => {
  test("creates a prospect, presents guarantee, then confirms", async () => {
    const { service, gateway } = setup();
    const booking = await service.create(actor, input);
    expect(booking.status).toBe("created");
    expect(gateway.confirm).not.toHaveBeenCalled();
    const terms = await service.guarantees(actor, booking.id);
    expect(terms.guarantees).toEqual([guarantee]);
    const confirmed = await service.confirm(actor, booking.id, terms.version);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.reservations[0]?.confirmationNumber).toBe("VP123");
    expect((await service.list(actor))[0]?.status).toBe("confirmed");
  });

  test("the same request is created once across concurrent requests and service restart", async () => {
    const { service, gateway, store } = setup();
    await Promise.all([service.create(actor, input), service.create(actor, input)]);
    await new BookingService(gateway, store).create(actor, input);
    expect(gateway.create).toHaveBeenCalledTimes(1);
  });

  test("rejects reuse of a request ID with different guests", async () => {
    const { service } = setup();
    await service.create(actor, input);
    await expect(service.create(actor, { ...input, notes: "changed" })).rejects.toMatchObject({ code: "BOOKING_CONFLICT" });
  });

  test("another staff member cannot see or confirm this booking", async () => {
    const { service } = setup();
    await service.create(actor, input);
    const other = { ...actor, userId: "other" };
    expect(await service.list(other)).toEqual([]);
    await expect(service.confirm(other, input.requestId, "anything")).rejects.toMatchObject({ status: 404 });
  });

  test("a create timeout is kept for reconciliation and never retried", async () => {
    const { service, gateway } = setup();
    vi.mocked(gateway.create).mockRejectedValue(new AppError(503, "UPSTREAM_UNAVAILABLE", "timeout"));
    const result = await service.create(actor, input);
    expect(result.status).toBe("attention");
    expect((await service.create(actor, input)).status).toBe("attention");
    expect(gateway.create).toHaveBeenCalledTimes(1);
  });

  test("stops before mutation when the quote has changed", async () => {
    const { service, gateway } = setup();
    await expect(service.create(actor, { ...input, expectedTotal: 1 })).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    expect(gateway.create).not.toHaveBeenCalled();
  });

  test("does not confirm changed guarantee conditions or replay a confirmation", async () => {
    const { service, gateway } = setup();
    await service.create(actor, input);
    const terms = await service.guarantees(actor, input.requestId);
    vi.mocked(gateway.guarantees).mockResolvedValue([{ ...guarantee, amount: 900000 }]);
    await expect(service.confirm(actor, input.requestId, terms.version)).rejects.toMatchObject({ code: "GUARANTEE_CHANGED" });
    expect(gateway.confirm).not.toHaveBeenCalled();
    const changed = await service.guarantees(actor, input.requestId);
    await Promise.all([service.confirm(actor, input.requestId, changed.version), service.confirm(actor, input.requestId, changed.version)]);
    expect(gateway.confirm).toHaveBeenCalledTimes(1);
  });

  test("a partial batch failure never reports the whole booking confirmed", async () => {
    const { service, gateway } = setup();
    await service.create(actor, input);
    const terms = await service.guarantees(actor, input.requestId);
    vi.mocked(gateway.confirm).mockResolvedValue([{ ...reservation, error: "Booking rejected" }]);
    expect((await service.confirm(actor, input.requestId, terms.version)).status).toBe("attention");
  });
});
