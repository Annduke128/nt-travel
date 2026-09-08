import { z } from "zod";
export type { HotelAvailabilityDto, PropertyDto, RateDetailDto, RoomAvailabilityDto, SearchRequest } from "../shared/contracts.js";

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
  rooms: z.array(roomOccupancySchema).min(1).max(8),
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
  guests: z.array(bookingGuestSchema).min(1).max(8), notes: z.string().trim().max(1000).default(""),
  acceptedPolicies: z.literal(true),
}).superRefine((value, context) => {
  if (value.guests.length !== value.rooms.length) context.addIssue({ code: "custom", path: ["guests"], message: "Cần một khách đại diện cho mỗi phòng" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (value.arrivalDate < today) context.addIssue({ code: "custom", path: ["arrivalDate"], message: "Ngày nhận phòng đã qua" });
  if ((Date.parse(value.departureDate) - Date.parse(value.arrivalDate)) / 86_400_000 > 30) context.addIssue({ code: "custom", path: ["departureDate"], message: "Mỗi đặt phòng hỗ trợ tối đa 30 đêm" });
});
export const bookingConfirmSchema = z.object({ guaranteeVersion: z.string().regex(/^[a-f0-9]{64}$/), acceptedGuarantee: z.literal(true) });
