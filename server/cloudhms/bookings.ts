import type { BookingCreateRequest, BookingGuarantee, BookingReservation, Profile } from "../../shared/contracts.js";
import type { BookingGateway, PreparedBooking } from "../bookings/service.js";
import type { BedbankService } from "../services.js";
import type { CloudHmsClient } from "./client.js";
import { AppError } from "../errors.js";
import { rateDetailSchema } from "../contracts.js";
type BookingConfig = { organizationCode: string; distributionChannelId: string; requestorId: string; sourceCode: string };
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const identifier = (...values: unknown[]) => values.map(text).find((value) => value && value !== "00000000-0000-0000-0000-000000000000") ?? "";
const invalid = () => new AppError(503, "UPSTREAM_UNAVAILABLE", "Phản hồi đặt phòng CiHMS không đầy đủ. Vui lòng kiểm tra trạng thái đơn.");
function dataOf(payload: unknown): Row {
  const envelope = object(payload);
  if (envelope.isSuccess === false || (typeof envelope.code === "number" && envelope.code !== 0) || array(envelope.errors).length > 0) {
    throw new AppError(409, "BOOKING_REJECTED", "CiHMS từ chối yêu cầu đặt phòng. Vui lòng kiểm tra lại phòng và điều kiện đặt.");
  }
  if (!envelope.data || typeof envelope.data !== "object") throw invalid();
  return object(envelope.data);
}
function money(value: unknown): { amount: number; currency: string } {
  let current = value;
  let currency = "";
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current === "number" && Number.isFinite(current) && current >= 0 && /^[A-Z]{3}$/.test(currency)) return { amount: current, currency };
    const row = object(current);
    currency = text(row.currencyCode) || currency;
    current = row.amount;
  }
  throw invalid();
}
export function parseBookingReservations(payload: unknown, commit: boolean): BookingReservation[] {
  const data = dataOf(payload);
  const rows = array(commit ? data.items : data.reservations);
  if (rows.length === 0) throw invalid();
  return rows.flatMap((value): BookingReservation[] => {
    const item = object(value);
    const row = commit ? object(item.reservation) : item;
    const id = identifier(row.reservationID);
    const status = text(row.status);
    if (!id || !status) {
      // Keep other rooms' known outcomes. The coordinator detects the incomplete batch.
      if (commit) return [];
      throw invalid();
    }
    return [{ id, status, confirmationNumber: text(row.confirmationNumber),
      ...(array(item.errorMessages).length ? { error: "CiHMS chưa xác nhận được phòng này. Cần đối soát." } : {}) }];
  });
}
export function parseBookingGuarantee(payload: unknown): BookingGuarantee {
  const data = dataOf(payload);
  const reservationId = identifier(data.reservationId);
  if (!reservationId) throw invalid();
  const total = money(data.guaranteeAmount);
  const methods = array(data.guaranteeMethods).map((value) => {
    const row = object(value);
    const id = identifier(row.id);
    const type = text(object(row.detail).type);
    if (!id || !type || identifier(row.reservationId) !== reservationId) throw invalid();
    return { id, type, ...money(row.amount), ...(row.stayDate ? { stayDate: text(row.stayDate).slice(0, 10) } : {}) };
  });
  // CiHMS repeats the same guarantee ID for each stay date; retain daily amounts for review.
  if (!methods.length) throw invalid();
  return { reservationId, ...total, methods, ...(data.dueDate ? { dueDate: text(data.dueDate).slice(0, 10) } : {}) };
}
export class CloudHmsBookingGateway implements BookingGateway {
  readonly mode = "live" as const;
  constructor(private client: CloudHmsClient, private bedbank: BedbankService, private config: BookingConfig) {}
  async prepare(input: BookingCreateRequest, actor: Profile, reference: string): Promise<PreparedBooking> {
    const room = input.rooms[0]!;
    const occupancy = { numberOfAdult: room.adults, otherOccupancies: [
      { otherOccupancyRefID: "child", otherOccupancyRefCode: "child", quantity: room.children },
      { otherOccupancyRefID: "infant", otherOccupancyRefCode: "infant", quantity: room.infants },
    ] };
    const [payload, rawDetail] = await Promise.all([
      this.client.request("/common-trd/v1/crs/booking/get-hotel-availability", { body: {
        arrivalDate: input.arrivalDate, departureDate: input.departureDate, numberOfRoom: input.rooms.length,
        propertyIds: [input.propertyId], distributionChannelId: this.config.distributionChannelId,
        roomOccupancy: occupancy, organization: this.config.organizationCode,
      } }),
      // A price is for one room; each room becomes its own reservation in the batch.
      this.bedbank.detail({ ...input, rooms: [room] }),
    ]);
    const parsed = rateDetailSchema.safeParse(rawDetail);
    if (!parsed.success) throw invalid();
    const detail = parsed.data;
    const property = array(dataOf(payload).rates).map(object).find((item) => identifier(object(item.property).id) === input.propertyId);
    const rate = array(property?.rates).map(object).find((item) => {
      const nested = object(item.rateAvailablity);
      return identifier(item.roomTypeID, nested.roomTypeId) === input.roomTypeId && identifier(item.ratePlanID, nested.ratePlanId) === input.ratePlanId;
    });
    if (!rate || typeof rate.quantity !== "number" || rate.quantity < input.rooms.length) throw new AppError(409, "NO_AVAILABILITY", "Không còn đủ phòng cho yêu cầu này. Vui lòng tìm lại phòng.");
    const nested = object(rate.rateAvailablity);
    const allotment = array(nested.allotments).map(object).find((item) => identifier(item.allotmentId, item.id) && typeof item.quantity === "number" && item.quantity >= input.rooms.length);
    const roomTypeCode = text(nested.roomTypeCode);
    const ratePlanCode = text(nested.ratePlanCode) || text(object(nested.ratePlan).rateCode);
    if (!allotment || !roomTypeCode || !ratePlanCode || detail.total <= 0) throw invalid();
    const nights = Math.round((Date.parse(input.departureDate) - Date.parse(input.arrivalDate)) / 86_400_000);
    const dates = Array.from({ length: nights }, (_, index) => new Date(Date.parse(input.arrivalDate) + index * 86_400_000).toISOString().slice(0, 10));
    if (detail.dailyRates.length !== nights || dates.some((date) => !detail.dailyRates.some((item) => item.date === date))) throw invalid();
    const roomRates = dates.map((stayDate) => ({ stayDate, roomTypeCode, roomTypeName: detail.roomTypeName,
      roomTypeRefID: input.roomTypeId, ratePlanCode, ratePlanRefID: input.ratePlanId, allotmentId: identifier(allotment.allotmentId, allotment.id) }));
    const body = { organization: this.config.organizationCode, propertyId: input.propertyId,
      arrivalDate: input.arrivalDate, departureDate: input.departureDate,
      distributionChannel: this.config.distributionChannelId, sourceCode: this.config.sourceCode, requestorId: this.config.requestorId,
      reservations: input.guests.map((guest) => ({
        numberOfRoom: 1, totalAmount: { amount: detail.total, currencyCode: detail.currency }, roomOccupancy: occupancy,
        isReferenceIdSpecified: true, referenceIds: [{ type: "Opera_TA_Rec_Loc", value: reference }],
        isSpecialRequestSpecified: Boolean(input.notes), specialRequests: input.notes ? [{ requestType: "BookerInstruction", requestContent: input.notes }] : [],
        isProfilesSpecified: true, profiles: [
          { firstName: actor.displayName, lastName: "", email: actor.email, profileRefID: "", profileType: "Booker" },
          { ...guest, profileRefID: "", profileType: "Guest", primarySearchValues: { email: guest.email, phoneNumber: guest.phoneNumber } },
        ],
        isRoomRatesSpecified: true, roomRates, isPackagesSpecified: false, packages: [],
      })),
    };
    return { propertyName: text(object(property?.property).name), roomTypeName: detail.roomTypeName, ratePlanName: detail.ratePlanName,
      total: detail.total * input.rooms.length, currency: detail.currency, body };
  }
  async create(prepared: PreparedBooking, reference: string): Promise<BookingReservation[]> {
    return parseBookingReservations(await this.client.request("/common-trd/v1/crs/booking", { body: prepared.body, retry: false, correlationId: reference }), false);
  }
  async guarantees(ids: string[]): Promise<BookingGuarantee[]> {
    const results: BookingGuarantee[] = [];
    for (const id of ids) {
      const result = parseBookingGuarantee(await this.client.request(`/common-trd/v1/crs/booking/${encodeURIComponent(id)}/guarantee-methods`, { body: { organization: this.config.organizationCode } }));
      if (result.reservationId !== id) throw invalid();
      results.push(result);
    }
    return results;
  }
  async confirm(terms: BookingGuarantee[]): Promise<BookingReservation[]> {
    return parseBookingReservations(await this.client.request("/common-trd/v1/crs/booking/batch-commit", { retry: false, body: {
      items: terms.map((item) => ({ reservationId: item.reservationId, guaranteeMethods: [...new Set(item.methods.map(({ id }) => id))].map((id) => ({ id })) })),
      isSendMail: false, organization: this.config.organizationCode,
    } }), true);
  }
}
