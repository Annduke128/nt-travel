import { useEffect, useId, useState, type FormEvent } from "react";
import { CalendarDays, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { nextDate, stayDates } from "../shared/roomStays";

type Props = { arrivalDate: string; departureDate: string; disabled: boolean; collapsed: boolean; onToggle: () => void; onEditingChange: (dirty: boolean) => void; onApply: (arrivalDate: string, departureDate: string) => Promise<string | undefined> };

export function StayDateEditor({ arrivalDate, departureDate, disabled, collapsed, onToggle, onEditingChange, onApply }: Props) {
  const [arrival, setArrival] = useState(arrivalDate);
  const [departure, setDeparture] = useState(departureDate);
  const [error, setError] = useState("");
  const dirty = arrival !== arrivalDate || departure !== departureDate;
  const contentId = useId();
  const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  const toggleLabel = collapsed ? "Mở ngày lưu trú" : "Thu gọn ngày lưu trú";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  useEffect(() => {
    setArrival(arrivalDate); setDeparture(departureDate); setError(""); onEditingChange(false);
  }, [arrivalDate, departureDate, onEditingChange]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !dirty) return;
    setError(""); setError(await onApply(arrival, departure) ?? "");
  };
  return <aside className="stay-date-sidebar" aria-label="Ngày lưu trú" data-collapsed={collapsed}>
    <button className="stay-date-toggle" type="button" aria-label={toggleLabel} aria-expanded={!collapsed} aria-controls={contentId} disabled={disabled} title={`${toggleLabel}${dirty ? " · Có thay đổi chưa áp dụng" : ""}`} onClick={onToggle}>
      {collapsed ? <PanelLeftOpen size={19} aria-hidden="true" /> : <CalendarDays size={19} aria-hidden="true" />}
      <span className="stay-date-toggle-copy"><strong>Ngày lưu trú</strong><small>{shortDate(arrivalDate)} → {shortDate(departureDate)} · {stayDates(arrivalDate, departureDate).length} đêm</small></span>
      {dirty ? <span className="stay-date-pending" role="status" aria-label="Có thay đổi ngày chưa áp dụng" /> : null}
      {collapsed ? null : <PanelLeftClose className="stay-date-collapse-icon" size={18} aria-hidden="true" />}
    </button>
    <div id={contentId} hidden={collapsed}><form className="stay-date-editor" aria-label="Ngày lưu trú" onSubmit={submit}>
    <div className="stay-date-fields"><label>Nhận phòng<input aria-label="Ngày nhận phòng" type="date" min={today} required value={arrival} disabled={disabled} onChange={(event) => { const value = event.target.value; setArrival(value); setError(""); onEditingChange(value !== arrivalDate || departure !== departureDate); }} /></label>
      <label>Trả phòng<input aria-label="Ngày trả phòng" type="date" min={arrival ? nextDate(arrival) : today} required value={departure} disabled={disabled} onChange={(event) => { const value = event.target.value; setDeparture(value); setError(""); onEditingChange(arrival !== arrivalDate || value !== departureDate); }} /></label>
      <button type="submit" className="select-room" disabled={disabled || !dirty}>Áp dụng ngày</button>
      {dirty ? <button type="button" className="quiet-button" disabled={disabled} onClick={() => { setArrival(arrivalDate); setDeparture(departureDate); setError(""); onEditingChange(false); }}>Hủy thay đổi ngày</button> : null}
    </div>
    <p>Áp dụng cho tất cả phòng · Tối đa 30 đêm · Giữ thứ tự mã phòng đã chọn.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </form></div></aside>;
}
