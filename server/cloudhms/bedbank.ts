import type { HotelAvailabilityDto, PropertyDto, RateDetailDto, RoomAvailabilityDto, SearchRequest } from "../contracts.js";
import { AppError } from "../errors.js";
import type { BedbankService } from "../services.js";
import type { CloudHmsClient } from "./client.js";

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function nestedAmount(value: unknown): number {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "number") return current;
    current = object(current).amount;
  }
  return 0;
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

function occupancyBody(search: SearchRequest) {
  const total = search.rooms.reduce((sum, room) => ({
    adults: sum.adults + room.adults,
    children: sum.children + room.children,
    infants: sum.infants + room.infants,
  }), { adults: 0, children: 0, infants: 0 });
  return {
    numberOfAdult: total.adults,
    otherOccupancies: [
      { otherOccupancyRefID: "child", otherOccupancyRefCode: "child", quantity: total.children },
      { otherOccupancyRefID: "infant", otherOccupancyRefCode: "infant", quantity: total.infants },
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
    const payload = await this.client.request<unknown>("/common-trd/v1/pms-property/hotels/info?page=0&limit=500", { method: "GET" });
    const items = array(object(object(payload).data).items);
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

  async properties(query: string): Promise<PropertyDto[]> {
    const properties = await this.activeProperties();
    const normalized = query.trim().toLocaleLowerCase("vi");
    if (!normalized) return properties.slice(0, 20);
    return properties.filter((property) => `${property.name} ${property.city}`.toLocaleLowerCase("vi").includes(normalized)).slice(0, 20);
  }

  async hotels(search: SearchRequest): Promise<HotelAvailabilityDto[]> {
    const normalized = search.destination.trim().toLocaleLowerCase("vi");
    const matches = (await this.activeProperties()).filter((property) => `${property.name} ${property.city}`.toLocaleLowerCase("vi").includes(normalized));
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
      const availableRates = array(entry.rates).map(object).filter((rate) => number(rate.quantity) > 0);
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
      this.client.request<unknown>(`/common-trd/v1/pms-property/room-type?hotelId=${encodeURIComponent(search.propertyId)}&isPseudo=false`, { method: "GET" }),
    ]);
    const data = object(object(availability).data);
    const property = object(data.propertyInfo);
    const metadataItems = array(object(object(metadata).data).items ?? object(metadata).data);
    const metadataById = new Map(metadataItems.map((item) => [string(object(item).id), object(item)]));
    return array(data.roomAvailabilityRates).flatMap((value): RoomAvailabilityDto[] => {
      const rate = object(value);
      if (number(rate.quantity) <= 0) return [];
      const ratePlan = object(rate.ratePlan ?? object(rate.rateAvailablity).ratePlan);
      const roomTypeId = string(rate.roomTypeId ?? rate.roomTypeID ?? object(rate.rateAvailablity).roomTypeId);
      const roomType = metadataById.get(roomTypeId) ?? object(rate.roomType);
      const ratePlanId = string(rate.ratePlanId ?? rate.ratePlanID ?? ratePlan.id);
      if (!roomTypeId || !ratePlanId) return [];
      const imageUrl = string(object(array(roomType.thumbnails)[0]).url);
      const total = nestedAmount(rate.totalAmount);
      return [{
        propertyId: search.propertyId,
        roomTypeId,
        roomTypeName: string(roomType.name, string(roomType.code, "Hạng phòng")),
        ratePlanId,
        ratePlanName: string(ratePlan.name, string(ratePlan.rateCode, "Giá tiêu chuẩn")),
        quantity: number(rate.quantity), total,
        average: nestedAmount(rate.averageAmount),
        tax: nestedAmount(rate.totalTaxAmount),
        currency: currencyOf(rate.totalAmount, string(property.currencySymbol, "VND")),
        ...(imageUrl ? { imageUrl } : {}),
        ...(number(roomType.maxOccupancy) > 0 ? { maxOccupancy: number(roomType.maxOccupancy) } : {}),
      }];
    });
  }

  async detail(search: SearchRequest & { propertyId: string; roomTypeId: string; ratePlanId: string }): Promise<RateDetailDto> {
    const payload = await this.client.request<unknown>("/common-trd/v1/crs/booking/get-room-detail-availability", { body: {
      arrivalDate: search.arrivalDate, departureDate: search.departureDate, numberOfRoom: search.rooms.length,
      propertyID: search.propertyId, distributionChannelId: this.distributionChannelId,
      roomOccupancy: occupancyBody(search), organization: this.organizationCode,
      isFilteredByRoomTypeId: true, isFilteredByRatePlanId: true,
      roomTypeId: search.roomTypeId, ratePlanId: search.ratePlanId,
    } });
    const item = object(array(object(object(payload).data).roomAvailabilityRates)[0]);
    if (Object.keys(item).length === 0 || number(item.quantity) <= 0) throw new AppError(404, "NO_AVAILABILITY", "Hạng phòng này không còn khả dụng");
    const ratePlan = object(item.ratePlan);
    const roomType = object(item.roomType);
    const policies = [
      ["Hủy phòng", string(object(ratePlan.cancelPolicy).description)],
      ["Đảm bảo", string(object(ratePlan.guaranteePolicy).description)],
    ].filter((entry) => entry[1]).map(([type, description]) => ({ type: type!, description: description! }));
    return {
      propertyId: search.propertyId,
      roomTypeId: search.roomTypeId,
      roomTypeName: string(roomType.name, string(roomType.code, "Hạng phòng")),
      ratePlanId: search.ratePlanId,
      ratePlanName: string(ratePlan.name, string(ratePlan.rateCode, "Giá tiêu chuẩn")),
      quantity: number(item.quantity),
      total: nestedAmount(item.totalAmount),
      average: nestedAmount(item.averageAmount),
      tax: nestedAmount(item.totalTaxAmount),
      currency: currencyOf(item.totalAmount),
      ...(number(roomType.maxOccupancy) > 0 ? { maxOccupancy: number(roomType.maxOccupancy) } : {}),
      dailyRates: array(item.rates).map((value) => {
        const rate = object(value);
        return { date: string(rate.stayDate).slice(0, 10), amount: nestedAmount(rate.amount), tax: nestedAmount(rate.taxAmount) };
      }),
      policies,
    };
  }
}
