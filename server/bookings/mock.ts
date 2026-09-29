import { randomUUID } from "node:crypto";
import type { BookingCreateRequest, BookingGuarantee, BookingReservation, Profile } from "../../shared/contracts.js";
import { AppError } from "../errors.js";
import type { BedbankService } from "../services.js";
import type { BookingGateway, PreparedBooking } from "./service.js";

export class MockBookingGateway implements BookingGateway {
  readonly mode = "mock" as const;
  private reservations = new Map<string, BookingReservation>();
  constructor(private bedbank: BedbankService) {}
  async prepare(input: BookingCreateRequest, _actor: Profile, _reference: string): Promise<PreparedBooking> {
    const selections = input.roomSelections ?? input.rooms.map(() => ({ roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, expectedUnitTotal: input.expectedTotal / input.rooms.length }));
    const counts = new Map<string, number>();
    for (const item of selections) counts.set(`${item.roomTypeId}:${item.ratePlanId}`, (counts.get(`${item.roomTypeId}:${item.ratePlanId}`) ?? 0) + 1);
    const [details, hotels] = await Promise.all([Promise.all(selections.map((item) => this.bedbank.detail({ ...input, rooms: [input.rooms[0]!], roomTypeId: item.roomTypeId, ratePlanId: item.ratePlanId }))), this.bedbank.properties(input.destination)]);
    for (const [index, detail] of details.entries()) {
      if (detail.quantity < counts.get(`${detail.roomTypeId}:${detail.ratePlanId}`)!) throw new AppError(409, "NO_AVAILABILITY", "Không còn đủ phòng cho yêu cầu này");
      if (detail.total !== selections[index]!.expectedUnitTotal || detail.currency !== input.currency) throw new AppError(409, "PRICE_CHANGED", "Giá phòng đã thay đổi. Vui lòng tìm lại phòng.");
    }
    const detail = details[0]!;
    return { propertyName: hotels.find((hotel) => hotel.id === input.propertyId)?.name ?? input.destination,
      roomTypeName: counts.size === 1 ? detail.roomTypeName : "Nhiều hạng phòng", ratePlanName: counts.size === 1 ? detail.ratePlanName : "Nhiều gói giá", total: details.reduce((sum, item) => sum + item.total, 0), currency: detail.currency, body: input,
      roomLines: details.map((item) => ({ roomTypeId: item.roomTypeId, roomTypeName: item.roomTypeName, ratePlanId: item.ratePlanId, ratePlanName: item.ratePlanName, unitTotal: item.total })) };
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
