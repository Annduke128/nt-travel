import { CloudHmsBedbankService } from "./bedbank.js";
import { CloudHmsClient } from "./client.js";
import { loadConfig } from "../config.js";

const config = loadConfig();
if (config.cloudHms.mode !== "live") throw new Error("Smoke test chỉ chạy khi CLOUDHMS_MODE=live");
const destination = process.env.SMOKE_DESTINATION;
const arrivalDate = process.env.SMOKE_ARRIVAL_DATE;
const departureDate = process.env.SMOKE_DEPARTURE_DATE;
if (!destination || !arrivalDate || !departureDate) throw new Error("Thiếu SMOKE_DESTINATION, SMOKE_ARRIVAL_DATE hoặc SMOKE_DEPARTURE_DATE");

const service = new CloudHmsBedbankService(new CloudHmsClient(config.cloudHms), config.cloudHms.distributionChannelId, config.cloudHms.organizationCode, 1);
const search = { destination, arrivalDate, departureDate, rooms: [{ adults: 2, children: 0, infants: 0 }] };
const hotels = await service.hotels(search);
if (hotels.length === 0) throw new Error("Smoke test không tìm thấy availability");
const rooms = await service.rooms({ ...search, propertyId: hotels[0]!.id });
if (rooms.length === 0) throw new Error("Smoke test không tìm thấy room/rate availability");
const detail = await service.detail({ ...search, propertyId: hotels[0]!.id, roomTypeId: rooms[0]!.roomTypeId, ratePlanId: rooms[0]!.ratePlanId });
console.info(JSON.stringify({ smoke: "ok", hotelCount: hotels.length, roomRateCount: rooms.length, currency: detail.currency, quantity: detail.quantity, dailyRateCount: detail.dailyRates.length }));
