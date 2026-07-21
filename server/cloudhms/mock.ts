import type { BedbankService } from "../services.js";
import type { PropertyDto, SearchRequest } from "../contracts.js";
import { AppError } from "../errors.js";

const properties: PropertyDto[] = [
  { id: "mock-nha-trang", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=82" },
  { id: "mock-phu-quoc", name: "Vinpearl Resort & Spa Phú Quốc", city: "Phú Quốc", imageUrl: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=82" },
];

function nights(search: SearchRequest) {
  return Math.round((Date.parse(search.departureDate) - Date.parse(search.arrivalDate)) / 86_400_000);
}

export class MockBedbankService implements BedbankService {
  async properties(query: string) {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return properties.filter((property) => !normalized || `${property.name} ${property.city}`.toLocaleLowerCase("vi").includes(normalized));
  }
  async hotels(search: SearchRequest) {
    return (await this.properties(search.destination)).map((property, index) => ({ ...property, quantity: 4 + index, fromPrice: (2_450_000 + index * 900_000) * nights(search), currency: "VND" }));
  }
  async rooms(search: SearchRequest & { propertyId: string }) {
    if (!properties.some(({ id }) => id === search.propertyId)) return [];
    const count = nights(search);
    return [
      { propertyId: search.propertyId, roomTypeId: "deluxe-ocean", roomTypeName: "Deluxe Ocean", ratePlanId: "breakfast-flex", ratePlanName: "Linh hoạt · Bao gồm bữa sáng", quantity: 4, total: 2_450_000 * count, average: 2_450_000, tax: 245_000 * count, currency: "VND", maxOccupancy: 3 },
      { propertyId: search.propertyId, roomTypeId: "deluxe-ocean", roomTypeName: "Deluxe Ocean", ratePlanId: "room-only", ratePlanName: "Không hoàn hủy · Chỉ phòng", quantity: 2, total: 2_150_000 * count, average: 2_150_000, tax: 215_000 * count, currency: "VND", maxOccupancy: 3 },
    ];
  }
  async detail(search: SearchRequest & { propertyId: string; roomTypeId: string; ratePlanId: string }) {
    const room = (await this.rooms(search)).find((item) => item.roomTypeId === search.roomTypeId && item.ratePlanId === search.ratePlanId);
    if (!room) throw new AppError(404, "NO_AVAILABILITY", "Hạng phòng này không còn khả dụng");
    const dailyRates = Array.from({ length: nights(search) }, (_, index) => {
      const date = new Date(`${search.arrivalDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
      return { date: date.toISOString().slice(0, 10), amount: room.average, tax: room.tax / nights(search) };
    });
    return { ...room, dailyRates, policies: [
      { type: "Hủy phòng", description: search.ratePlanId === "room-only" ? "Không hoàn hủy." : "Miễn phí hủy trước 3 ngày nhận phòng." },
      { type: "Thanh toán", description: "Giá net, chưa phát sinh booking hoặc thanh toán tại bước này." },
    ] };
  }
}
