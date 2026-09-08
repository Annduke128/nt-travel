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
    const [detail, hotels] = await Promise.all([this.bedbank.detail(input), this.bedbank.properties(input.destination)]);
    if (detail.quantity < input.rooms.length) throw new AppError(409, "NO_AVAILABILITY", "Không còn đủ phòng cho yêu cầu này");
    return { propertyName: hotels.find((hotel) => hotel.id === input.propertyId)?.name ?? input.destination,
      roomTypeName: detail.roomTypeName, ratePlanName: detail.ratePlanName, total: detail.total * input.rooms.length, currency: detail.currency, body: input };
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
      methods: [{ id: `demo-${reservationId}`, type: "Deposit", amount: 0, currency: "VND" }] }));
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
