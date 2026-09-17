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

export type BookingGuest = { firstName: string; lastName: string; email: string; phoneNumber: string };
export type BookingCreateRequest = SearchRequest & {
  requestId: string; propertyId: string; roomTypeId: string; ratePlanId: string;
  expectedTotal: number; currency: string; guests: BookingGuest[]; notes: string; acceptedPolicies: true;
};
export type BookingReservation = { id: string; confirmationNumber: string; status: string; error?: string };
export type BookingStatus = "creating" | "created" | "confirming" | "confirmed" | "attention";
export type BookingDto = {
  id: string; reference: string; createdAt: string; mode: "mock" | "live"; status: BookingStatus;
  propertyName: string; roomTypeName: string; ratePlanName: string; total: number; currency: string;
  request: BookingCreateRequest; reservations: BookingReservation[]; message?: string;
};
export type BookingGuarantee = {
  reservationId: string; amount: number; currency: string; dueDate?: string;
  // policyRefId là detail.id của guarantee method; batch commit gửi nó làm guaranteeRefID.
  methods: { id: string; policyRefId: string; type: string; amount: number; currency: string; stayDate?: string }[];
};
export type BookingGuaranteesDto = { version: string; guarantees: BookingGuarantee[] };
