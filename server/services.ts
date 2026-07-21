import type { HotelAvailabilityDto, Profile, PropertyDto, RateDetailDto, Role, RoomAvailabilityDto, SearchRequest, UserStatus } from "../shared/contracts.js";
export type { Profile, Role, UserStatus } from "../shared/contracts.js";

export type Session = { profile: Profile; accessToken: string; refreshToken: string; expiresIn: number };

export interface AuthService {
  login(email: string, password: string): Promise<Session>;
  authenticate(accessToken: string): Promise<Profile>;
  refresh(refreshToken: string): Promise<Session>;
  logout(accessToken: string): Promise<void>;
  changePassword(profile: Profile, password: string): Promise<void>;
  listUsers(): Promise<Profile[]>;
  createUser(actor: Profile, input: { email: string; displayName: string; role: Role; temporaryPassword: string }): Promise<Profile>;
  updateUser(actor: Profile, userId: string, input: { role?: Role; status?: UserStatus; displayName?: string }): Promise<Profile>;
  resetPassword(actor: Profile, userId: string, temporaryPassword: string): Promise<void>;
}

export interface BedbankService {
  properties(query: string): Promise<PropertyDto[]>;
  hotels(search: SearchRequest): Promise<HotelAvailabilityDto[]>;
  rooms(search: SearchRequest & { propertyId: string }): Promise<RoomAvailabilityDto[]>;
  detail(search: SearchRequest & { propertyId: string; roomTypeId: string; ratePlanId: string }): Promise<RateDetailDto>;
}
