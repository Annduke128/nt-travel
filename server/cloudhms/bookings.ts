import type { BookingCreateRequest, BookingGuarantee, BookingReservation, Profile, RateDetailDto } from "../../shared/contracts.js";
import type { BookingGateway, PreparedBooking } from "../bookings/service.js";
import type { BedbankService } from "../services.js";
import type { CloudHmsClient } from "./client.js";
import { AppError } from "../errors.js";
import { rateDetailSchema } from "../contracts.js";
type BookingConfig = { organizationCode: string; distributionChannelId: string; requestorId: string; sourceCode: string; travelAgentName: string; travelAgentProfileId: string };
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
    const policyRefId = identifier(object(row.detail).id);
    const type = text(object(row.detail).type);
    if (!id || !policyRefId || !type || identifier(row.reservationId) !== reservationId) throw invalid();
    return { id, policyRefId, type, ...money(row.amount), ...(row.stayDate ? { stayDate: text(row.stayDate).slice(0, 10) } : {}) };
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
    const selections = input.roomSelections ?? input.rooms.map(() => ({ roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId, expectedUnitTotal: input.expectedTotal / input.rooms.length }));
    const keyOf = (roomTypeId: string, ratePlanId: string) => `${roomTypeId}:${ratePlanId}`;
    const grouped = new Map<string, { roomTypeId: string; ratePlanId: string; count: number }>();
    for (const selection of selections) {
      const key = keyOf(selection.roomTypeId, selection.ratePlanId);
      const current = grouped.get(key);
      if (current) current.count += 1;
      else grouped.set(key, { roomTypeId: selection.roomTypeId, ratePlanId: selection.ratePlanId, count: 1 });
    }
    const occupancy = { numberOfAdult: room.adults, otherOccupancies: [
      { otherOccupancyRefID: "child", otherOccupancyRefCode: "child", quantity: room.children },
      { otherOccupancyRefID: "infant", otherOccupancyRefCode: "infant", quantity: room.infants },
    ] };
    const [payload, rawDetails] = await Promise.all([
      this.client.request("/common-trd/v1/crs/booking/get-hotel-availability", { body: {
        arrivalDate: input.arrivalDate, departureDate: input.departureDate, numberOfRoom: Math.max(...[...grouped.values()].map((selection) => selection.count)),
        propertyIds: [input.propertyId], distributionChannelId: this.config.distributionChannelId,
        roomOccupancy: occupancy, organization: this.config.organizationCode,
      } }),
      Promise.all([...grouped.values()].map((selection) => this.bedbank.detail({ ...input, rooms: [room], roomTypeId: selection.roomTypeId, ratePlanId: selection.ratePlanId }))),
    ]);
    const property = array(dataOf(payload).rates).map(object).find((item) => identifier(object(item.property).id) === input.propertyId);
    const nights = Math.round((Date.parse(input.departureDate) - Date.parse(input.arrivalDate)) / 86_400_000);
    const dates = Array.from({ length: nights }, (_, index) => new Date(Date.parse(input.arrivalDate) + index * 86_400_000).toISOString().slice(0, 10));
    const checked = new Map<string, { detail: RateDetailDto; roomRates: { stayDate: string; roomTypeCode: string; roomTypeName: string; roomTypeRefID: string; ratePlanCode: string; ratePlanRefID: string; allotmentId: string }[] }>();
    const allotmentUsed = new Map<string, number>();
    const allotmentLimit = new Map<string, number>();
    for (const [index, selection] of [...grouped.values()].entries()) {
      const parsed = rateDetailSchema.safeParse(rawDetails[index]);
      if (!parsed.success) throw invalid();
      const detail = parsed.data;
      const rate = array(property?.rates).map(object).find((item) => {
        const nested = object(item.rateAvailablity);
        return identifier(item.roomTypeID, nested.roomTypeId) === selection.roomTypeId && identifier(item.ratePlanID, nested.ratePlanId) === selection.ratePlanId;
      });
      if (!rate || typeof rate.quantity !== "number" || rate.quantity < selection.count) throw new AppError(409, "NO_AVAILABILITY", "Không còn đủ phòng cho yêu cầu này. Vui lòng tìm lại phòng.");
      if (detail.propertyId !== input.propertyId || detail.roomTypeId !== selection.roomTypeId || detail.ratePlanId !== selection.ratePlanId) throw invalid();
      const nested = object(rate.rateAvailablity);
      const allotment = array(nested.allotments).map(object).find((item) => {
        const id = identifier(item.allotmentId, item.id);
        const quantity = item.quantity;
        return id && typeof quantity === "number" && (allotmentUsed.get(id) ?? 0) + selection.count <= Math.min(allotmentLimit.get(id) ?? quantity, quantity);
      });
      const roomTypeCode = text(nested.roomTypeCode);
      const ratePlanCode = text(nested.ratePlanCode) || text(object(nested.ratePlan).rateCode);
      if (!allotment) throw new AppError(409, "NO_AVAILABILITY", "Không còn đủ phòng cho yêu cầu này. Vui lòng tìm lại phòng.");
      if (!roomTypeCode || !ratePlanCode || detail.total <= 0) throw invalid();
      const allotmentId = identifier(allotment.allotmentId, allotment.id);
      allotmentUsed.set(allotmentId, (allotmentUsed.get(allotmentId) ?? 0) + selection.count);
      allotmentLimit.set(allotmentId, Math.min(allotmentLimit.get(allotmentId) ?? Number(allotment.quantity), Number(allotment.quantity)));
      if (detail.dailyRates.length !== nights || dates.some((date) => !detail.dailyRates.some((item) => item.date === date))) throw invalid();
      checked.set(keyOf(selection.roomTypeId, selection.ratePlanId), { detail,
        roomRates: dates.map((stayDate) => ({ stayDate, roomTypeCode, roomTypeName: detail.roomTypeName,
          roomTypeRefID: selection.roomTypeId, ratePlanCode, ratePlanRefID: selection.ratePlanId, allotmentId })) });
    }
    for (const selection of selections) {
      const detail = checked.get(keyOf(selection.roomTypeId, selection.ratePlanId))!.detail;
      if (detail.total !== selection.expectedUnitTotal || detail.currency !== input.currency) throw new AppError(409, "PRICE_CHANGED", "Giá phòng đã thay đổi. Vui lòng tìm lại phòng và xem giá mới trước khi đặt.");
    }
    const body = { organization: this.config.organizationCode, propertyId: input.propertyId,
      arrivalDate: input.arrivalDate, departureDate: input.departureDate,
      distributionChannel: this.config.distributionChannelId, sourceCode: this.config.sourceCode, requestorId: this.config.requestorId,
      reservations: input.guests.map((guest, index) => ({
        numberOfRoom: 1, totalAmount: { amount: checked.get(keyOf(selections[index]!.roomTypeId, selections[index]!.ratePlanId))!.detail.total, currencyCode: input.currency }, roomOccupancy: occupancy,
        isReferenceIdSpecified: true, referenceIds: [{ type: "Opera_TA_Rec_Loc", value: reference }],
        isSpecialRequestSpecified: Boolean(input.notes), specialRequests: input.notes ? [{ requestType: "BookerInstruction", requestContent: input.notes }] : [],
        isProfilesSpecified: true, profiles: [
          { firstName: actor.displayName, lastName: "", email: actor.email, profileRefID: "", profileType: "Booker" },
          { firstName: this.config.travelAgentName, profileRefID: this.config.travelAgentProfileId, profileType: "TravelAgent" },
          { profileRefID: "BookingPortal", profileType: "BookingClient" },
          ...input.roomGuests[index]!.map((occupant) => ({ ...occupant, profileRefID: "", profileType: "Guest", primarySearchValues: { email: occupant.email, phoneNumber: occupant.phoneNumber } })),
        ],
        isRoomRatesSpecified: true, roomRates: checked.get(keyOf(selections[index]!.roomTypeId, selections[index]!.ratePlanId))!.roomRates, isPackagesSpecified: false, packages: [],
      })),
    };
    const first = checked.get(keyOf(selections[0]!.roomTypeId, selections[0]!.ratePlanId))!.detail;
    return { propertyName: text(object(property?.property).name), roomTypeName: grouped.size === 1 ? first.roomTypeName : "Nhiều hạng phòng", ratePlanName: grouped.size === 1 ? first.ratePlanName : "Nhiều gói giá",
      total: selections.reduce((sum, selection) => sum + checked.get(keyOf(selection.roomTypeId, selection.ratePlanId))!.detail.total, 0), currency: input.currency, body,
      roomLines: selections.map((selection) => { const item = checked.get(keyOf(selection.roomTypeId, selection.ratePlanId))!.detail; return { roomTypeId: selection.roomTypeId, roomTypeName: item.roomTypeName, ratePlanId: selection.ratePlanId, ratePlanName: item.ratePlanName, unitTotal: item.total }; }) };
  }
  async create(prepared: PreparedBooking, reference: string): Promise<BookingReservation[]> {
    return parseBookingReservations(await this.client.request("/common-trd/v1/crs/booking", { body: prepared.body, retry: false, correlationId: reference }), false);
  }
  async guarantees(ids: string[]): Promise<BookingGuarantee[]> {
    const results: BookingGuarantee[] = [];
    for (let index = 0; index < ids.length; index += 4) {
      const batch = await Promise.all(ids.slice(index, index + 4).map(async (id) => {
        const result = parseBookingGuarantee(await this.client.request(`/common-trd/v1/crs/booking/${encodeURIComponent(id)}/guarantee-methods`, { body: { organization: this.config.organizationCode } }));
        if (result.reservationId !== id) throw invalid();
        return result;
      }));
      results.push(...batch);
    }
    return results;
  }
  async confirm(terms: BookingGuarantee[]): Promise<BookingReservation[]> {
    // `guaranteeMethods` makes CiHMS record the stay as paid (Complete/Credit). `guaranteeInfos` with the method ID as the
    // policy and no guaranteeValue leaves it unpaid (No, settledAmount 0). Verified on the test tenant 2026-09-17.
    return parseBookingReservations(await this.client.request("/common-trd/v1/crs/booking/batch-commit", { retry: false, body: {
      items: terms.map((item) => ({ reservationId: item.reservationId,
        guaranteeInfos: [...new Map(item.methods.map((method) => [method.id, method.policyRefId])).entries()]
          .map(([id, policyRefId]) => ({ guaranteePolicyId: id, guaranteeRefID: policyRefId })) })),
      isSendMail: false, organization: this.config.organizationCode,
    } }), true);
  }
}
