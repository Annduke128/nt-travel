// @vitest-environment node
import { describe, expect, test } from "vitest";
import { parseSearchRequest } from "./contracts.js";

const validSearch = {
  destination: "Nha Trang",
  arrivalDate: "2026-08-10",
  departureDate: "2026-08-12",
  rooms: [{ adults: 2, children: 0, infants: 0 }],
};

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
});
