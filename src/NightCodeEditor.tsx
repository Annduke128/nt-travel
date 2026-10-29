import { useEffect, useId, useState } from "react";
import { rateKey, type RoomAvailabilityDto, type RoomOccupancy, type SearchRequest } from "../shared/contracts";
import { nextDate } from "../shared/roomStays";
import { bedbankApi } from "./api";

type Props = { roomIndex: number; date: string; search: SearchRequest; propertyId: string; occupancy: RoomOccupancy; current: RoomAvailabilityDto; disabled: boolean; onApply: (date: string, rate: RoomAvailabilityDto) => Promise<boolean> };
const money = (value: number, currency: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export function NightCodeEditor({ roomIndex, date, search, propertyId, occupancy, current, disabled, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<RoomAvailabilityDto[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError("");
    bedbankApi.rooms({ ...search, arrivalDate: date, departureDate: nextDate(date), propertyId, rooms: [{ adults: occupancy.adults, children: occupancy.children, infants: occupancy.infants }] }).then((available) => {
      if (!active) return;
      const count = occupancy.adults + occupancy.children + occupancy.infants;
      const eligible = available.filter((rate) => rate.quantity > 0 && rate.currency === current.currency && (!rate.maxOccupancy || rate.maxOccupancy >= count));
      setRates(eligible); setSelectedKey(eligible.some((rate) => rateKey(rate) === rateKey(current)) ? rateKey(current) : eligible[0] ? rateKey(eligible[0]) : "");
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Không tải được mã phòng cho đêm này."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, date, propertyId, search, occupancy.adults, occupancy.children, occupancy.infants, current.roomTypeId, current.ratePlanId, current.allotmentId, current.currency]);
  const selected = rates.find((rate) => rateKey(rate) === selectedKey);
  const types = [...new Map(rates.map((rate) => [rate.roomTypeId, rate])).values()];
  return <div className="night-code-editor">
    <button className="quiet-button" type="button" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => setOpen((value) => !value)}>Đổi mã phòng / dịch vụ</button>
    {open ? <div id={id} className="night-code-options">{loading ? <p role="status">Đang tải mã còn trống cho đêm này…</p> : error ? <p role="alert">{error}</p> : rates.length === 0 ? <p>Không có mã phù hợp số khách cho đêm này.</p> : <>
      <label>Mã phòng / dịch vụ<select aria-label={`Mã phòng / dịch vụ · Phòng ${roomIndex + 1} · ${date}`} disabled={disabled} value={selected?.roomTypeId ?? ""} onChange={(event) => { const rate = rates.find((item) => item.roomTypeId === event.target.value); if (rate) setSelectedKey(rateKey(rate)); }}>{types.map((rate) => <option key={rate.roomTypeId} value={rate.roomTypeId}>{rate.roomTypeCode ? `${rate.roomTypeCode} · ` : ""}{rate.roomTypeName}</option>)}</select></label>
      <label>Chương trình / Allotment<select aria-label={`Chương trình / Allotment · Phòng ${roomIndex + 1} · ${date}`} disabled={disabled} value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>{rates.filter((rate) => rate.roomTypeId === selected?.roomTypeId).map((rate) => <option key={rateKey(rate)} value={rateKey(rate)}>{rate.ratePlanName} · {rate.allotmentName ?? rate.allotmentId ?? ""} · {money(rate.total, rate.currency)}</option>)}</select></label>
      {selected ? <p className="booking-help">{selected.quantity} phòng còn trống{selected.maxOccupancy ? ` · Tối đa ${selected.maxOccupancy} khách` : ""}</p> : null}
      <button className="select-room" type="button" disabled={disabled || !selected} onClick={() => { if (selected) void onApply(date, selected).then((applied) => { if (applied) setOpen(false); }); }}>Áp dụng cho đêm này</button>
    </>}</div> : null}
  </div>;
}
