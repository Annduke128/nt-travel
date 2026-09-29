import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BookingCreateRequest, BookingDto, BookingGuest, BookingGuaranteesDto, BookingStatus, RateDetailDto, SearchRequest } from "../shared/contracts";
import { ApiError, bedbankApi } from "./api";

export type BookingSelection = { requestId: string; search: SearchRequest; detail: RateDetailDto; propertyName: string; items?: { detail: RateDetailDto; quantity: number }[]; journeyId?: string; journeyLeg?: number };
export type BookingDraftFields = { roomGuests?: BookingGuest[][]; notes?: string; accepted?: boolean };
const money = (amount: number, currency: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const statusLabel: Record<BookingStatus, string> = { creating: "Đang tạo · cần kiểm tra kết quả", created: "Chờ xác nhận", confirming: "Đang xác nhận · cần kiểm tra kết quả", confirmed: "Đã xác nhận", attention: "Cần đối soát" };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : "Không thể hoàn tất yêu cầu";
const emptyGuest = (): BookingGuest => ({ firstName: "", lastName: "", email: "", phoneNumber: "" });

function useBookingHeading(step: string) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (document.documentElement.scrollTop > 0) window.scrollTo(0, 0);
  }, [step]);
  return heading;
}

function BookingError({ message }: { message: string }) {
  return message ? <p className="error-state" role="alert">{message}</p> : null;
}

export function BookingCheckout({ selection, onCreated, onBack, onAddLeg, draftLegs = [], onSelectDraft, initialDraft, onDraftChange }: { selection: BookingSelection; onCreated: (booking: BookingDto) => void; onBack: () => void; onAddLeg?: () => Promise<void>; draftLegs?: BookingSelection[]; onSelectDraft?: (selection: BookingSelection) => void; initialDraft?: BookingDraftFields; onDraftChange?: (draft: BookingDraftFields) => void }) {
  const { search, detail } = selection;
  const items = selection.items ?? [{ detail, quantity: search.rooms.length }];
  const roomSelections = items.flatMap((item) => Array.from({ length: item.quantity }, () => ({ roomTypeId: item.detail.roomTypeId, ratePlanId: item.detail.ratePlanId, expectedUnitTotal: item.detail.total })));
  const [roomGuests, setRoomGuests] = useState(() => initialDraft?.roomGuests ?? search.rooms.map((room) => Array.from({ length: room.adults + room.children + room.infants }, emptyGuest)));
  const [notes, setNotes] = useState(initialDraft?.notes ?? "");
  const [accepted, setAccepted] = useState(initialDraft?.accepted ?? false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const heading = useBookingHeading("checkout");
  const total = items.reduce((sum, item) => sum + item.detail.total * item.quantity, 0);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || uncertain || !accepted) return;
    sending.current = true; setBusy(true); setError("");
    const input: BookingCreateRequest = { ...search, requestId: selection.requestId, journeyId: selection.journeyId, journeyLeg: selection.journeyLeg,
      propertyId: detail.propertyId, roomTypeId: detail.roomTypeId, ratePlanId: detail.ratePlanId,
      roomSelections, expectedTotal: total, currency: detail.currency, guests: roomGuests.map((room) => room[0]!), roomGuests, notes, acceptedPolicies: true };
    try { onCreated(await bedbankApi.createBooking(input)); }
    catch (reason) {
      setError(messageOf(reason));
      // Validation/price conflicts happen before creation. A lost response needs a read, never another write.
      setUncertain(!(reason instanceof ApiError && [400, 401, 403, 409, 429].includes(reason.status)));
    } finally { sending.current = false; setBusy(false); }
  };
  const recover = async () => {
    setBusy(true); setError("");
    try { onCreated(await bedbankApi.booking(selection.requestId)); }
    catch { setError("Chưa tìm thấy kết quả. Hãy mở Đặt phòng của tôi để kiểm tra hoặc liên hệ vận hành với mã đối soát trước khi tạo lại."); }
    finally { setBusy(false); }
  };
  const updateGuest = (roomIndex: number, guestIndex: number, field: keyof BookingGuest, value: string) => {
    const next = roomGuests.map((room, position) => position === roomIndex ? room.map((guest, person) => person === guestIndex ? { ...guest, [field]: value } : guest) : room);
    setRoomGuests(next);
    onDraftChange?.({ roomGuests: next, notes, accepted });
  };
  return <main className="module-page" id="main-content">
    <div className="module-heading"><div><p>Đặt phòng · 1 / 2</p><h1 ref={heading} tabIndex={-1}>Thông tin đặt phòng</h1><span>Nhập thông tin của tất cả khách trong từng phòng, sau đó xem điều kiện bảo đảm.</span></div><div className="module-actions">{onAddLeg && Math.max(selection.journeyLeg ?? 1, ...draftLegs.map((leg) => leg.journeyLeg ?? 1)) < 20 ? <button type="button" disabled={busy || uncertain} onClick={() => void onAddLeg().catch((reason) => setError(messageOf(reason)))}>Thêm chặng</button> : null}<button type="button" disabled={busy} onClick={onBack}>Quay lại tìm phòng</button></div></div>
    {draftLegs.length > 1 ? <section className="journey-draft" aria-label="Các chặng đang chọn"><h2>{draftLegs.length} chặng trong hành trình</h2><ul>{draftLegs.map((leg) => <li key={leg.requestId}><span>Chặng {leg.journeyLeg} · {leg.propertyName} · {leg.search.arrivalDate} → {leg.search.departureDate}</span>{leg.requestId === selection.requestId ? <strong>Đang nhập khách</strong> : <button type="button" disabled={busy} onClick={() => onSelectDraft?.(leg)}>Mở chặng {leg.journeyLeg}</button>}</li>)}</ul></section> : null}
    <div className="checkout-grid"><section className="checkout-main"><form onSubmit={submit}>
      <fieldset disabled={busy || uncertain} className="booking-fields">
        {roomGuests.map((room, roomIndex) => <fieldset className="guest-fields" key={roomIndex}><legend>Phòng {roomIndex + 1} · {items.flatMap((item) => Array.from({ length: item.quantity }, () => item.detail.roomTypeName))[roomIndex]}</legend>
          {room.map((guest, guestIndex) => <div className="guest-person" key={guestIndex}><h3>Khách {guestIndex + 1}{guestIndex === 0 ? " · Đại diện" : ""}</h3>
            <label>Họ khách<input aria-label={`Họ khách · Phòng ${roomIndex + 1}${guestIndex ? ` · Khách ${guestIndex + 1}` : ""}`} autoComplete="family-name" required maxLength={100} value={guest.lastName} onChange={(event) => updateGuest(roomIndex, guestIndex, "lastName", event.target.value)} /></label>
            <label>Tên khách<input aria-label={`Tên khách · Phòng ${roomIndex + 1}${guestIndex ? ` · Khách ${guestIndex + 1}` : ""}`} autoComplete="given-name" required maxLength={100} value={guest.firstName} onChange={(event) => updateGuest(roomIndex, guestIndex, "firstName", event.target.value)} /></label>
            <label>Email<input aria-label={`Email · Phòng ${roomIndex + 1}${guestIndex ? ` · Khách ${guestIndex + 1}` : ""}`} type="email" autoComplete="email" required maxLength={254} value={guest.email} onChange={(event) => updateGuest(roomIndex, guestIndex, "email", event.target.value)} /></label>
            <label>Điện thoại<input aria-label={`Điện thoại · Phòng ${roomIndex + 1}${guestIndex ? ` · Khách ${guestIndex + 1}` : ""}`} type="tel" autoComplete="tel" required minLength={7} maxLength={25} value={guest.phoneNumber} onChange={(event) => updateGuest(roomIndex, guestIndex, "phoneNumber", event.target.value)} /></label>
          </div>)}
        </fieldset>)}
        <label>Yêu cầu đặc biệt<textarea rows={3} maxLength={1000} value={notes} onChange={(event) => { setNotes(event.target.value); onDraftChange?.({ roomGuests, notes: event.target.value, accepted }); }} placeholder="Giờ đến dự kiến, yêu cầu giường…" /></label>
        <p className="booking-help">Yêu cầu đặc biệt tùy thuộc khả năng đáp ứng của khách sạn.</p>
        <label className="booking-check"><input type="checkbox" required checked={accepted} onChange={(event) => { setAccepted(event.target.checked); onDraftChange?.({ roomGuests, notes, accepted: event.target.checked }); }} /><span>Tôi đã đọc giá và chính sách đặt phòng.</span></label>
        <button className="search-button" disabled={!accepted || busy || uncertain} type="submit">{busy ? "Đang tạo đặt phòng…" : "Tạo đặt phòng"}</button>
      </fieldset>
    </form><BookingError message={error} />{uncertain ? <div className="booking-recovery"><p>Mã đối soát: <strong>NT-{selection.requestId}</strong></p><button type="button" className="select-room" disabled={busy} onClick={() => void recover()}>Kiểm tra trạng thái đơn</button></div> : null}</section>
      <aside className="checkout-summary"><p className="eyebrow">Kỳ nghỉ đã chọn</p><h2>{selection.propertyName}</h2>
        <dl><div><dt>Nhận phòng</dt><dd>{search.arrivalDate}</dd></div><div><dt>Trả phòng</dt><dd>{search.departureDate}</dd></div><div><dt>Số phòng</dt><dd>{search.rooms.length}</dd></div><div><dt>Khách / phòng</dt><dd>{search.rooms[0]!.adults} người lớn · {search.rooms[0]!.children} trẻ em · {search.rooms[0]!.infants} em bé</dd></div></dl>
        <h3>Giá từng hạng phòng</h3><ul className="booking-price-lines">{items.map((item) => <li key={`${item.detail.roomTypeId}-${item.detail.ratePlanId}`}><span>{item.detail.roomTypeName} · {item.quantity} phòng · {money(item.detail.total, item.detail.currency)}/phòng</span><strong>{money(item.detail.total * item.quantity, item.detail.currency)}</strong></li>)}</ul>
        <dl><div className="booking-total"><dt>Tổng giá net</dt><dd>{money(total, detail.currency)}</dd></div></dl>
        <p>{items.some((item) => item.detail.tax === undefined) ? "Một số hạng phòng chưa có dữ liệu thuế riêng từ khách sạn." : `Thuế theo báo giá: ${money(items.reduce((sum, item) => sum + item.detail.tax! * item.quantity, 0), detail.currency)}`}</p>
        <h3>Chính sách</h3>{items.flatMap((item) => item.detail.policies.map((policy) => ({ ...policy, roomTypeName: item.detail.roomTypeName }))).length ? items.flatMap((item) => item.detail.policies.map((policy) => <p key={`${item.detail.roomTypeId}-${policy.type}-${policy.description}`}><strong>{item.detail.roomTypeName} · {policy.type}</strong><br />{policy.description}</p>)) : <p>Khách sạn chưa cung cấp mô tả chính sách.</p>}
        <p className="booking-help">Giá và tồn phòng được kiểm tra lại khi tạo đơn. Đơn cần được xác nhận ở bước tiếp theo.</p>
      </aside></div>
  </main>;
}

export function BookingDetails({ initial, onBack, onAddLeg, onSelectLeg, pendingLegs = [], onOpenDraft }: { initial: BookingDto; onBack: () => void; onAddLeg?: (booking: BookingDto) => Promise<void>; onSelectLeg?: (booking: BookingDto) => void; pendingLegs?: BookingSelection[]; onOpenDraft?: (selection: BookingSelection) => void }) {
  const [booking, setBooking] = useState(initial);
  const journeyId = booking.request.journeyId ?? booking.id;
  const roomLines = booking.roomLines ?? booking.request.rooms.map(() => ({ roomTypeName: booking.roomTypeName, ratePlanName: booking.ratePlanName, unitTotal: booking.total / booking.request.rooms.length }));
  const heading = useBookingHeading(booking.status);
  const [terms, setTerms] = useState<BookingGuaranteesDto>();
  const [journeyBookings, setJourneyBookings] = useState<BookingDto[]>([]);
  const [journeyLoaded, setJourneyLoaded] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const loadTerms = async () => {
    setBusy(true); setError(""); setAccepted(false); setTerms(undefined);
    try { setTerms(await bedbankApi.bookingGuarantees(booking.id)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (booking.status !== "created") return;
    let active = true;
    bedbankApi.bookingGuarantees(booking.id).then((value) => { if (active) setTerms(value); }).catch((reason) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [booking.id, booking.status]);
  useEffect(() => {
    let active = true;
    bedbankApi.journeyBookings(journeyId).then((items) => { if (active) { setJourneyBookings(items); setJourneyLoaded(true); } }).catch((reason) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [journeyId]);
  const confirm = async () => {
    if (!terms || !accepted || sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try { setBooking(await bedbankApi.confirmBooking(booking.id, terms.version)); }
    catch (reason) {
      setError(messageOf(reason)); setTerms(undefined); setAccepted(false);
      if (!(reason instanceof ApiError && [400, 401, 403, 409, 429].includes(reason.status))) setBooking((current) => ({ ...current, status: "confirming" }));
    } finally { sending.current = false; setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError("");
    try { setBooking(await bedbankApi.booking(booking.id)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };
  return <main className="module-page" id="main-content"><div className="module-heading"><div><p>Đặt phòng · 2 / 2</p><h1 ref={heading} tabIndex={-1}>{booking.status === "confirmed" ? "Đặt phòng đã xác nhận" : "Chi tiết đặt phòng"}</h1><span>{booking.propertyName} · {booking.request.arrivalDate} → {booking.request.departureDate}</span></div><button type="button" disabled={busy} onClick={onBack}>Đặt phòng của tôi</button></div>
    {booking.mode === "mock" ? <p className="booking-demo" role="note">Đặt phòng thử nghiệm · Không giữ phòng thật. Dữ liệu được xóa khi khởi động lại máy chủ.</p> : null}
    <div className="booking-record"><span className="status" data-pending={booking.status !== "confirmed"}>{statusLabel[booking.status]}</span><h2>{booking.roomTypeName}</h2><p>{booking.ratePlanName} · {booking.request.rooms.length} phòng · {money(booking.total, booking.currency)}</p>
      <p className="booking-reference">Mã đối soát: <strong>{booking.reference}</strong></p>
      <p className="booking-reference">Mã hành trình: NT-J-{journeyId} · Chặng {booking.request.journeyLeg ?? 1}</p>
      <h3>Giá từng phòng trong yêu cầu</h3><ul className="booking-price-lines">{roomLines.map((line, index) => <li key={`${index}-${line.roomTypeName}`}><span>Phòng {index + 1} · {line.roomTypeName} · {line.ratePlanName} · {money(line.unitTotal, booking.currency)}/phòng</span></li>)}</ul>
      {booking.request.roomGuests?.length ? <><h3>Khách trong từng phòng</h3><ul className="booking-guest-list">{booking.request.roomGuests.map((guests, roomIndex) => <li key={roomIndex}><strong>Phòng {roomIndex + 1}</strong>{guests.map((guest, guestIndex) => <span key={guestIndex}>{guest.lastName} {guest.firstName} · {guest.email} · {guest.phoneNumber}</span>)}</li>)}</ul></> : null}
      <h3>Mã xác nhận từ CiHMS</h3><p className="booking-help">CiHMS chưa trả liên kết giữa từng mã xác nhận và hạng phòng. Đối chiếu theo mã khi làm việc với khách sạn.</p><ul className="booking-reservations">{booking.reservations.map((item) => <li key={item.id}><span>Mã phòng CiHMS</span><strong>{item.confirmationNumber || item.id}</strong><span>{item.status === "Reserved" ? "Đã xác nhận" : item.status === "Prospect" ? "Chờ xác nhận" : item.status}</span>{item.error ? <p role="alert">{item.error}</p> : null}</li>)}</ul>
      {booking.message ? <p className="error-state" role="alert">{booking.message}</p> : null}
      {["creating", "confirming"].includes(booking.status) ? <p>Yêu cầu có thể vẫn đang xử lý. Kiểm tra lại trạng thái hoặc liên hệ vận hành với mã đối soát trước khi gửi đơn mới.</p> : null}
      <button className="quiet-button" type="button" disabled={busy} onClick={() => void refresh()}>Kiểm tra trạng thái đơn</button>
      {onAddLeg && journeyLoaded && ["created", "confirmed"].includes(booking.status) && Math.max(booking.request.journeyLeg ?? 1, ...journeyBookings.map((item) => item.request.journeyLeg ?? 1), ...pendingLegs.map((item) => item.journeyLeg ?? 1)) < 20 ? <button className="quiet-button" type="button" disabled={busy} onClick={() => void onAddLeg(booking).catch((reason) => setError(messageOf(reason)))}>Thêm chặng</button> : null}
    </div>{pendingLegs.length > 0 ? <section className="journey-draft" aria-label="Chặng chưa đặt"><h2>Chặng đã chọn, chưa tạo booking</h2><ul>{pendingLegs.map((leg) => <li key={leg.requestId}><span>Chặng {leg.journeyLeg} · {leg.propertyName} · {leg.search.arrivalDate} → {leg.search.departureDate}</span><button type="button" onClick={() => onOpenDraft?.(leg)}>Tiếp tục chặng {leg.journeyLeg}</button></li>)}</ul></section> : null}{journeyBookings.length > 0 ? <section className="journey-legs" aria-label="Các chặng trong hành trình"><h2>Các chặng trong hành trình</h2><ul>{journeyBookings.map((item) => <li key={item.id}><span>Chặng {item.request.journeyLeg ?? 1} · {item.propertyName} · {item.request.arrivalDate} → {item.request.departureDate}</span><span>{statusLabel[item.status]} · {money(item.total, item.currency)}</span>{onSelectLeg && item.id !== booking.id ? <button type="button" onClick={() => onSelectLeg(item)}>Xem chặng {item.request.journeyLeg ?? 1}</button> : null}</li>)}</ul></section> : null}<BookingError message={error} />
    {booking.status === "created" ? <section className="guarantee-panel" aria-labelledby="guarantee-title"><h2 id="guarantee-title">Điều kiện bảo đảm đặt phòng</h2>
      <p>Kiểm tra các khoản bảo đảm do khách sạn yêu cầu trước khi xác nhận. Xác nhận đơn không đồng nghĩa đã thanh toán.</p>
      {terms ? <><div className="guarantee-list">{terms.guarantees.map((item, index) => <article key={item.reservationId}><h3>Phòng {index + 1} · {money(item.amount, item.currency)}</h3>{item.dueDate ? <p>Hạn bảo đảm: {item.dueDate}</p> : null}<ul>{item.methods.map((method, methodIndex) => <li key={`${method.id}-${methodIndex}`}>{method.type === "Deposit" ? "Đặt cọc" : method.type}{method.stayDate ? ` · ${method.stayDate}` : ""}: {money(method.amount, method.currency)}</li>)}</ul></article>)}</div>
        <label className="booking-check"><input type="checkbox" checked={accepted} disabled={busy} onChange={(event) => setAccepted(event.target.checked)} /><span>Tôi đồng ý với các điều kiện bảo đảm trên và xác nhận đặt phòng.</span></label>
        <button className="search-button" type="button" disabled={!accepted || busy} onClick={() => void confirm()}>{busy ? "Đang xác nhận…" : "Xác nhận đặt phòng"}</button></> : <p role="status">{error ? "Chưa tải được điều kiện bảo đảm." : "Đang tải điều kiện bảo đảm…"}</p>}
      <button className="quiet-button" type="button" disabled={busy} onClick={() => void loadTerms()}>Tải lại điều kiện bảo đảm</button>
    </section> : null}
  </main>;
}

export function BookingsList({ onSelect, onSearch }: { onSelect: (booking: BookingDto) => void; onSearch: () => void }) {
  const heading = useBookingHeading("list");
  const [bookings, setBookings] = useState<BookingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try { setBookings(await bedbankApi.bookings()); } catch (reason) { setError(messageOf(reason)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const normalized = filter.trim().toLocaleLowerCase("vi");
  const visible = bookings.filter((booking) => [booking.propertyName, booking.reference, booking.request.journeyId ?? "", ...booking.reservations.map((item) => item.confirmationNumber), ...booking.request.guests.map((guest) => `${guest.lastName} ${guest.firstName}`)].join(" ").toLocaleLowerCase("vi").includes(normalized));
  return <main className="module-page" id="main-content"><div className="module-heading"><div><p>Theo dõi đặt phòng</p><h1 ref={heading} tabIndex={-1}>Đặt phòng của tôi</h1><span>100 yêu cầu gần nhất được bạn tạo qua NT Travel.</span></div><button type="button" onClick={onSearch}>Đặt phòng mới</button></div>
    <div className="booking-toolbar"><label>Tìm trong danh sách<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Mã đặt phòng, khách sạn, tên khách…" /></label><button type="button" className="quiet-button" disabled={loading} onClick={() => void load()}>Làm mới</button></div>
    <BookingError message={error} />{loading ? <p className="loading-state" role="status">Đang tải đặt phòng…</p> : null}
    {!loading && !error && !visible.length ? <div className="empty-state"><h2>{bookings.length ? "Không tìm thấy đặt phòng phù hợp." : "Bạn chưa có đặt phòng nào."}</h2><p>Chọn khách sạn và hạng phòng để bắt đầu đặt phòng.</p></div> : null}
    <section className="booking-list" aria-label="Danh sách đặt phòng">{visible.map((booking) => <article className="booking-list-item" key={booking.id}><div><span className="status" data-pending={booking.status !== "confirmed"}>{statusLabel[booking.status]}{booking.mode === "mock" ? " · Thử nghiệm" : ""}</span><h2>{booking.propertyName}</h2><p>{booking.request.arrivalDate} → {booking.request.departureDate} · {booking.request.rooms.length} phòng</p>{booking.request.journeyId ? <p>Mã hành trình: NT-J-{booking.request.journeyId} · Chặng {booking.request.journeyLeg}</p> : null}<p>{booking.reservations.map((item) => item.confirmationNumber).filter(Boolean).join(", ") || booking.reference}</p></div><div><strong>{money(booking.total, booking.currency)}</strong><button type="button" className="select-room" onClick={() => onSelect(booking)}>Xem đặt phòng</button></div></article>)}</section>
  </main>;
}
