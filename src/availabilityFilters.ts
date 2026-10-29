import type { HotelAvailabilityDto, RateFilterData } from "../shared/contracts";

export type AvailabilityFilters = { propertyType: string; starRating: string; price: string; policy: string; service: string };
export const EMPTY_FILTERS: AvailabilityFilters = { propertyType: "", starRating: "", price: "", policy: "", service: "" };
export const hasFilters = (filters: AvailabilityFilters) => Object.values(filters).some(Boolean);

export function matchesRate(rate: RateFilterData, filters: AvailabilityFilters, hotelServices: string[] = []) {
  if (filters.price) {
    if (rate.currency !== "VND") return false;
    const bounds: Record<string, [number, number]> = { "under-2": [0, 2_000_000], "2-5": [2_000_000, 5_000_000], "5-10": [5_000_000, 10_000_000], "over-10": [10_000_000, Infinity] };
    const [min, max] = bounds[filters.price]!;
    if (rate.total < min || rate.total >= max) return false;
  }
  if (filters.policy && rate.cancellationPolicy !== filters.policy) return false;
  if (filters.service && !hotelServices.includes(filters.service) && !rate.services?.includes(filters.service)) return false;
  return true;
}

export function filterHotels(hotels: HotelAvailabilityDto[], filters: AvailabilityFilters): HotelAvailabilityDto[] {
  return hotels.flatMap((hotel) => {
    if (filters.propertyType && hotel.propertyType !== filters.propertyType) return [];
    if (filters.starRating && String(hotel.starRating) !== filters.starRating) return [];
    // Giá và chính sách phải cùng thuộc một chương trình; không ghép hai ưu đãi khác nhau.
    const programs = (hotel.programs ?? [{ total: hotel.fromPrice, currency: hotel.currency }]).filter((rate) => matchesRate(rate, filters, hotel.services));
    if (programs.length === 0) return [];
    const best = programs.reduce((lowest, rate) => rate.total < lowest.total ? rate : lowest);
    return [{ ...hotel, fromPrice: best.total, currency: best.currency }];
  });
}
