import { rateKey, sameRate, type RateDetailDto, type RoomAvailabilityDto, type RoomStayQuote } from "./contracts.js";

export function stayDates(arrival: string, departure: string): string[] {
  const dates: string[] = [];
  for (let time = Date.parse(`${arrival}T00:00:00Z`), end = Date.parse(`${departure}T00:00:00Z`); time < end; time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}
export const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function replaceNight(stays: RoomStayQuote[], date: string, replacement: RoomAvailabilityDto) {
  const dates = stayDates(stays[0]!.arrivalDate, stays.at(-1)!.departureDate);
  const result: { arrivalDate: string; departureDate: string; rate: RoomAvailabilityDto }[] = [];
  for (const night of dates) {
    const rate = night === date ? replacement : stays.find((stay) => stay.arrivalDate <= night && night < stay.departureDate)!.detail;
    const previous = result.at(-1);
    if (previous && sameRate(previous.rate, rate)) previous.departureDate = nextDate(night);
    else result.push({ arrivalDate: night, departureDate: nextDate(night), rate });
  }
  return result;
}

export function rebaseStays(stays: RoomStayQuote[], arrivalDate: string, departureDate: string) {
  const previousDates = stayDates(stays[0]!.arrivalDate, stays.at(-1)!.departureDate);
  const plan: { arrivalDate: string; departureDate: string; rate: RoomAvailabilityDto }[] = [];
  stayDates(arrivalDate, departureDate).forEach((date, index) => {
    const previousDate = previousDates[Math.min(index, previousDates.length - 1)]!;
    const rate = stays.find((stay) => stay.arrivalDate <= previousDate && previousDate < stay.departureDate)!.detail;
    const previous = plan.at(-1);
    if (previous && sameRate(previous.rate, rate)) previous.departureDate = nextDate(date);
    else plan.push({ arrivalDate: date, departureDate: nextDate(date), rate });
  });
  return plan;
}

export function roomStayStockAvailable(rooms: RoomStayQuote[][]): boolean {
  const used = new Map<string, number>();
  const limits = new Map<string, number>();
  for (const room of rooms) for (const stay of room) for (const date of stayDates(stay.arrivalDate, stay.departureDate)) {
    const rate = stay.detail;
    const keys = [`${date}:rate:${rateKey(rate)}`, ...(rate.allotmentId ? [`${date}:allotment:${rate.allotmentId}`] : [])];
    for (const key of keys) {
      const count = (used.get(key) ?? 0) + 1;
      const limit = Math.min(limits.get(key) ?? rate.quantity, rate.quantity);
      if (count > limit) return false;
      used.set(key, count); limits.set(key, limit);
    }
  }
  return true;
}

export function summarizeStays(stays: RoomStayQuote[]): RateDetailDto {
  const first = stays[0]!.detail;
  if (stays.length === 1) return first;
  const unique = (values: string[]) => [...new Set(values)].join(" → ");
  const total = stays.reduce((sum, stay) => sum + stay.detail.total, 0);
  const policies = new Map(stays.flatMap((stay) => stay.detail.policies.map((policy) => [`${policy.type}:${policy.description}`, policy] as const)));
  return { ...first, roomTypeName: unique(stays.map((stay) => stay.detail.roomTypeName)), roomTypeCode: undefined,
    ratePlanName: unique(stays.map((stay) => stay.detail.ratePlanName)), allotmentName: unique(stays.map((stay) => stay.detail.allotmentName ?? stay.detail.allotmentId ?? "")) || undefined,
    total, average: total / stayDates(stays[0]!.arrivalDate, stays.at(-1)!.departureDate).length,
    quantity: Math.min(...stays.map((stay) => stay.detail.quantity)),
    maxOccupancy: stays.some((stay) => stay.detail.maxOccupancy === undefined) ? undefined : Math.min(...stays.map((stay) => stay.detail.maxOccupancy!)),
    tax: stays.some((stay) => stay.detail.tax === undefined) ? undefined : stays.reduce((sum, stay) => sum + stay.detail.tax!, 0),
    dailyRates: stays.flatMap((stay) => stay.detail.dailyRates).sort((a, b) => a.date.localeCompare(b.date)), policies: [...policies.values()] };
}
