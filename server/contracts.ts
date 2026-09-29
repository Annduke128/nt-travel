import { z } from "zod";
import { MAX_BOOKING_ROOMS } from "../shared/contracts.js";
export type { HotelAvailabilityDto, NoAvailabilityDetails, PropertyDto, RateDetailDto, RoomAvailabilityDto, SearchRequest } from "../shared/contracts.js";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const calendarDate = (message: string) => z.string().regex(isoDate, message).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}, message);

export const roomOccupancySchema = z.object({
  adults: z.number().int().min(1, "Mỗi phòng phải có ít nhất một người lớn").max(8),
  children: z.number().int().min(0).max(6),
  infants: z.number().int().min(0).max(4),
});

export const searchRequestSchema = z.object({
  destination: z.string().trim().min(1).max(120),
  arrivalDate: calendarDate("Ngày nhận phòng không hợp lệ"),
  departureDate: calendarDate("Ngày trả phòng không hợp lệ"),
  rooms: z.array(roomOccupancySchema).min(1).max(MAX_BOOKING_ROOMS),
}).superRefine((value, context) => {
  if (value.departureDate <= value.arrivalDate) {
    context.addIssue({ code: "custom", path: ["departureDate"], message: "Ngày trả phòng phải sau ngày nhận phòng" });
  }
  // CloudHMS availability chỉ nhận một roomOccupancy kèm numberOfRoom, nên V1 không thể
  // biểu diễn các phòng có số khách khác nhau trong cùng một truy vấn.
  const [first, ...rest] = value.rooms;
  if (first && rest.some((room) => room.adults !== first.adults || room.children !== first.children || room.infants !== first.infants)) {
    context.addIssue({ code: "custom", path: ["rooms"], message: "V1 chỉ hỗ trợ các phòng có cùng số khách" });
  }
});

import type { SearchRequest } from "../shared/contracts.js";
export const parseSearchRequest = (input: unknown): SearchRequest => searchRequestSchema.parse(input);

// CloudHMS trả GUID toàn số 0 thay cho ID thật ở một số endpoint. Chuỗi đó qua được `z.string()`
// nhưng vô dụng với mọi call tiếp theo, nên hợp đồng đầu ra phải chặn nó ngay tại biên.
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
const upstreamId = z.string().min(1).refine((value) => value !== ZERO_GUID, "CloudHMS trả định danh rỗng");

export const propertySchema = z.object({ id: upstreamId, name: z.string(), city: z.string(), imageUrl: z.string().url().optional() });

export const hotelAvailabilitySchema = propertySchema.extend({
  quantity: z.number().int().nonnegative(),
  fromPrice: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
});

export const roomAvailabilitySchema = z.object({
  propertyId: upstreamId,
  roomTypeId: upstreamId,
  roomTypeName: z.string().min(1),
  ratePlanId: upstreamId,
  ratePlanName: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  total: z.number().nonnegative(),
  average: z.number().nonnegative(),
  tax: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(3),
  imageUrl: z.string().url().optional(),
  maxOccupancy: z.number().int().positive().optional(),
});

export const rateDetailSchema = roomAvailabilitySchema.extend({
  dailyRates: z.array(z.object({ date: z.string().regex(isoDate), amount: z.number().nonnegative(), tax: z.number().nonnegative().optional() })),
  policies: z.array(z.object({ type: z.string(), description: z.string() })),
});

export const roomSearchSchema = searchRequestSchema.extend({ propertyId: z.string().min(1) });
export const detailSearchSchema = roomSearchSchema.extend({ roomTypeId: z.string().min(1), ratePlanId: z.string().min(1) });

export const bookingGuestSchema = z.object({
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254), phoneNumber: z.string().trim().regex(/^\+?[0-9 ()-]{7,25}$/),
});
export const bookingCreateSchema = detailSearchSchema.extend({
  requestId: z.uuid(), expectedTotal: z.number().positive().max(1e12), currency: z.string().regex(/^[A-Z]{3}$/),
  journeyId: z.uuid().optional(), journeyLeg: z.number().int().min(1).max(20).optional(),
  roomSelections: z.array(z.object({ roomTypeId: z.string().min(1), ratePlanId: z.string().min(1), expectedUnitTotal: z.number().positive().max(1e12) })).min(1).max(MAX_BOOKING_ROOMS).optional(),
  guests: z.array(bookingGuestSchema).min(1).max(MAX_BOOKING_ROOMS), notes: z.string().trim().max(1000).default(""),
  roomGuests: z.array(z.array(bookingGuestSchema).min(1).max(18)).min(1).max(MAX_BOOKING_ROOMS),
  acceptedPolicies: z.literal(true),
}).superRefine((value, context) => {
  if ((value.journeyId === undefined) !== (value.journeyLeg === undefined)) context.addIssue({ code: "custom", path: ["journeyId"], message: "Mã hành trình và số chặng phải đi cùng nhau" });
  if (value.guests.length !== value.rooms.length) context.addIssue({ code: "custom", path: ["guests"], message: "Cần một khách đại diện cho mỗi phòng" });
  if (value.roomGuests.length !== value.rooms.length) context.addIssue({ code: "custom", path: ["roomGuests"], message: "Cần danh sách khách cho từng phòng" });
  value.rooms.forEach((room, index) => {
    const occupants = value.roomGuests[index];
    if (occupants?.length !== room.adults + room.children + room.infants) context.addIssue({ code: "custom", path: ["roomGuests", index], message: "Số khách không khớp với số khách đã tìm" });
    if (occupants?.[0] && JSON.stringify(occupants[0]) !== JSON.stringify(value.guests[index])) context.addIssue({ code: "custom", path: ["roomGuests", index, 0], message: "Khách đại diện không khớp" });
  });
  if (value.roomSelections) {
    if (value.roomSelections.length !== value.rooms.length) context.addIssue({ code: "custom", path: ["roomSelections"], message: "Cần chọn hạng phòng cho từng phòng" });
    if (value.roomSelections[0]?.roomTypeId !== value.roomTypeId || value.roomSelections[0]?.ratePlanId !== value.ratePlanId) context.addIssue({ code: "custom", path: ["roomSelections"], message: "Hạng phòng đầu tiên không khớp" });
    const sum = value.roomSelections.reduce((total, room) => total + room.expectedUnitTotal, 0);
    if (sum !== value.expectedTotal) context.addIssue({ code: "custom", path: ["expectedTotal"], message: "Tổng giá không khớp với giá từng phòng" });
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (value.arrivalDate < today) context.addIssue({ code: "custom", path: ["arrivalDate"], message: "Ngày nhận phòng đã qua" });
  if ((Date.parse(value.departureDate) - Date.parse(value.arrivalDate)) / 86_400_000 > 30) context.addIssue({ code: "custom", path: ["departureDate"], message: "Mỗi đặt phòng hỗ trợ tối đa 30 đêm" });
});
export const bookingConfirmSchema = z.object({ guaranteeVersion: z.string().regex(/^[a-f0-9]{64}$/), acceptedGuarantee: z.literal(true) });
