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

  test("accepts several rooms that share the same occupancy", () => {
    const rooms = [{ adults: 2, children: 1, infants: 0 }, { adults: 2, children: 1, infants: 0 }];

    expect(parseSearchRequest({ ...validSearch, rooms }).rooms).toHaveLength(2);
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
