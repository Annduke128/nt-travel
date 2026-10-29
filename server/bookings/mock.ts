import { randomUUID } from "node:crypto";
import { rateKey } from "../../shared/contracts.js";
import type { BookingCreateRequest, BookingGuarantee, BookingReservation, Profile } from "../../shared/contracts.js";
import { AppError } from "../errors.js";
import type { BedbankService } from "../services.js";
import type { BookingGateway, PreparedBooking } from "./service.js";
import { prepareRoomStayPlan } from "./roomStays.js";

export class MockBookingGateway implements BookingGateway {
  readonly mode = "mock" as const;
  private reservations = new Map<string, BookingReservation>();
  constructor(private bedbank: BedbankService) {}
  async prepare(input: BookingCreateRequest, _actor: Profile, _reference: string): Promise<PreparedBooking> {
    if (input.roomStaySelections) return prepareRoomStayPlan(input, (single) => this.prepare(single, _actor, _reference), () => input);
    const selections = input.roomSelections ?? input.rooms.map(() => ({ roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, allotmentId: input.allotmentId, expectedUnitTotal: input.expectedTotal / input.rooms.length }));
    const counts = new Map<string, number>();
    for (const item of selections) counts.set(rateKey(item), (counts.get(rateKey(item)) ?? 0) + 1);
    const [details, hotels] = await Promise.all([Promise.all(selections.map((item, index) => this.bedbank.detail({ ...input, rooms: [input.rooms[index]!], roomTypeId: item.roomTypeId, ratePlanId: item.ratePlanId, allotmentId: item.allotmentId }))), this.bedbank.properties(input.destination)]);
    const allotmentUsed = new Map<string, number>();
    const allotmentLimit = new Map<string, number>();
    for (const [index, detail] of details.entries()) {
      const occupancy = input.rooms[index]!;
      if (detail.maxOccupancy && occupancy.adults + occupancy.children + occupancy.infants > detail.maxOccupancy) throw new AppError(409, "NO_AVAILABILITY", "Số khách vượt sức chứa của mã phòng đã chọn.");
      if (detail.quantity < counts.get(rateKey(selections[index]!))!) throw new AppError(409, "NO_AVAILABILITY", "Không còn đủ phòng cho yêu cầu này");
      if (detail.allotmentId) {
        const used = (allotmentUsed.get(detail.allotmentId) ?? 0) + 1;
        const limit = Math.min(detail.quantity, allotmentLimit.get(detail.allotmentId) ?? detail.quantity);
        if (used > limit) throw new AppError(409, "NO_AVAILABILITY", "Allotment đã chọn không còn đủ phòng.");
        allotmentUsed.set(detail.allotmentId, used); allotmentLimit.set(detail.allotmentId, limit);
      }
      if (detail.total !== selections[index]!.expectedUnitTotal || detail.currency !== input.currency) throw new AppError(409, "PRICE_CHANGED", "Giá phòng đã thay đổi. Vui lòng tìm lại phòng.");
    }
    const detail = details[0]!;
    return { propertyName: hotels.find((hotel) => hotel.id === input.propertyId)?.name ?? input.destination,
      roomTypeName: counts.size === 1 ? detail.roomTypeName : "Nhiều hạng phòng", ratePlanName: counts.size === 1 ? detail.ratePlanName : "Nhiều gói giá", total: details.reduce((sum, item) => sum + item.total, 0), currency: detail.currency, body: input,
      roomLines: details.map((item) => ({ roomTypeId: item.roomTypeId, roomTypeName: item.roomTypeName, ratePlanId: item.ratePlanId, ratePlanName: item.ratePlanName, unitTotal: item.total, allotmentId: item.allotmentId, allotmentName: item.allotmentName })),
      availabilityChecks: details.map((item, index) => ({ ...selections[index]!, allotmentId: item.allotmentId, arrivalDate: input.arrivalDate, departureDate: input.departureDate, quantity: item.quantity })) };
  }
  async create(prepared: PreparedBooking, _reference: string) {
    return (prepared.body as BookingCreateRequest).rooms.map(() => {
      const reservation = { id: randomUUID(), confirmationNumber: `DEMO-${randomUUID().slice(0, 8).toUpperCase()}`, status: "Prospect" };
      this.reservations.set(reservation.id, reservation);
      return reservation;
    });
  }
  async guarantees(ids: string[]): Promise<BookingGuarantee[]> {
    return ids.map((reservationId) => ({ reservationId, amount: 0, currency: "VND",
      methods: [{ id: `demo-${reservationId}`, policyRefId: "demo-policy", type: "Deposit", amount: 0, currency: "VND" }] }));
  }
  async confirm(terms: BookingGuarantee[]) {
    return terms.map((item) => {
      const reservation = this.reservations.get(item.reservationId);
      if (!reservation) throw new AppError(404, "BOOKING_CONFLICT", "Không tìm thấy đặt phòng thử nghiệm");
      const confirmed = { ...reservation, status: "Reserved" };
      this.reservations.set(confirmed.id, confirmed);
      return confirmed;
    });
  }
}
