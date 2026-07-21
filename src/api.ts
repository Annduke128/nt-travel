import type { HotelAvailabilityDto, Profile, PropertyDto, RateDetailDto, RoomAvailabilityDto, SearchRequest } from "../shared/contracts";

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new ApiError(payload.error?.code ?? "UPSTREAM_UNAVAILABLE", payload.error?.message ?? "Yêu cầu không thành công", response.status);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as { data: T };
  return payload.data;
}

const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const bedbankApi = {
  me: async () => (await api<{ profile: Profile }>("/api/me")).profile,
  login: async (email: string, password: string) => (await post<{ profile: Profile }>("/api/auth/login", { email, password })).profile,
  logout: () => post<void>("/api/auth/logout"),
  changePassword: (password: string) => post<void>("/api/auth/change-password", { password }),
  properties: (query: string) => api<PropertyDto[]>(`/api/properties?query=${encodeURIComponent(query)}`),
  hotels: (search: SearchRequest) => post<HotelAvailabilityDto[]>("/api/availability/hotels", search),
  rooms: (search: SearchRequest & { propertyId: string }) => post<RoomAvailabilityDto[]>("/api/availability/rooms", search),
  detail: (search: SearchRequest & { propertyId: string; roomTypeId: string; ratePlanId: string }) => post<RateDetailDto>("/api/availability/detail", search),
  users: () => api<Profile[]>("/api/admin/users"),
  createUser: (input: { email: string; displayName: string; role: "admin" | "staff"; temporaryPassword: string }) => post<Profile>("/api/admin/users", input),
  updateUser: (userId: string, input: Record<string, string>) => api<Profile>(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(input) }),
  resetPassword: (userId: string, temporaryPassword: string) => post<void>(`/api/admin/users/${userId}/reset-password`, { temporaryPassword }),
};
