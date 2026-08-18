// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { CloudHmsBedbankService } from "./bedbank.js";
import type { CloudHmsClient } from "./client.js";
import hotelAvailability from "./fixtures/hotel-availability.json" with { type: "json" };
import hotelsInfo from "./fixtures/hotels-info.json" with { type: "json" };
import roomAvailability from "./fixtures/room-availability.json" with { type: "json" };
import roomDetailAvailability from "./fixtures/room-detail-availability.json" with { type: "json" };
import roomTypes from "./fixtures/room-type.json" with { type: "json" };

const VINOASIS = "c67377fc-d81d-4208-add9-47e32b69f998";
const PAID_ROOM_TYPE = "1634b9cc-19a0-47ca-9d93-0ff14270c0e3";
const PAID_RATE_PLAN = "1c6b89c1-a351-484c-8416-d36b1357f73d";
const DETAIL_ROOM_TYPE = "5051e26c-e710-4028-90ae-ad929b0309e7";
const DETAIL_RATE_PLAN = "1604924a-a9c1-4197-b013-2e61d6a193d0";

const search = {
  destination: "Phú Quốc",
  arrivalDate: "2026-06-01",
  departureDate: "2026-06-03",
  rooms: [{ adults: 2, children: 0, infants: 0 }],
};

const clone = <T>(value: T): T => structuredClone(value);

/** Một trang catalog theo đúng envelope thật: server tự giới hạn page size xuống 30. */
function catalogPage(page: number, size: number) {
  const template = hotelsInfo.data.items;
  return { data: { total: 50, limit: 30, page, items: Array.from({ length: size }, (_, index) => ({
    ...clone(template[index % template.length]!),
    id: `${page}-${index}`,
    name: `Resort Phú Quốc ${page}-${index}`,
  })) } };
}

function service(request: (path: string, options?: unknown) => Promise<unknown>) {
  return new CloudHmsBedbankService({ request } as unknown as CloudHmsClient, "channel-id", "Vingroup");
}

/** Router mặc định: catalog một trang chứa property thật, còn lại lấy từ fixture. */
function routed(overrides: Record<string, unknown> = {}) {
  const request = vi.fn(async (path: string, _options?: unknown) => {
    if (path.includes("hotels/info")) return overrides.catalog ?? clone(hotelsInfo);
    if (path.includes("room-type")) return overrides.roomType ?? clone(roomTypes);
    if (path.includes("get-hotel-availability")) return overrides.hotels ?? clone(hotelAvailability);
    if (path.includes("get-room-availability")) return overrides.rooms ?? clone(roomAvailability);
    if (path.includes("get-room-detail-availability")) return overrides.detail ?? clone(roomDetailAvailability);
    throw new Error(`Unexpected path ${path}`);
  });
  return { request, service: service(request) };
}

describe("CloudHMS property catalog", () => {
  test("keeps paging when the server caps the requested page size", async () => {
    const request = vi.fn(async (path: string) => path.includes("page=0") ? catalogPage(0, 30) : catalogPage(1, 20));

    const result = await service(request).properties("resort");

    expect(request).toHaveBeenNthCalledWith(1, expect.stringContaining("page=0&limit=200"), { method: "GET" });
    expect(request).toHaveBeenNthCalledWith(2, expect.stringContaining("page=1&limit=200"), { method: "GET" });
    expect(request).toHaveBeenCalledTimes(2);
    // 50 property khớp `total`; chỉ trả tối đa 20 gợi ý cho ô tìm kiếm.
    expect(result).toHaveLength(20);
  });

  test("stops after a single page when the catalog fits in it", async () => {
    const request = vi.fn(async () => ({ data: { total: 2, limit: 30, page: 0, items: clone(hotelsInfo.data.items) } }));

    await service(request).properties("");

    expect(request).toHaveBeenCalledTimes(1);
  });

  test("keeps only active properties and maps the safe fields", async () => {
    const items = clone(hotelsInfo.data.items);
    items.push({ ...clone(items[0]!), id: "closed", name: "Closed Resort Phú Quốc", status: 0 as never });
    const request = vi.fn(async () => ({ data: { total: items.length, limit: 30, page: 0, items } }));

    const result = await service(request).properties("phú quốc");

    expect(result).toEqual([{ id: VINOASIS, name: "VinOasis Phú Quốc", city: "Phú Quốc" }]);
  });
});

describe("CloudHMS hotel availability", () => {
  test("ignores rate plans without a price when picking the lead rate", async () => {
    const { service: bedbank } = routed();

    const [hotel] = await bedbank.hotels(search);

    // Rate 0 đồng (quantity 47) là rate chưa nạp giá cho channel; giá dẫn phải là rate thật.
    expect(hotel).toEqual({ id: VINOASIS, name: "VinOasis Phú Quốc", city: "Phú Quốc", quantity: 146, fromPrice: 1_000_000, currency: "VND" });
  });

  test("drops a property whose rates are all unpriced", async () => {
    const payload = clone(hotelAvailability);
    payload.data.rates[0]!.rates = [payload.data.rates[0]!.rates[0]!];
    const { service: bedbank } = routed({ hotels: payload });

    expect(await bedbank.hotels(search)).toEqual([]);
  });

  test("sends per-room occupancy alongside the room count", async () => {
    const { request, service: bedbank } = routed();

    await bedbank.hotels({ ...search, rooms: [{ adults: 2, children: 1, infants: 0 }, { adults: 2, children: 1, infants: 0 }] });

    const [, options] = request.mock.calls.find(([path]) => String(path).includes("get-hotel-availability"))!;
    expect((options as { body: Record<string, unknown> }).body).toMatchObject({
      numberOfRoom: 2,
      // Không cộng dồn: CloudHMS hiểu roomOccupancy là occupancy của MỘT phòng.
      roomOccupancy: { numberOfAdult: 2, otherOccupancies: [
        { otherOccupancyRefID: "child", otherOccupancyRefCode: "child", quantity: 1 },
        { otherOccupancyRefID: "infant", otherOccupancyRefCode: "infant", quantity: 0 },
      ] },
    });
  });

  test("does not leak upstream metadata into the response", async () => {
    const { service: bedbank } = routed();

    const serialized = JSON.stringify(await bedbank.hotels(search));

    expect(serialized).not.toContain("rateAvailablity");
    expect(serialized).not.toContain("roomTypeCode");
  });
});

describe("CloudHMS room availability", () => {
  test("maps the rate envelope and names rooms from property metadata", async () => {
    const metadata = clone(roomTypes);
    metadata.data.items[0]!.id = PAID_ROOM_TYPE;
    metadata.data.items[0]!.name = "Zip Standard Garden View";
    metadata.data.items[0]!.maxOccupancy = 4;
    const { service: bedbank } = routed({ roomType: metadata });

    const result = await bedbank.rooms({ ...search, propertyId: VINOASIS });

    // Rate 0 đồng bị loại; rate còn lại lấy tên hạng phòng từ property service.
    expect(result).toEqual([{
      propertyId: VINOASIS,
      roomTypeId: PAID_ROOM_TYPE,
      roomTypeName: "Zip Standard Garden View",
      ratePlanId: PAID_RATE_PLAN,
      ratePlanName: "RATE15PC",
      quantity: 146,
      total: 1_000_000,
      average: 500_000,
      tax: 0,
      currency: "VND",
      maxOccupancy: 4,
    }]);
  });

  test("falls back to the upstream rate code when metadata has no match", async () => {
    const { service: bedbank } = routed();

    const [room] = await bedbank.rooms({ ...search, propertyId: VINOASIS });

    expect(room!.roomTypeName).toBe("Hạng phòng");
  });
});

describe("CloudHMS rate detail", () => {
  test("returns the rate even though upstream reports quantity zero", async () => {
    const { service: bedbank } = routed();

    const result = await bedbank.detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN });

    expect(result.quantity).toBe(0);
    expect(result.total).toBe(1_800_000);
    expect(result.average).toBe(1_800_000);
    expect(result.dailyRates).toEqual([
      { date: "2026-06-01", amount: 900_000 },
      { date: "2026-06-02", amount: 900_000 },
    ]);
  });

  test("leaves tax undefined when upstream provides none", async () => {
    const { service: bedbank } = routed();

    const result = await bedbank.detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN });

    // Không được quy ước thành 0: nhân viên sẽ đọc nhầm là "miễn thuế".
    expect(result.tax).toBeUndefined();
    expect(result.dailyRates[0]).not.toHaveProperty("tax");
  });

  test("names the room type from property metadata", async () => {
    const metadata = clone(roomTypes);
    metadata.data.items[0]!.id = DETAIL_ROOM_TYPE;
    metadata.data.items[0]!.name = "Deluxe Ocean";
    metadata.data.items[0]!.maxOccupancy = 3;
    const { service: bedbank } = routed({ roomType: metadata });

    const result = await bedbank.detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN });

    expect(result.roomTypeName).toBe("Deluxe Ocean");
    expect(result.maxOccupancy).toBe(3);
  });

  test("still returns a rate when the metadata lookup fails", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes("room-type")) throw new Error("property service down");
      return clone(roomDetailAvailability);
    });

    const result = await service(request).detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN });

    expect(result.roomTypeName).toBe("Hạng phòng");
    expect(result.ratePlanName).toBe("PHMS-T18");
  });

  test("turns internal policy codes into readable Vietnamese", async () => {
    const { service: bedbank } = routed();

    const result = await bedbank.detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN });

    expect(JSON.stringify(result.policies)).not.toContain("DEFAULT_CANCEL_POLICY_ORG");
    expect(result.policies).toContainEqual({ type: "Hủy phòng", description: "Không hoàn hủy — phí hủy 100% giá trị đặt phòng nếu hủy sau khi xác nhận." });
    expect(result.policies).toContainEqual({ type: "Đảm bảo", description: "Không yêu cầu đặt cọc." });
  });

  test("keeps a human-written policy description untouched", async () => {
    const payload = clone(roomDetailAvailability);
    payload.data.roomAvailabilityRates[0]!.ratePlan.cancelPolicy.description = "Miễn phí hủy trước 3 ngày nhận phòng.";
    const { service: bedbank } = routed({ detail: payload });

    const result = await bedbank.detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN });

    expect(result.policies).toContainEqual({ type: "Hủy phòng", description: "Miễn phí hủy trước 3 ngày nhận phòng." });
  });

  test("picks the entry matching the requested room type and rate plan", async () => {
    const payload = clone(roomDetailAvailability);
    const other = clone(payload.data.roomAvailabilityRates[0]!);
    other.roomTypeId = "other-room-type";
    other.ratePlanId = "other-rate-plan";
    other.totalAmount = { amount: { amount: 9_900_000 } };
    payload.data.roomAvailabilityRates.unshift(other);
    const { service: bedbank } = routed({ detail: payload });

    const result = await bedbank.detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN });

    expect(result.total).toBe(1_800_000);
  });

  test("reports no availability only when upstream returns no rate", async () => {
    const { service: bedbank } = routed({ detail: { data: { roomAvailabilityRates: [] } } });

    await expect(bedbank.detail({ ...search, propertyId: VINOASIS, roomTypeId: DETAIL_ROOM_TYPE, ratePlanId: DETAIL_RATE_PLAN }))
      .rejects.toThrow("Hạng phòng này không còn khả dụng");
  });
});

describe("CloudHMS readiness", () => {
  test("rejects an empty active property catalog", async () => {
    const request = vi.fn(async () => ({ data: { total: 0, limit: 30, page: 0, items: [] } }));

    await expect(service(request).health()).rejects.toThrow("CloudHMS không có property active");
  });
});
