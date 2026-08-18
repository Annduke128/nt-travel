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

export const propertySchema = z.object({ id: z.string(), name: z.string(), city: z.string(), imageUrl: z.string().url().optional() });

export const hotelAvailabilitySchema = propertySchema.extend({
  quantity: z.number().int().nonnegative(),
  fromPrice: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
});

export const roomAvailabilitySchema = z.object({
  propertyId: z.string(),
  roomTypeId: z.string(),
  roomTypeName: z.string(),
  ratePlanId: z.string(),
  ratePlanName: z.string(),
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
