export type Role = "admin" | "staff";
export const MAX_BOOKING_ROOMS = 20;
export type UserStatus = "active" | "disabled";
export type Profile = { userId: string; email: string; displayName: string; role: Role; status: UserStatus; mustChangePassword: boolean };
export type RoomOccupancy = { adults: number; children: number; infants: number };
export type SearchRequest = { destination: string; arrivalDate: string; departureDate: string; rooms: RoomOccupancy[] };
export type CancellationPolicy = "refundable" | "non-refundable";
export type RateFilterData = { total: number; currency: string; cancellationPolicy?: CancellationPolicy; services?: string[] };
export type RateIdentity = { roomTypeId: string; ratePlanId: string; allotmentId?: string };
export const rateKey = (rate: RateIdentity) => JSON.stringify([rate.roomTypeId, rate.allotmentId ?? null, rate.ratePlanId]);
export const sameRate = (first: RateIdentity, second: RateIdentity) => rateKey(first) === rateKey(second);
export type RateDetailRequest = SearchRequest & { propertyId: string } & RateIdentity;
export type PropertyDto = { id: string; name: string; city: string; imageUrl?: string; starRating?: number; propertyType?: string; services?: string[] };
export type HotelAvailabilityDto = PropertyDto & { quantity: number; fromPrice: number; currency: string; programs?: RateFilterData[] };
// `details` của lỗi NO_AVAILABILITY: khách sạn đã khớp tên nhưng không còn phòng cho ngày đã
// chọn. Nhân viên cần thấy danh sách này để đổi ngày mà không phải gõ lại tên.
export type NoAvailabilityDetails = { properties: PropertyDto[] };
// `tax` là optional: CloudHMS không trả thuế ở mọi endpoint availability, và bỏ trống
// khác hẳn về nghĩa so với thuế bằng 0.
export type RoomAvailabilityDto = {
  propertyId: string; roomTypeId: string; roomTypeName: string; roomTypeCode?: string; ratePlanId: string; ratePlanName: string;
  quantity: number; total: number; average: number; tax?: number; currency: string; imageUrl?: string; maxOccupancy?: number;
  cancellationPolicy?: CancellationPolicy; services?: string[];
  allotmentId?: string; allotmentName?: string;
};
export type RateDetailDto = RoomAvailabilityDto & { dailyRates: { date: string; amount: number; tax?: number }[]; policies: { type: string; description: string }[] };

export type BookingGuest = { firstName: string; lastName: string; country: string; nationality: string; email?: string; phoneNumber?: string };
export type BookingRoomSelection = RateIdentity & { expectedUnitTotal: number };
export type BookingRoomStaySelection = BookingRoomSelection & { arrivalDate: string; departureDate: string };
export type RoomStayQuote = { arrivalDate: string; departureDate: string; detail: RateDetailDto };
export type BookingCreateRequest = SearchRequest & {
  requestId: string; propertyId: string; roomTypeId: string; ratePlanId: string;
  allotmentId?: string;
  journeyId?: string; journeyLeg?: number;
  roomSelections?: BookingRoomSelection[];
  roomStaySelections?: BookingRoomStaySelection[][];
  expectedTotal: number; currency: string; guests: BookingGuest[]; roomGuests: BookingGuest[][]; notes: string; acceptedPolicies: true;
};
export type BookingReservation = { id: string; confirmationNumber: string; status: string; error?: string };
export type BookingRoomLine = { roomTypeId: string; roomTypeName: string; ratePlanId: string; ratePlanName: string; unitTotal: number; allotmentId?: string; allotmentName?: string; roomIndex?: number; arrivalDate?: string; departureDate?: string };
export type BookingStatus = "creating" | "created" | "confirming" | "confirmed" | "attention";
export type BookingDto = {
  id: string; reference: string; createdAt: string; mode: "mock" | "live"; status: BookingStatus;
  propertyName: string; roomTypeName: string; ratePlanName: string; total: number; currency: string;
  request: BookingCreateRequest; roomLines?: BookingRoomLine[]; reservations: BookingReservation[]; message?: string;
};
export type BookingGuarantee = {
  reservationId: string; amount: number; currency: string; dueDate?: string;
  // policyRefId là detail.id của guarantee method; batch commit gửi nó làm guaranteeRefID.
  methods: { id: string; policyRefId: string; type: string; amount: number; currency: string; stayDate?: string }[];
};
export type BookingGuaranteesDto = { version: string; guarantees: BookingGuarantee[] };
