import "../env.js";
import { CloudHmsBedbankService } from "./bedbank.js";
import { CloudHmsClient } from "./client.js";
import { loadConfig } from "../config.js";

const config = loadConfig();
if (config.cloudHms.mode !== "live") throw new Error("Smoke test chỉ chạy khi CLOUDHMS_MODE=live");
const destination = process.env.SMOKE_DESTINATION;
const arrivalDate = process.env.SMOKE_ARRIVAL_DATE;
const departureDate = process.env.SMOKE_DEPARTURE_DATE;
if (!destination || !arrivalDate || !departureDate) throw new Error("Thiếu SMOKE_DESTINATION, SMOKE_ARRIVAL_DATE hoặc SMOKE_DEPARTURE_DATE");

const client = new CloudHmsClient(config.cloudHms);
const service = new CloudHmsBedbankService(client, config.cloudHms.distributionChannelId, config.cloudHms.organizationCode, 1);
const search = { destination, arrivalDate, departureDate, rooms: [{ adults: 2, children: 0, infants: 0 }] };
const hotels = await service.hotels(search);
if (hotels.length === 0) throw new Error("Smoke test không tìm thấy availability");
const rooms = await service.rooms({ ...search, propertyId: hotels[0]!.id });
if (rooms.length === 0) throw new Error("Smoke test không tìm thấy room/rate availability");
const detail = await service.detail({ ...search, propertyId: hotels[0]!.id, roomTypeId: rooms[0]!.roomTypeId, ratePlanId: rooms[0]!.ratePlanId });
console.info(JSON.stringify({
  smoke: "ok",
  hotelCount: hotels.length,
  roomRateCount: rooms.length,
  unpricedHotels: hotels.filter((hotel) => hotel.fromPrice <= 0).length,
  currency: detail.currency,
  quantity: detail.quantity,
  hasRoomTax: rooms[0]!.tax !== undefined,
  hasDetailTax: detail.tax !== undefined,
  dailyRateCount: detail.dailyRates.length,
  policyTypes: detail.policies.map((policy) => policy.type),
}));

// get-room-availability là endpoint duy nhất không có mẫu dữ liệu trong collection. In tên
// key (không in giá trị) để chốt shape thật rồi khoá fixture tương ứng.
if (process.env.SMOKE_DUMP_SHAPE === "1") {
  const raw = await client.request<unknown>("/common-trd/v1/crs/booking/get-room-availability", { body: {
    arrivalDate, departureDate, numberOfRoom: 1,
    propertyID: hotels[0]!.id, distributionChannelId: config.cloudHms.distributionChannelId,
    roomOccupancy: { numberOfAdult: 2, otherOccupancies: [
      { otherOccupancyRefID: "child", otherOccupancyRefCode: "child", quantity: 0 },
      { otherOccupancyRefID: "infant", otherOccupancyRefCode: "infant", quantity: 0 },
    ] },
    organization: config.cloudHms.organizationCode,
  } });
  const data = (raw as { data?: Record<string, unknown> }).data ?? {};
  const first = (data.roomAvailabilityRates as unknown[] | undefined)?.[0];
  console.info(JSON.stringify({
    shape: "get-room-availability",
    dataKeys: Object.keys(data),
    rateKeys: first && typeof first === "object" ? Object.keys(first) : [],
  }));
}
