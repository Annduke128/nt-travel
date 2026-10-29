// @vitest-environment node
import { describe, expect, test } from "vitest";
import { bookingCreateSchema, bookingGuestSchema, parseSearchRequest } from "./contracts.js";

const validSearch = {
  destination: "Nha Trang",
  arrivalDate: "2026-08-10",
  departureDate: "2026-08-12",
  rooms: [{ adults: 2, children: 0, infants: 0 }],
};

describe("guest identity and optional contacts", () => {
  const identity = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "US" };
  test.each([undefined, "", "   "])("accepts optional blank contacts %s and preserves different country/nationality", (contact) => {
    expect(bookingGuestSchema.parse({ ...identity, email: contact, phoneNumber: contact })).toEqual({ ...identity, email: "", phoneNumber: "" });
  });
  test.each(["firstName", "lastName", "country", "nationality"])("requires %s for each guest", (field) => {
    expect(bookingGuestSchema.safeParse({ ...identity, email: "an@example.com", phoneNumber: "0912345678", [field]: "" }).success).toBe(false);
  });
  test("normalizes valid country codes and rejects unknown codes or malformed provided contacts", () => {
    expect(bookingGuestSchema.parse({ ...identity, country: " vn ", nationality: " us " })).toMatchObject(identity);
    for (const input of [{ country: "ZZ" }, { nationality: "Vietnam" }, { email: "bad" }, { phoneNumber: "abcdefghi" }]) {
      expect(bookingGuestSchema.safeParse({ ...identity, ...input }).success).toBe(false);
    }
  });
});

describe("search contract", () => {
  test("accepts normalized per-room occupancy", () => {
    expect(parseSearchRequest(validSearch)).toEqual(validSearch);
  });

  test("rejects a departure date that is not after arrival", () => {
    expect(() => parseSearchRequest({ ...validSearch, departureDate: "2026-08-10" }))
      .toThrow("Ngày trả phòng phải sau ngày nhận phòng");
  });

  test("rejects invalid room occupancy", () => {
    expect(() => parseSearchRequest({ ...validSearch, rooms: [{ adults: 0, children: 0, infants: 0 }] }))
      .toThrow("Mỗi phòng phải có ít nhất một người lớn");
  });

  test("accepts several rooms that share the same occupancy", () => {
    const rooms = [{ adults: 2, children: 1, infants: 0 }, { adults: 2, children: 1, infants: 0 }];

    expect(parseSearchRequest({ ...validSearch, rooms }).rooms).toHaveLength(2);
  });

  test("supports a group of 20 rooms while rejecting larger requests", () => {
    const rooms = Array.from({ length: 20 }, () => validSearch.rooms[0]!);
    expect(parseSearchRequest({ ...validSearch, rooms }).rooms).toHaveLength(20);
    expect(() => parseSearchRequest({ ...validSearch, rooms: [...rooms, validSearch.rooms[0]] })).toThrow();
  });

  test("rejects rooms with different occupancy because CloudHMS takes one per request", () => {
    expect(() => parseSearchRequest({ ...validSearch, rooms: [{ adults: 2, children: 0, infants: 0 }, { adults: 1, children: 2, infants: 0 }] }))
      .toThrow("V1 chỉ hỗ trợ các phòng có cùng số khách");
  });

  test("rejects impossible calendar dates", () => {
    expect(() => parseSearchRequest({ ...validSearch, arrivalDate: "2026-02-30" }))
      .toThrow("Ngày nhận phòng không hợp lệ");
  });
});

describe("mixed room booking contract", () => {
  const guestA = { firstName: "An", lastName: "Nguyen", country: "VN", nationality: "VN", email: "an@example.com", phoneNumber: "0912345678" };
  const guestB = { firstName: "Binh", lastName: "Tran", country: "VN", nationality: "VN", email: "binh@example.com", phoneNumber: "0912345679" };
  const booking = {
    ...validSearch, arrivalDate: "2099-08-10", departureDate: "2099-08-12",
    rooms: [validSearch.rooms[0], validSearch.rooms[0]],
    requestId: "22222222-2222-4222-8222-222222222222", propertyId: "hotel",
    roomTypeId: "deluxe", ratePlanId: "breakfast", expectedTotal: 7000000, currency: "VND",
    guests: [guestA, guestB], roomGuests: [[guestA, guestB], [guestB, guestA]],
    roomSelections: [
      { roomTypeId: "deluxe", ratePlanId: "breakfast", expectedUnitTotal: 4000000 },
      { roomTypeId: "standard", ratePlanId: "room-only", expectedUnitTotal: 3000000 },
    ],
    notes: "", acceptedPolicies: true,
  };

  test("accepts one priced selection for each room", () => {
    expect(bookingCreateSchema.parse(booking).roomSelections).toHaveLength(2);
  });

  test("accepts different guest counts by room while keeping search quotes uniform", () => {
    const rooms = [booking.rooms[0]!, { ...booking.rooms[1]!, adults: 3 }];
    const roomGuests = [booking.roomGuests[0]!, [...booking.roomGuests[1]!, { ...guestA, firstName: "Chi" }]];
    expect(bookingCreateSchema.parse({ ...booking, rooms, roomGuests }).rooms[1]!.adults).toBe(3);
    expect(() => parseSearchRequest({ ...validSearch, rooms })).toThrow();
  });

  test("rejects a selection count or total that differs from the rooms", () => {
    expect(() => bookingCreateSchema.parse({ ...booking, roomSelections: booking.roomSelections.slice(0, 1) })).toThrow();
    expect(() => bookingCreateSchema.parse({ ...booking, expectedTotal: 6000000 })).toThrow();
  });

  test("accepts a 20-room group with a rate and all guests assigned to each room", () => {
    const rooms = Array.from({ length: 20 }, () => validSearch.rooms[0]!);
    const guests = rooms.map((_, index) => ({ ...guestA, email: `lead${index}@example.com` }));
    const roomGuests = guests.map((guest, index) => [guest, { ...guestB, email: `second${index}@example.com` }]);
    const roomSelections = rooms.map((_, index) => index < 10 ? booking.roomSelections[0]! : booking.roomSelections[1]!);
    const group = { ...booking, rooms, guests, roomGuests, roomSelections, expectedTotal: 70000000 };
    expect(bookingCreateSchema.parse(group).roomGuests).toHaveLength(20);
    expect(() => bookingCreateSchema.parse({ ...group, rooms: [...rooms, rooms[0]!] })).toThrow();
  });

  test("requires every searched guest and the lead to match the room contact", () => {
    expect(() => bookingCreateSchema.parse({ ...booking, roomGuests: undefined })).toThrow();
    const roomGuests = booking.rooms.map((room, index) => Array.from({ length: room.adults + room.children + room.infants }, (_, person) => person === 0 ? booking.guests[index]! : { firstName: "Guest", lastName: "Two", country: "VN", nationality: "VN", email: "two@example.com", phoneNumber: "0912345680" }));
    expect(bookingCreateSchema.parse({ ...booking, roomGuests }).roomGuests).toHaveLength(2);
    const sameLeadDifferentKeyOrder = { country: booking.guests[0]!.country, nationality: booking.guests[0]!.nationality, phoneNumber: booking.guests[0]!.phoneNumber, email: booking.guests[0]!.email, lastName: booking.guests[0]!.lastName, firstName: booking.guests[0]!.firstName };
    expect(bookingCreateSchema.parse({ ...booking, roomGuests: [[sameLeadDifferentKeyOrder, roomGuests[0]![1]!], roomGuests[1]!] }).roomGuests).toHaveLength(2);
    expect(() => bookingCreateSchema.parse({ ...booking, roomGuests: [roomGuests[0]!.slice(0, 1), roomGuests[1]!] })).toThrow();
    expect(() => bookingCreateSchema.parse({ ...booking, roomGuests: [[{ ...roomGuests[0]![0]!, firstName: "Other" }, roomGuests[0]![1]!], roomGuests[1]!] })).toThrow();
  });
});
