export type Role = "admin" | "staff";
export type UserStatus = "active" | "disabled";
export type Profile = { userId: string; email: string; displayName: string; role: Role; status: UserStatus; mustChangePassword: boolean };
export type RoomOccupancy = { adults: number; children: number; infants: number };
export type SearchRequest = { destination: string; arrivalDate: string; departureDate: string; rooms: RoomOccupancy[] };
export type PropertyDto = { id: string; name: string; city: string; imageUrl?: string };
export type HotelAvailabilityDto = PropertyDto & { quantity: number; fromPrice: number; currency: string };
// `tax` là optional: CloudHMS không trả thuế ở mọi endpoint availability, và bỏ trống
// khác hẳn về nghĩa so với thuế bằng 0.
export type RoomAvailabilityDto = {
  propertyId: string; roomTypeId: string; roomTypeName: string; ratePlanId: string; ratePlanName: string;
  quantity: number; total: number; average: number; tax?: number; currency: string; imageUrl?: string; maxOccupancy?: number;
};
export type RateDetailDto = RoomAvailabilityDto & { dailyRates: { date: string; amount: number; tax?: number }[]; policies: { type: string; description: string }[] };
