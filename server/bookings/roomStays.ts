import { rateKey, type BookingCreateRequest } from "../../shared/contracts.js";
import { stayDates } from "../../shared/roomStays.js";
import { AppError } from "../errors.js";
import type { PreparedBooking } from "./service.js";

export type PreparedStay = { roomIndex: number; arrivalDate: string; departureDate: string; prepared: PreparedBooking };

export async function prepareRoomStayPlan(input: BookingCreateRequest, prepareSingle: (input: BookingCreateRequest) => Promise<PreparedBooking>, mergeBody: (parts: PreparedStay[]) => unknown): Promise<PreparedBooking> {
  const parts = await Promise.all(input.roomStaySelections!.flatMap((stays, roomIndex) => stays.map(async (stay): Promise<PreparedStay> => {
    const prepared = await prepareSingle({ ...input, ...stay, roomStaySelections: undefined, roomSelections: [{ roomTypeId: stay.roomTypeId, ratePlanId: stay.ratePlanId, allotmentId: stay.allotmentId, expectedUnitTotal: stay.expectedUnitTotal }], expectedTotal: stay.expectedUnitTotal,
      rooms: [input.rooms[roomIndex]!], guests: [input.guests[roomIndex]!], roomGuests: [input.roomGuests[roomIndex]!] });
    return { roomIndex, arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, prepared };
  })));
  const used = new Map<string, number>();
  const limits = new Map<string, number>();
  for (const part of parts) {
    if (!part.prepared.availabilityChecks?.length) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Chưa kiểm tra được tồn phòng theo ngày.");
    for (const stock of part.prepared.availabilityChecks) for (const date of stayDates(stock.arrivalDate, stock.departureDate)) {
      const keys = [`${date}:rate:${rateKey(stock)}`, ...(stock.allotmentId ? [`${date}:allotment:${stock.allotmentId}`] : [])];
      for (const key of keys) {
        const count = (used.get(key) ?? 0) + 1;
        const limit = Math.min(limits.get(key) ?? stock.quantity, stock.quantity);
        if (count > limit) throw new AppError(409, "NO_AVAILABILITY", "Không còn đủ phòng hoặc allotment cho một trong các đêm đã chọn.");
        used.set(key, count); limits.set(key, limit);
      }
    }
  }
  const first = parts[0]!.prepared;
  return { propertyName: first.propertyName, roomTypeName: "Mã phòng theo từng đêm", ratePlanName: "Chương trình theo ngày", currency: input.currency,
    total: parts.reduce((sum, part) => sum + part.prepared.total, 0), body: mergeBody(parts),
    availabilityChecks: parts.flatMap((part) => part.prepared.availabilityChecks ?? []),
    roomLines: parts.flatMap((part) => (part.prepared.roomLines ?? []).map((line) => ({ ...line, roomIndex: part.roomIndex, arrivalDate: part.arrivalDate, departureDate: part.departureDate }))) };
}
