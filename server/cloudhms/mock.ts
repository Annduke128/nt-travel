import type { BedbankService } from "../services.js";
import type { PropertyDto, RoomAvailabilityDto, SearchRequest } from "../contracts.js";
import type { RateDetailRequest } from "../../shared/contracts.js";
import { AppError } from "../errors.js";
import { createPropertyMatcher, noAvailability, propertyNotFound } from "./search.js";

const properties: PropertyDto[] = [
  { id: "mock-nha-trang", name: "Vinpearl Beachfront Nha Trang", city: "Nha Trang", propertyType: "Khách sạn", starRating: 5, services: ["Hồ bơi", "Spa", "Đưa đón sân bay"], imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=82" },
  { id: "mock-phu-quoc", name: "Vinpearl Resort & Spa Phú Quốc", city: "Phú Quốc", propertyType: "Resort", starRating: 5, services: ["Hồ bơi", "Spa"], imageUrl: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=82" },
  // Hai tên dưới sao chép đúng hai lỗi dữ liệu của catalog CiHMS thật: "Vinpear" thiếu chữ "l",
  // và liên từ viết "và" thay cho "&". Giữ chúng trong mock để deployment chạy mock vẫn test
  // được hành vi so khớp thật, và để hai property không ảnh thử được nhánh thiếu hình.
  { id: "mock-discovery", name: "Vinpear Discovery 1 Phú Quốc", city: "Phú Quốc" },
  { id: "mock-da-nang", name: "Vinpearl Resort và Spa Đà Nẵng", city: "Đà Nẵng" },
];

// Property hết phòng: không có nó thì trạng thái NO_AVAILABILITY không thể xuất hiện ở
// mock-mode, mà đó lại là một trong hai màn hình "không có kết quả" cần UAT.
const SOLD_OUT = "mock-discovery";

const match = createPropertyMatcher(properties);

function nights(search: SearchRequest) {
  return Math.round((Date.parse(search.departureDate) - Date.parse(search.arrivalDate)) / 86_400_000);
}

export class MockBedbankService implements BedbankService {
  async health() {}
  // Dùng chung matcher với live: bỏ dấu, khớp mờ từng token, `&` ↔ `và`.
  async properties(query: string) {
    return match(query).slice(0, 20);
  }
  async hotels(search: SearchRequest) {
    const destination = search.destination.trim();
    const matches = match(destination);
    // Giữ đúng hai mã lỗi của live để màn hình dev/mock phản ánh được trạng thái thật.
    if (matches.length === 0) throw propertyNotFound(destination);
    const available = matches.filter(({ id }) => id !== SOLD_OUT);
    if (available.length === 0) throw noAvailability(destination, search, matches);
    return Promise.all(available.map(async (property, index) => {
      const programs = await this.rooms({ ...search, propertyId: property.id });
      return { ...property, quantity: 4 + index, fromPrice: Math.min(...programs.map((rate) => rate.total)), currency: "VND",
        programs: programs.map(({ total, currency, cancellationPolicy }) => ({ total, currency, cancellationPolicy })) };
    }));
  }
  async rooms(search: SearchRequest & { propertyId: string }): Promise<RoomAvailabilityDto[]> {
    if (search.propertyId === SOLD_OUT) return [];
    if (!properties.some(({ id }) => id === search.propertyId)) return [];
    const count = nights(search);
    const services = properties.find(({ id }) => id === search.propertyId)?.services;
    const rates: RoomAvailabilityDto[] = [
      { propertyId: search.propertyId, roomTypeId: "deluxe-ocean", roomTypeName: "Deluxe Ocean", ratePlanId: "breakfast-flex", ratePlanName: "Linh hoạt · Bao gồm bữa sáng", quantity: 4, total: 2_450_000 * count, average: 2_450_000, tax: 245_000 * count, currency: "VND", maxOccupancy: 3, cancellationPolicy: "refundable", services },
      // Rate plan này cố tình không có thuế: CloudHMS thật không trả thuế ở mọi endpoint,
      // giữ trạng thái đó trong mock để lỗi hiển thị lộ ra ngay khi phát triển.
      { propertyId: search.propertyId, roomTypeId: "deluxe-ocean", roomTypeName: "Deluxe Ocean", ratePlanId: "room-only", ratePlanName: "Không hoàn hủy · Chỉ phòng", quantity: 2, total: 2_150_000 * count, average: 2_150_000, currency: "VND", maxOccupancy: 3, cancellationPolicy: "non-refundable", services },
    ];
    const allotments = [
      { id: "agent", name: "ALLOTMENT_NTTRAVEL_BEST RATES - AGENT", factor: 1 },
      { id: "summer", name: "ALLOTMENT_NTTRAVEL_SUMMER PROMOTION", factor: 0.9 },
      { id: "hb", name: "ALLOTMENT_NTTRAVEL_HB_NTTRAVEL_24", factor: 1.2 },
      { id: "early-bird", name: "ALLOTMENT_NTTRAVEL_EARLY_BIRD", factor: 0.85 },
      { id: "corporate", name: "ALLOTMENT_NTTRAVEL_CORPORATE", factor: 0.95 },
    ];
    const suite = rates.map((rate) => ({ ...rate, roomTypeId: "suite-ocean", roomTypeCode: "GSOV", roomTypeName: "Grand Suite Ocean View", maxOccupancy: 4,
      total: rate.total + 1_500_000 * count, average: rate.average + 1_500_000, quantity: 2 }));
    return [...rates, ...suite].flatMap((rate) => allotments.map((allotment) => ({ ...rate,
      roomTypeCode: rate.roomTypeId === "deluxe-ocean" ? "DLXO" : "GSOV", allotmentId: `${rate.roomTypeId}-${allotment.id}`, allotmentName: allotment.name,
      total: Math.round(rate.total * allotment.factor), average: Math.round(rate.average * allotment.factor),
      ...(rate.tax === undefined ? {} : { tax: Math.round(rate.tax * allotment.factor) }),
    })));
  }
  async detail(search: RateDetailRequest) {
    const room = (await this.rooms(search)).find((item) => item.roomTypeId === search.roomTypeId && item.ratePlanId === search.ratePlanId && (!search.allotmentId || item.allotmentId === search.allotmentId));
    if (!room) throw new AppError(404, "NO_AVAILABILITY", "Hạng phòng này không còn khả dụng");
    const dailyRates = Array.from({ length: nights(search) }, (_, index) => {
      const date = new Date(`${search.arrivalDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
      return { date: date.toISOString().slice(0, 10), amount: room.average, ...(room.tax === undefined ? {} : { tax: room.tax / nights(search) }) };
    });
    return { ...room, dailyRates, policies: [
      { type: "Hủy phòng", description: search.ratePlanId === "room-only" ? "Không hoàn hủy." : "Miễn phí hủy trước 3 ngày nhận phòng." },
      { type: "Thanh toán", description: "Giá net, chưa phát sinh booking hoặc thanh toán tại bước này." },
    ] };
  }
}
