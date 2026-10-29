import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { BedDouble, CheckCircle2, ChevronUp } from "lucide-react";
import type { BookingGuest, RateDetailDto } from "../shared/contracts";
import { COUNTRY_CODES, countryName, isCountryCode } from "../shared/countries";

type GuestField = keyof BookingGuest;
type Editor = { roomIndex: number; validate?: boolean };
type Props = { rooms: RateDetailDto[]; guests: BookingGuest[][]; capacities: (number | undefined)[]; disabled: boolean; editor?: Editor; onOpen: (editor: Editor) => void; onClose: () => void; onChange: (roomIndex: number, guestIndex: number, field: GuestField, value: string) => void };
const money = (value: number, currency: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const countries = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.code === "VN" ? -1 : b.code === "VN" ? 1 : a.name.localeCompare(b.name, "vi"));
const countryOptions = countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>);
const fields = [
  { key: "lastName", label: "Họ khách", type: "text", autoComplete: "family-name", max: 100, required: true },
  { key: "firstName", label: "Tên khách", type: "text", autoComplete: "given-name", max: 100, required: true },
  { key: "country", label: "Quốc gia", type: "country", autoComplete: "country", max: 2, required: true },
  { key: "nationality", label: "Quốc tịch", type: "country", autoComplete: "off", max: 2, required: true },
  { key: "email", label: "Email", type: "email", autoComplete: "email", max: 254, required: false },
  { key: "phoneNumber", label: "Điện thoại", type: "tel", autoComplete: "tel", max: 25, required: false },
] as const;
function guestErrors(guest: BookingGuest): Record<GuestField, string> {
  const nameValid = (value: string) => value.trim().length > 0 && value.trim().length <= 100;
  return {
    firstName: nameValid(guest.firstName) ? "" : "Nhập tên khách (1–100 ký tự).",
    lastName: nameValid(guest.lastName) ? "" : "Nhập họ khách (1–100 ký tự).",
    country: isCountryCode(guest.country ?? "") ? "" : "Chọn quốc gia.",
    nationality: isCountryCode(guest.nationality ?? "") ? "" : "Chọn quốc tịch.",
    email: !guest.email?.trim() || (guest.email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())) ? "" : "Nhập địa chỉ email hợp lệ.",
    phoneNumber: !guest.phoneNumber?.trim() || /^\+?[0-9 ()-]{7,25}$/.test(guest.phoneNumber.trim()) ? "" : "Nhập số điện thoại hợp lệ (7–25 ký tự).",
  };
}
export const guestComplete = (guest: BookingGuest) => Object.values(guestErrors(guest)).every((error) => !error);

export function GuestRooms({ rooms, guests, capacities, disabled, editor, onOpen, onClose, onChange }: Props) {
  const panelId = useId();
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const closeEditor = () => {
    const trigger = editor ? triggers.current[editor.roomIndex] : null;
    onClose(); trigger?.focus({ preventScroll: true });
  };
  const completedRooms = guests.filter((room) => room.every(guestComplete)).length;
  return <div className="guest-room-selector">
    <p className="guest-room-progress" role="status">Đã đủ thông tin {completedRooms}/{rooms.length} phòng</p>
    <ol className="guest-room-list" aria-label="Thông tin khách theo phòng">{guests.map((room, index) => {
      const completed = room.filter(guestComplete).length;
      const maximum = Math.min(18, capacities[index] ?? room.length);
      const detail = rooms[index]!;
      return <li key={index}><button type="button" ref={(node) => { triggers.current[index] = node; }} className="guest-room-summary" data-complete={completed === room.length} title={`${detail.roomTypeName} · ${room.length}/${maximum} khách · ${money(detail.total, detail.currency)}/phòng`} aria-label={`Thông tin khách · Phòng ${index + 1}`} aria-expanded={editor?.roomIndex === index} aria-controls={editor?.roomIndex === index ? panelId : undefined} disabled={disabled} onClick={() => { if (editor?.roomIndex === index) closeEditor(); else onOpen({ roomIndex: index }); }}>
        <BedDouble size={17} aria-hidden="true" /><span className="guest-room-description"><strong>Phòng {index + 1}</strong><small>{detail.roomTypeName}</small></span>
        <span className="guest-room-completion" data-complete={completed === room.length}>{completed === room.length ? <CheckCircle2 size={15} aria-hidden="true" /> : null}{completed}/{room.length} khách đã điền</span>
      </button></li>;
    })}</ol>
    {editor ? <GuestRoomPanel key={editor.roomIndex} id={panelId} roomIndex={editor.roomIndex} guests={guests[editor.roomIndex]!} disabled={disabled} validationRequest={editor} onClose={closeEditor} onChange={(guestIndex, field, value) => onChange(editor.roomIndex, guestIndex, field, value)} /> : null}
  </div>;
}

function GuestRoomPanel({ id, roomIndex, guests, disabled, validationRequest, onClose, onChange }: { id: string; roomIndex: number; guests: BookingGuest[]; disabled: boolean; validationRequest: Editor; onClose: () => void; onChange: (guestIndex: number, field: GuestField, value: string) => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  const completed = guests.filter(guestComplete).length;
  useEffect(() => { if (validationRequest.validate) setAttempt((current) => current + 1); }, [validationRequest]);
  useEffect(() => {
    const input = form.current?.querySelector<HTMLInputElement | HTMLSelectElement>(attempt ? '[aria-invalid="true"]' : ":is(input, select)");
    input?.focus(); input?.scrollIntoView?.({ block: "nearest" });
  }, [attempt]);
  const submit = (event: FormEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (disabled) return;
    if (completed < guests.length) { setAttempt((current) => current + 1); return; }
    onClose();
  };
  return <section id={id} className="guest-room-panel" aria-label={`Thông tin khách · Phòng ${roomIndex + 1}`} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <form ref={form} className="guest-inline-form" noValidate onSubmit={submit}><div className="guest-inline-body"><fieldset className="booking-fields" disabled={disabled}>
      {guests.map((guest, guestIndex) => {
        const errors = guestErrors(guest);
        return <div className="guest-person" key={guestIndex}><div className="guest-person-head"><h3>Khách {guestIndex + 1}{guestIndex === 0 ? " · Đại diện" : ""}</h3>{guestIndex === 0 ? <button className="icon-button guest-inline-collapse" type="button" aria-label="Đóng thông tin phòng" onClick={onClose}><ChevronUp size={16} aria-hidden="true" /></button> : null}</div>{fields.map(({ key, label, type, autoComplete, max, required }) => {
          const error = attempt ? errors[key] : "";
          const fieldId = `${id}-${guestIndex}-${key}`;
          const ariaLabel = `${label} · Phòng ${roomIndex + 1}${guestIndex ? ` · Khách ${guestIndex + 1}` : ""}`;
          return <label key={key} htmlFor={fieldId}><span>{label}{required ? " *" : " (không bắt buộc)"}</span>{type === "country" ? <select id={fieldId} aria-label={ariaLabel} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined} autoComplete={key === "nationality" ? "off" : `section-room${roomIndex}-guest${guestIndex} country`} required value={guest[key] ?? ""} onChange={(event) => onChange(guestIndex, key, event.target.value)}><option value="">{key === "nationality" ? "Chọn quốc tịch" : "Chọn quốc gia"}</option>{countryOptions}</select> : <input id={fieldId} aria-label={ariaLabel} aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined} type={type} autoComplete={`section-room${roomIndex}-guest${guestIndex} ${autoComplete}`} required={required} maxLength={max} minLength={key === "phoneNumber" ? 7 : undefined} value={guest[key] ?? ""} onChange={(event) => onChange(guestIndex, key, event.target.value)} />}{error ? <span className="field-hint" id={`${fieldId}-error`}>{error}</span> : null}</label>;
        })}</div>;
      })}
    </fieldset></div><footer className="guest-inline-footer"><span>{completed}/{guests.length} khách đã điền đủ</span><button type="submit" className="select-room" disabled={disabled}>Lưu và đóng</button></footer></form>
  </section>;
}
