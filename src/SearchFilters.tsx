import type { HotelAvailabilityDto } from "../shared/contracts";
import { EMPTY_FILTERS, hasFilters, type AvailabilityFilters } from "./availabilityFilters";

export function SearchFilters({ hotels, value, disabled, onChange }: { hotels: HotelAvailabilityDto[]; value: AvailabilityFilters; disabled: boolean; onChange: (filters: AvailabilityFilters) => void }) {
  const unique = (values: (string | undefined)[]) => [...new Set(values.filter((item): item is string => Boolean(item)))].sort((a, b) => a.localeCompare(b, "vi"));
  const types = unique(hotels.map((hotel) => hotel.propertyType));
  const stars = [...new Set(hotels.flatMap((hotel) => hotel.starRating ? [hotel.starRating] : []))].sort((a, b) => b - a);
  const policies = unique(hotels.flatMap((hotel) => hotel.programs?.map((rate) => rate.cancellationPolicy) ?? []));
  const services = unique(hotels.flatMap((hotel) => [...(hotel.services ?? []), ...(hotel.programs?.flatMap((rate) => rate.services ?? []) ?? [])]));
  const update = (key: keyof AvailabilityFilters, next: string) => onChange({ ...value, [key]: next });
  const noData = hotels.length === 0 ? "Tìm phòng để xem lựa chọn" : "Chưa có dữ liệu";
  return <div className="availability-filters" aria-label="Bộ lọc phòng">
    <label>Loại lưu trú<select aria-label="Loại lưu trú" value={value.propertyType} disabled={disabled || types.length === 0} onChange={(event) => update("propertyType", event.target.value)}><option value="">{types.length ? "Tất cả loại lưu trú" : noData}</option>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
    <label>Hạng sao<select aria-label="Hạng sao" value={value.starRating} disabled={disabled || stars.length === 0} onChange={(event) => update("starRating", event.target.value)}><option value="">{stars.length ? "Tất cả hạng sao" : noData}</option>{stars.map((star) => <option key={star} value={star}>{star} sao</option>)}</select></label>
    <label>Tầm giá <small>VND / phòng / kỳ</small><select aria-label="Tầm giá / phòng / kỳ" value={value.price} disabled={disabled || hotels.length === 0} onChange={(event) => update("price", event.target.value)}><option value="">Tất cả mức giá</option><option value="under-2">Dưới 2 triệu</option><option value="2-5">2 – dưới 5 triệu</option><option value="5-10">5 – dưới 10 triệu</option><option value="over-10">Từ 10 triệu</option></select></label>
    <label>Chính sách<select aria-label="Chính sách" value={value.policy} disabled={disabled || policies.length === 0} onChange={(event) => update("policy", event.target.value)}><option value="">{policies.length ? "Tất cả chính sách" : noData}</option>{policies.map((policy) => <option key={policy} value={policy}>{policy === "refundable" ? "Được hoàn hủy" : "Không hoàn hủy"}</option>)}</select></label>
    <label>Dịch vụ / tiện ích<select aria-label="Dịch vụ / tiện ích" value={value.service} disabled={disabled || services.length === 0} onChange={(event) => update("service", event.target.value)}><option value="">{services.length ? "Tất cả dịch vụ" : noData}</option>{services.map((service) => <option key={service}>{service}</option>)}</select></label>
    {hasFilters(value) ? <button className="clear-filters" type="button" disabled={disabled} onClick={() => onChange(EMPTY_FILTERS)}>Bỏ lọc</button> : null}
  </div>;
}
