import type { HotelAvailabilityDto, PropertyDto, RateDetailDto, RoomAvailabilityDto, SearchRequest } from "../contracts.js";
import { AppError } from "../errors.js";
import type { BedbankService } from "../services.js";
import type { CloudHmsClient } from "./client.js";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;

// CloudHMS trả GUID toàn số 0 ở cấp một của `get-room-availability`, còn ID dùng được nằm lồng
// trong `roomType` / `ratePlan`. Gửi GUID số 0 sang `get-room-detail-availability` nhận về
// HTTP 400 RATE_PLAN_NOT_FOUND, nên phải bỏ qua nó thay vì coi là một chuỗi hợp lệ.
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
function identifier(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = string(candidate);
    if (value && value !== ZERO_GUID) return value;
  }
  return "";
}

// `/pms-property/room-type` đặt tên trường là `name` / `code`; rate lồng trong availability lại
// dùng `roomTypeName` / `roomTypeCode`. Hai shape không thay thế được cho nhau.
const roomTypeLabel = (roomType: RecordValue): string =>
  string(roomType.name, string(roomType.roomTypeName, string(roomType.code, string(roomType.roomTypeCode, "Hạng phòng"))));

// Nhân viên gõ "Tây Ninh" nhưng catalog lưu "Hotel Tay Ninh 11" (và ngược lại với "Phú Quốc"),
// nên so khớp điểm đến phải bỏ dấu ở cả hai phía.
const normalize = (value: string): string =>
  value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

const CATALOG_PAGE_LIMIT = 200;
const CATALOG_MAX_PAGES = 50;

function nestedAmount(value: unknown): number {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "number") return current;
    current = object(current).amount;
  }
  return 0;
}

// Khác nestedAmount: trả undefined khi upstream không cung cấp field, thay vì quy ước
// thành 0 — "chưa có dữ liệu thuế" không phải là "thuế bằng 0".
function optionalAmount(value: unknown): number | undefined {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "number") return Number.isFinite(current) ? current : undefined;
    if (!current || typeof current !== "object") return undefined;
    current = (current as RecordValue).amount;
  }
  return undefined;
}

// CloudHMS thường trả mã nội bộ (DEFAULT_CANCEL_POLICY_ORG) ở trường description; khi đó
// phải dựng câu mô tả từ dữ liệu có cấu trúc, nếu không nhân viên đọc được chuỗi vô nghĩa.
const CODE_LIKE = /^[A-Z][A-Z0-9_]*$/;
const vnNumber = new Intl.NumberFormat("vi-VN");

function cancelDescription(policy: RecordValue): string {
  const description = string(policy.description);
  if (description && !CODE_LIKE.test(description)) return description;
  const refundable = policy.isRefundable === true ? "Được hoàn hủy" : "Không hoàn hủy";
  const first = object(array(policy.detail)[0]);
  if (Object.keys(first).length === 0) return `${refundable} theo chính sách của khách sạn.`;
  const amount = number(first.amount);
  const fee = string(first.type) === "Percent" ? `${amount}% giá trị đặt phòng` : `${vnNumber.format(amount)} phí cố định`;
  const days = number(first.daysBeforeArrival);
  const when = days > 0 ? `trong vòng ${days} ngày trước ngày nhận phòng` : "sau khi xác nhận";
  return `${refundable} — phí hủy ${fee} nếu hủy ${when}.`;
}

function guaranteeDescription(policy: RecordValue): string {
  const description = string(policy.description);
  if (description && !CODE_LIKE.test(description)) return description;
  const first = object(array(policy.detail)[0]);
  const type = string(first.type);
  if (!type) return "";
  if (type !== "Deposit") return `Đảm bảo bằng ${type}.`;
  const deposit = number(first.depositAmount);
  if (deposit <= 0) return "Không yêu cầu đặt cọc.";
  return `Đặt cọc ${string(first.depositType) === "Percent" ? `${deposit}%` : vnNumber.format(deposit)} khi xác nhận.`;
}

function currencyOf(value: unknown, fallback = "VND") {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const record = object(current);
    if (typeof record.currencyCode === "string") return record.currencyCode;
    current = record.amount;
  }
  return fallback;
}

// CloudHMS nhận occupancy của MỘT phòng đi kèm numberOfRoom (xem các mẫu booking trong
// collection: nhiều phòng = nhiều reservation, mỗi cái numberOfRoom=1). Không cộng dồn.
// searchRequestSchema đã bảo đảm mọi phòng có cùng số khách.
function occupancyBody(search: SearchRequest) {
  const room = search.rooms[0]!;
  return {
    numberOfAdult: room.adults,
    otherOccupancies: [
      { otherOccupancyRefID: "child", otherOccupancyRefCode: "child", quantity: room.children },
      { otherOccupancyRefID: "infant", otherOccupancyRefCode: "infant", quantity: room.infants },
    ],
  };
}

export class CloudHmsBedbankService implements BedbankService {
  private catalog?: { expiresAt: number; properties: PropertyDto[] };

  constructor(
    private readonly client: CloudHmsClient,
    private readonly distributionChannelId: string,
    private readonly organizationCode: string,
    private readonly concurrency = 4,
  ) {}

  private async activeProperties(): Promise<PropertyDto[]> {
    if (this.catalog && this.catalog.expiresAt > Date.now()) return this.catalog.properties;
    const items: unknown[] = [];
    for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
      const payload = await this.client.request<unknown>(`/common-trd/v1/pms-property/hotels/info?page=${page}&limit=${CATALOG_PAGE_LIMIT}`, { method: "GET" });
      const data = object(object(payload).data);
      const pageItems = array(data.items);
      items.push(...pageItems);
      const total = number(data.total);
      // CloudHMS tự giới hạn page size (mẫu: xin 50, trả limit 30). So sánh với limit của
      // response, không với limit đã xin, nếu không catalog bị cắt cụt ngay sau trang đầu.
      const pageSize = number(data.limit) || CATALOG_PAGE_LIMIT;
      if (pageItems.length === 0) break;
      if (total > 0 && items.length >= total) break;
      if (pageItems.length < pageSize) break;
      if (page === CATALOG_MAX_PAGES - 1) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "Danh mục CloudHMS vượt giới hạn an toàn");
    }
    const properties = items.flatMap((value): PropertyDto[] => {
      const item = object(value);
      if (!(item.status === true || item.status === 1)) return [];
      const id = string(item.id);
      const name = string(item.name);
      if (!id || !name) return [];
      const firstThumbnail = object(array(item.thumbnails)[0]);
      const imageUrl = string(firstThumbnail.url);
      return [{ id, name, city: string(item.city), ...(imageUrl ? { imageUrl } : {}) }];
    });
    this.catalog = { expiresAt: Date.now() + 15 * 60_000, properties };
    return properties;
  }

  private async roomTypeMetadata(propertyId: string): Promise<Map<string, RecordValue>> {
    const payload = await this.client.request<unknown>(`/common-trd/v1/pms-property/room-type?hotelId=${encodeURIComponent(propertyId)}&isPseudo=false`, { method: "GET" });
    const items = array(object(object(payload).data).items ?? object(payload).data);
    return new Map(items.map((item) => [string(object(item).id), object(item)]));
  }

  async health() {
    const properties = await this.activeProperties();
    if (properties.length === 0) throw new AppError(503, "UPSTREAM_UNAVAILABLE", "CloudHMS không có property active");
  }

  async properties(query: string): Promise<PropertyDto[]> {
    const properties = await this.activeProperties();
    const normalized = normalize(query.trim());
    if (!normalized) return properties.slice(0, 20);
    return properties.filter((property) => normalize(`${property.name} ${property.city}`).includes(normalized)).slice(0, 20);
  }

  async hotels(search: SearchRequest): Promise<HotelAvailabilityDto[]> {
    const normalized = normalize(search.destination.trim());
    const matches = (await this.activeProperties()).filter((property) => normalize(`${property.name} ${property.city}`).includes(normalized));
    if (matches.length === 0) return [];
    const batches: PropertyDto[][] = [];
    for (let index = 0; index < matches.length; index += 25) batches.push(matches.slice(index, index + 25));
    const payloads: unknown[] = Array.from({ length: batches.length });
    let nextBatch = 0;
    const worker = async () => {
      for (;;) {
        const index = nextBatch;
        nextBatch += 1;
        const batch = batches[index];
        if (!batch) return;
        payloads[index] = await this.client.request<unknown>("/common-trd/v1/crs/booking/get-hotel-availability", {
          body: {
            arrivalDate: search.arrivalDate,
            departureDate: search.departureDate,
            numberOfRoom: search.rooms.length,
            propertyIds: batch.map(({ id }) => id),
            distributionChannelId: this.distributionChannelId,
            roomOccupancy: occupancyBody(search),
            organization: this.organizationCode,
          },
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, batches.length) }, worker));
    const rates = payloads.flatMap((payload) => array(object(object(payload).data).rates));
    return rates.flatMap((value): HotelAvailabilityDto[] => {
      const entry = object(value);
      const property = object(entry.property);
      // Rate có totalAmount = 0 là rate chưa nạp giá cho distribution channel (mẫu thật có 15/360
      // như vậy). Không loại thì "giá từ" luôn về 0 ₫ và quantity lấy nhầm của rate không bán được.
      const availableRates = array(entry.rates).map(object)
        .filter((rate) => number(rate.quantity) > 0 && nestedAmount(rate.totalAmount) > 0);
      if (availableRates.length === 0) return [];
      let best = availableRates[0]!;
      for (const rate of availableRates.slice(1)) if (nestedAmount(rate.totalAmount) < nestedAmount(best.totalAmount)) best = rate;
      const id = string(property.id);
      const catalog = matches.find((item) => item.id === id);
      if (!id || !catalog) return [];
      return [{
        ...catalog,
        name: string(property.name, catalog.name),
        city: string(property.city, catalog.city),
        quantity: number(best.quantity),
        fromPrice: nestedAmount(best.totalAmount),
        currency: currencyOf(best.totalAmount, string(property.currencySymbol, "VND")),
      }];
    });
  }

  async rooms(search: SearchRequest & { propertyId: string }): Promise<RoomAvailabilityDto[]> {
    const [availability, metadata] = await Promise.all([
      this.client.request<unknown>("/common-trd/v1/crs/booking/get-room-availability", { body: {
        arrivalDate: search.arrivalDate, departureDate: search.departureDate, numberOfRoom: search.rooms.length,
        propertyID: search.propertyId, distributionChannelId: this.distributionChannelId,
        roomOccupancy: occupancyBody(search), organization: this.organizationCode,
      } }),
      this.roomTypeMetadata(search.propertyId),
    ]);
    const data = object(object(availability).data);
    const property = object(data.propertyInfo);
    return array(data.roomAvailabilityRates).flatMap((value): RoomAvailabilityDto[] => {
      const rate = object(value);
      if (number(rate.quantity) <= 0) return [];
      const total = nestedAmount(rate.totalAmount);
      if (total <= 0) return [];
      const ratePlan = object(rate.ratePlan ?? object(rate.rateAvailablity).ratePlan);
      const upstreamRoomType = object(rate.roomType);
      const roomTypeId = identifier(rate.roomTypeId, rate.roomTypeID, upstreamRoomType.roomTypeID, object(rate.rateAvailablity).roomTypeId);
      const ratePlanId = identifier(rate.ratePlanId, rate.ratePlanID, ratePlan.ratePlanId, ratePlan.id);
      if (!roomTypeId || !ratePlanId) return [];
      const roomType = metadata.get(roomTypeId) ?? upstreamRoomType;
      const imageUrl = string(object(array(roomType.thumbnails)[0]).url);
      const tax = optionalAmount(rate.totalTaxAmount);
      return [{
        propertyId: search.propertyId,
        roomTypeId,
        roomTypeName: roomTypeLabel(roomType),
        ratePlanId,
        ratePlanName: string(ratePlan.name, string(ratePlan.rateCode, "Giá tiêu chuẩn")),
        quantity: number(rate.quantity), total,
        average: nestedAmount(rate.averageAmount),
        ...(tax === undefined ? {} : { tax }),
        currency: currencyOf(rate.totalAmount, string(property.currencySymbol, "VND")),
        ...(imageUrl ? { imageUrl } : {}),
        ...(number(roomType.maxOccupancy) > 0 ? { maxOccupancy: number(roomType.maxOccupancy) } : {}),
      }];
    });
  }

  async detail(search: SearchRequest & { propertyId: string; roomTypeId: string; ratePlanId: string }): Promise<RateDetailDto> {
    const [payload, metadata] = await Promise.all([
      this.client.request<unknown>("/common-trd/v1/crs/booking/get-room-detail-availability", { body: {
        arrivalDate: search.arrivalDate, departureDate: search.departureDate, numberOfRoom: search.rooms.length,
        propertyID: search.propertyId, distributionChannelId: this.distributionChannelId,
        roomOccupancy: occupancyBody(search), organization: this.organizationCode,
        isFilteredByRoomTypeId: true, isFilteredByRatePlanId: true,
        roomTypeId: search.roomTypeId, ratePlanId: search.ratePlanId,
      } }),
      // Endpoint chi tiết chỉ trả roomTypeID, không có tên hạng phòng; tên nằm ở property
      // service. Thiếu metadata không được làm hỏng cả màn hình chi tiết giá.
      this.roomTypeMetadata(search.propertyId).catch(() => new Map<string, RecordValue>()),
    ]);
    const data = object(object(payload).data);
    const entries = array(data.roomAvailabilityRates).map(object);
    const item = entries.find((entry) =>
      identifier(entry.roomTypeId, entry.roomTypeID, object(entry.roomType).roomTypeID) === search.roomTypeId
      && identifier(entry.ratePlanId, entry.ratePlanID, object(entry.ratePlan).ratePlanId, object(entry.ratePlan).id) === search.ratePlanId,
    );
    // Upstream trả quantity = 0 kể cả khi rate vẫn bán được, nên hết phòng chỉ có thể
    // suy ra từ việc không còn bản ghi nào.
    if (!item) throw new AppError(404, "NO_AVAILABILITY", "Hạng phòng này không còn khả dụng");
    const ratePlan = object(item.ratePlan);
    const upstreamRoomType = object(item.roomType);
    const roomType = metadata.get(search.roomTypeId) ?? upstreamRoomType;
    const maxOccupancy = number(roomType.maxOccupancy) || number(upstreamRoomType.maxOccupancy);
    const dailyRates = array(item.rates).map((value) => {
      const rate = object(value);
      const dailyTax = optionalAmount(rate.taxAmount);
      return { date: string(rate.stayDate).slice(0, 10), amount: nestedAmount(rate.amount), ...(dailyTax === undefined ? {} : { tax: dailyTax }) };
    });
    const dailyTaxTotal = dailyRates.length > 0 && dailyRates.every((rate) => rate.tax !== undefined)
      ? dailyRates.reduce((sum, rate) => sum + rate.tax!, 0)
      : undefined;
    const tax = optionalAmount(item.totalTaxAmount) ?? dailyTaxTotal;
    const policies = [
      ["Hủy phòng", cancelDescription(object(ratePlan.cancelPolicy))],
      ["Đảm bảo", guaranteeDescription(object(ratePlan.guaranteePolicy))],
    ].filter((entry) => entry[1]).map(([type, description]) => ({ type: type!, description: description! }));
    return {
      propertyId: search.propertyId,
      roomTypeId: search.roomTypeId,
      roomTypeName: roomTypeLabel(roomType),
      ratePlanId: search.ratePlanId,
      ratePlanName: string(ratePlan.name, string(ratePlan.rateCode, "Giá tiêu chuẩn")),
      quantity: number(item.quantity),
      total: nestedAmount(item.totalAmount),
      average: nestedAmount(item.averageAmount),
      ...(tax === undefined ? {} : { tax }),
      currency: currencyOf(item.totalAmount, string(object(data.propertyInfo).currencySymbol, "VND")),
      ...(maxOccupancy > 0 ? { maxOccupancy } : {}),
      dailyRates,
      policies,
    };
  }
}
