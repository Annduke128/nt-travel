import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { BedDouble, Minus, Plus, UsersRound } from "lucide-react";
import type { RateDetailDto, RoomAvailabilityDto, RoomOccupancy, RoomStayQuote, SearchRequest } from "../shared/contracts";
import { stayDates } from "../shared/roomStays";
import { NightCodeEditor } from "./NightCodeEditor";
import { StayDateEditor } from "./StayDateEditor";

type Props = {
  arrivalDate: string; departureDate: string;
  rooms: RateDetailDto[]; occupancies: RoomOccupancy[]; capacities: (number | undefined)[];
  stays: RoomStayQuote[][]; search: SearchRequest;
  onNightChange: (roomIndex: number, date: string, rate: RoomAvailabilityDto) => Promise<boolean>;
  datesDirty: boolean; onDatesEditingChange: (dirty: boolean) => void; onDatesChange: (arrival: string, departure: string) => Promise<string | undefined>;
  disabled: boolean; repricing: boolean; notes: string;
  onOccupancyChange: (roomIndex: number, occupancy: RoomOccupancy) => void;
  onNotesChange: (notes: string) => void; onConfirm: () => void; onBack: () => void;
};
const money = (value: number, currency: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

export function RoomConfiguration({ arrivalDate, departureDate, rooms, occupancies, capacities, stays, search, onNightChange, datesDirty, onDatesEditingChange, onDatesChange, disabled, repricing, notes, onOccupancyChange, onNotesChange, onConfirm, onBack }: Props) {
  const [activeRoom, setActiveRoom] = useState(0);
  const [datesCollapsed, setDatesCollapsed] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabList = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const list = tabList.current;
    const tab = tabs.current[activeRoom];
    if (!list || !tab) return;
    const keepTabVisible = () => {
      const bounds = list.getBoundingClientRect();
      const target = tab.getBoundingClientRect();
      if (target.right > bounds.right) list.scrollLeft += target.right - bounds.right;
      else if (target.left < bounds.left) list.scrollLeft -= bounds.left - target.left;
    };
    keepTabVisible();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(keepTabVisible);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeRoom]);
  const room = rooms[activeRoom]!;
  const occupancy = occupancies[activeRoom]!;
  const count = occupancy.adults + occupancy.children + occupancy.infants;
  const capacity = capacities[activeRoom];
  const limit = Math.min(18, capacity ?? count);
  const dates = stayDates(arrivalDate, departureDate);
  const total = rooms.reduce((sum, rate) => sum + rate.total, 0);
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % rooms.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + rooms.length) % rooms.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rooms.length - 1;
    else return;
    event.preventDefault(); setActiveRoom(next); tabs.current[next]?.focus();
  };
  const categories = [
    { key: "adults", label: "Người lớn", min: 1, max: Math.min(8, limit - occupancy.children - occupancy.infants) },
    { key: "children", label: "Trẻ em", min: 0, max: Math.min(6, limit - occupancy.adults - occupancy.infants) },
    { key: "infants", label: "Em bé", min: 0, max: Math.min(4, limit - occupancy.adults - occupancy.children) },
  ] as const;
  const invalidCapacity = occupancies.some((value, index) => capacities[index] !== undefined && value.adults + value.children + value.infants > capacities[index]!);
  return <section className="room-configuration" aria-label="Cấu hình phòng">
    <div className="configuration-layout" data-dates-collapsed={datesCollapsed}>
    <StayDateEditor arrivalDate={arrivalDate} departureDate={departureDate} disabled={disabled} collapsed={datesCollapsed} onToggle={() => setDatesCollapsed((current) => !current)} onEditingChange={onDatesEditingChange} onApply={onDatesChange} />
    <div className="room-configuration-content">
    <div ref={tabList} className="room-config-tabs" role="tablist" aria-label="Các phòng đã chọn">{rooms.map((rate, index) => <button key={index} ref={(element) => { tabs.current[index] = element; }} type="button" role="tab" id={`${id}-tab-${index}`} aria-label={`Phòng ${index + 1}`} aria-selected={index === activeRoom} aria-controls={`${id}-panel`} tabIndex={index === activeRoom ? 0 : -1} onClick={() => setActiveRoom(index)} onKeyDown={(event) => onTabKeyDown(event, index)}><BedDouble size={17} aria-hidden="true" /><span>Phòng {index + 1}<small>{rate.roomTypeName}</small></span></button>)}</div>
    <div className="room-config-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${activeRoom}`}>
      <div className="room-config-main">
        <div className="room-config-heading"><div><p>Hạng phòng</p><h2>Phòng {activeRoom + 1} · {room.roomTypeName}</h2><span>{room.allotmentName ?? room.allotmentId}</span></div><div className="room-capacity"><UsersRound size={16} aria-hidden="true" /><strong>{capacity === undefined ? "Chưa có dữ liệu sức chứa" : `Tối đa ${capacity} khách/phòng`}</strong><span>{count}{capacity === undefined ? "" : `/${capacity}`} khách</span></div></div>
        <fieldset className="configuration-occupancy" disabled={disabled}><legend>Số khách trong phòng</legend>{categories.map(({ key, label, min, max }) => <div key={key} className="configuration-counter"><label htmlFor={`${id}-${key}`}>{label}</label><div className="occupancy-stepper">
          <button type="button" aria-label={`Giảm ${label.toLocaleLowerCase("vi")} · Phòng ${activeRoom + 1}`} disabled={occupancy[key] <= min} onClick={() => onOccupancyChange(activeRoom, { ...occupancy, [key]: occupancy[key] - 1 })}><Minus size={14} aria-hidden="true" /></button>
          <input id={`${id}-${key}`} type="number" aria-label={`${label} · Phòng ${activeRoom + 1}`} min={min} max={max} value={occupancy[key]} onChange={(event) => onOccupancyChange(activeRoom, { ...occupancy, [key]: Number(event.target.value) })} />
          <button type="button" aria-label={key === "adults" ? `Thêm khách vào phòng ${activeRoom + 1}` : `Tăng ${label.toLocaleLowerCase("vi")} · Phòng ${activeRoom + 1}`} disabled={occupancy[key] >= max} onClick={() => onOccupancyChange(activeRoom, { ...occupancy, [key]: occupancy[key] + 1 })}><Plus size={14} aria-hidden="true" /></button>
        </div></div>)}</fieldset>
        <p className="configuration-status" role="status">{repricing ? "Đang cập nhật giá và tồn phòng…" : "Giá được kiểm tra lại khi thay đổi số khách hoặc ngày lưu trú."}</p>
        <div className="configuration-days-heading"><h3>Chi tiết theo ngày</h3><span>{dates.length} đêm lưu trú</span></div>
        <ul className="configuration-days" aria-label={`Giá từng ngày · Phòng ${activeRoom + 1}`}>{dates.map((date) => {
          const nightly = stays[activeRoom]!.find((stay) => stay.arrivalDate <= date && date < stay.departureDate)?.detail ?? room;
          const daily = nightly.dailyRates.find((rate) => rate.date === date);
          return <li key={date}><div className="configuration-day-heading"><time dateTime={date}>{dateLabel(date)}</time><span>Giá / đêm <strong>{daily ? money(daily.amount, nightly.currency) : "Chưa có giá theo ngày"}</strong></span></div><div className="configuration-day-program"><strong>{nightly.roomTypeCode ? `${nightly.roomTypeCode} · ` : ""}{nightly.roomTypeName}</strong><span>{nightly.ratePlanName}{nightly.allotmentName ? ` · ${nightly.allotmentName}` : ""}</span>{daily?.tax === undefined ? null : <small>Thuế {money(daily.tax, nightly.currency)}</small>}
            <NightCodeEditor key={`${activeRoom}-${date}`} roomIndex={activeRoom} date={date} search={search} propertyId={room.propertyId} occupancy={occupancy} current={nightly} disabled={disabled} onApply={(date, rate) => onNightChange(activeRoom, date, rate)} />
          </div></li>;
        })}</ul>
      </div>
      <aside className="room-config-rate" aria-label={`Giá phòng ${activeRoom + 1}`}><p>Giá trung bình / đêm</p><strong className="configuration-average">{money(room.average, room.currency)}</strong><span className="configuration-room-total">Tổng {dates.length} đêm: <strong>{money(room.total, room.currency)}</strong></span><h3>Chương trình đã chọn</h3><p>{room.ratePlanName}</p>{room.services?.length ? <ul>{room.services.map((service) => <li key={service}>{service}</li>)}</ul> : null}
        {room.policies.length ? <details className="configuration-policies"><summary>Chính sách phòng</summary>{room.policies.map((policy, index) => <p key={index}><strong>{policy.type}</strong><br />{policy.description}</p>)}</details> : null}
        <label className="configuration-notes">Yêu cầu chung cho đặt phòng<textarea rows={3} maxLength={1000} value={notes} disabled={disabled} onChange={(event) => onNotesChange(event.target.value)} placeholder="Giờ đến dự kiến, yêu cầu giường…" /></label>
      </aside>
    </div>
    </div></div>
    <div className="configuration-footer"><div><span>Tổng giá net · {rooms.length} phòng · {dates.length} đêm</span><strong>{money(total, room.currency)}</strong></div><div className="configuration-footer-actions"><button className="quiet-button" type="button" disabled={disabled} onClick={onBack}>Quay lại tìm phòng</button><button className="select-room" type="button" disabled={disabled || datesDirty || invalidCapacity} onClick={onConfirm}>Xác nhận phòng</button></div></div>
  </section>;
}
