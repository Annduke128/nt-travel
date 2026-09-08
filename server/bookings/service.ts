import type { BookingCreateRequest, BookingDto, BookingGuarantee, BookingGuaranteesDto, BookingReservation, Profile } from "../../shared/contracts.js";
import { createHash } from "node:crypto";
import { AppError } from "../errors.js";
import type { BookingRecord, BookingStore } from "./store.js";
export type PreparedBooking = { propertyName: string; roomTypeName: string; ratePlanName: string; total: number; currency: string; body: unknown };
export interface BookingGateway {
  mode: "mock" | "live";
  prepare(input: BookingCreateRequest, actor: Profile, reference: string): Promise<PreparedBooking>;
  create(prepared: PreparedBooking, reference: string): Promise<BookingReservation[]>;
  guarantees(reservationIds: string[]): Promise<BookingGuarantee[]>;
  confirm(guarantees: BookingGuarantee[]): Promise<BookingReservation[]>;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const attention = "Chưa xác định được kết quả đầy đủ từ CiHMS. Liên hệ vận hành với mã đối soát bên dưới trước khi tạo hoặc xác nhận lại.";
const conflict = () => new AppError(409, "BOOKING_CONFLICT", "Yêu cầu đặt phòng đang được xử lý hoặc mã yêu cầu đã được sử dụng. Vui lòng mở lại đơn.");

export class BookingService {
  constructor(private gateway: BookingGateway, private store: BookingStore) {}
  async health() { await this.store.health(); }
  private async record(actor: Profile, id: string) {
    const record = await this.store.get(id, actor.userId);
    if (!record) throw new AppError(404, "BOOKING_CONFLICT", "Không tìm thấy đặt phòng của bạn");
    return record;
  }
  async list(actor: Profile): Promise<BookingDto[]> { return this.store.list(actor.userId); }
  async get(actor: Profile, id: string): Promise<BookingDto> { return (await this.record(actor, id)).booking; }

  async create(actor: Profile, input: BookingCreateRequest): Promise<BookingDto> {
    const fingerprint = digest(input);
    const existing = await this.store.get(input.requestId, actor.userId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw conflict();
      return existing.booking;
    }
    const reference = `NT-${input.requestId}`;
    const prepared = await this.gateway.prepare(input, actor, reference);
    if (prepared.total !== input.expectedTotal || prepared.currency !== input.currency) {
      throw new AppError(409, "PRICE_CHANGED", "Giá phòng đã thay đổi. Vui lòng tìm lại phòng và xem giá mới trước khi đặt.");
    }
    const record: BookingRecord = { actorId: actor.userId, fingerprint, booking: {
      id: input.requestId, reference, request: input, createdAt: new Date().toISOString(), mode: this.gateway.mode,
      status: "creating", propertyName: prepared.propertyName, roomTypeName: prepared.roomTypeName,
      ratePlanName: prepared.ratePlanName, total: prepared.total, currency: prepared.currency, reservations: [],
    } };
    // The unique row is written BEFORE the mutation. Competing workers and retries cannot replay it.
    if (!await this.store.insert(record)) {
      const raced = await this.store.get(input.requestId, actor.userId);
      if (!raced || raced.fingerprint !== fingerprint) throw conflict();
      return raced.booking;
    }
    try {
      record.booking.reservations = await this.gateway.create(prepared, reference);
      const reservations = record.booking.reservations;
      record.booking.status = reservations.length === input.rooms.length && new Set(reservations.map((item) => item.id)).size === input.rooms.length
        && reservations.every((item) => item.id && item.status === "Prospect" && !item.error) ? "created" : "attention";
    } catch {
      // A write may have succeeded upstream even when its response was lost. Preserve the attempt.
      record.booking.status = "attention";
    }
    if (record.booking.status === "attention") record.booking.message = attention;
    if (!await this.store.save(record, "creating")) throw conflict();
    return record.booking;
  }

  private async terms(booking: BookingDto): Promise<BookingGuaranteesDto> {
    const ids = booking.reservations.map((item) => item.id);
    const guarantees = await this.gateway.guarantees(ids);
    if (guarantees.length !== ids.length || new Set(guarantees.map((item) => item.reservationId)).size !== ids.length
      || guarantees.some((item) => !ids.includes(item.reservationId) || item.methods.length === 0)) {
      throw new AppError(503, "UPSTREAM_UNAVAILABLE", "CiHMS chưa trả đủ điều kiện bảo đảm cho tất cả phòng.");
    }
    // Stable order keeps a harmless upstream reordering from looking like a price change.
    const sorted = guarantees.map((item) => ({ ...item, methods: [...item.methods].sort((a, b) => `${a.id}:${a.stayDate ?? ""}`.localeCompare(`${b.id}:${b.stayDate ?? ""}`)) }))
      .sort((a, b) => a.reservationId.localeCompare(b.reservationId));
    return { version: digest(sorted), guarantees: sorted };
  }
  async guarantees(actor: Profile, id: string): Promise<BookingGuaranteesDto> {
    const booking = await this.get(actor, id);
    if (booking.status !== "created") throw conflict();
    return this.terms(booking);
  }
  async confirm(actor: Profile, id: string, version: string): Promise<BookingDto> {
    const record = await this.record(actor, id);
    if (record.booking.status !== "created") return record.booking;
    const terms = await this.terms(record.booking);
    if (terms.version !== version) throw new AppError(409, "GUARANTEE_CHANGED", "Điều kiện bảo đảm đã thay đổi. Vui lòng tải và đọc lại trước khi xác nhận.");
    record.booking.status = "confirming";
    if (!await this.store.save(record, "created")) return this.get(actor, id);
    try {
      const result = await this.gateway.confirm(terms.guarantees);
      const before = record.booking.reservations;
      const complete = result.length === before.length && new Set(result.map((item) => item.id)).size === before.length
        && result.every((item) => before.some((previous) => previous.id === item.id) && item.status === "Reserved" && !item.error);
      record.booking.reservations = before.map((previous) => ({ ...previous, ...result.find((item) => item.id === previous.id) }));
      record.booking.status = complete ? "confirmed" : "attention";
    } catch {
      record.booking.status = "attention";
    }
    if (record.booking.status === "attention") record.booking.message = attention;
    if (!await this.store.save(record, "confirming")) throw conflict();
    return record.booking;
  }
}
