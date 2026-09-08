import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BookingCreateRequest, BookingDto, BookingGuest, BookingGuaranteesDto, BookingStatus, RateDetailDto, SearchRequest } from "../shared/contracts";
import { ApiError, bedbankApi } from "./api";

export type BookingSelection = { requestId: string; search: SearchRequest; detail: RateDetailDto; propertyName: string };
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

export function BookingCheckout({ selection, onCreated, onBack }: { selection: BookingSelection; onCreated: (booking: BookingDto) => void; onBack: () => void }) {
  const { search, detail } = selection;
  const [guests, setGuests] = useState(() => search.rooms.map(emptyGuest));
  const [notes, setNotes] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const heading = useBookingHeading("checkout");
  const total = detail.total * search.rooms.length;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || uncertain || !accepted) return;
    sending.current = true; setBusy(true); setError("");
    const input: BookingCreateRequest = { ...search, requestId: selection.requestId,
      propertyId: detail.propertyId, roomTypeId: detail.roomTypeId, ratePlanId: detail.ratePlanId,
      expectedTotal: total, currency: detail.currency, guests, notes, acceptedPolicies: true };
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
  const updateGuest = (index: number, field: keyof BookingGuest, value: string) => setGuests((current) => current.map((guest, position) => position === index ? { ...guest, [field]: value } : guest));
  return <main className="module-page" id="main-content">
    <div className="module-heading"><div><p>Đặt phòng · 1 / 2</p><h1 ref={heading} tabIndex={-1}>Thông tin đặt phòng</h1><span>Nhập khách đại diện cho từng phòng, sau đó xem điều kiện bảo đảm.</span></div><button type="button" disabled={busy} onClick={onBack}>Quay lại tìm phòng</button></div>
    <div className="checkout-grid"><section className="checkout-main"><form onSubmit={submit}>
      <fieldset disabled={busy || uncertain} className="booking-fields">
        {guests.map((guest, index) => <fieldset className="guest-fields" key={index}><legend>Khách đại diện · Phòng {index + 1}</legend>
          <label>Họ khách<input aria-label={`Họ khách · Phòng ${index + 1}`} autoComplete="family-name" required maxLength={100} value={guest.lastName} onChange={(event) => updateGuest(index, "lastName", event.target.value)} /></label>
          <label>Tên khách<input aria-label={`Tên khách · Phòng ${index + 1}`} autoComplete="given-name" required maxLength={100} value={guest.firstName} onChange={(event) => updateGuest(index, "firstName", event.target.value)} /></label>
          <label>Email<input aria-label={`Email · Phòng ${index + 1}`} type="email" autoComplete="email" required maxLength={254} value={guest.email} onChange={(event) => updateGuest(index, "email", event.target.value)} /></label>
          <label>Điện thoại<input aria-label={`Điện thoại · Phòng ${index + 1}`} type="tel" autoComplete="tel" required minLength={7} maxLength={25} value={guest.phoneNumber} onChange={(event) => updateGuest(index, "phoneNumber", event.target.value)} /></label>
        </fieldset>)}
        <label>Yêu cầu đặc biệt<textarea rows={3} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Giờ đến dự kiến, yêu cầu giường…" /></label>
        <p className="booking-help">Yêu cầu đặc biệt tùy thuộc khả năng đáp ứng của khách sạn.</p>
        <label className="booking-check"><input type="checkbox" required checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>Tôi đã đọc giá và chính sách đặt phòng.</span></label>
        <button className="search-button" disabled={!accepted || busy || uncertain} type="submit">{busy ? "Đang tạo đặt phòng…" : "Tạo đặt phòng"}</button>
      </fieldset>
    </form><BookingError message={error} />{uncertain ? <div className="booking-recovery"><p>Mã đối soát: <strong>NT-{selection.requestId}</strong></p><button type="button" className="select-room" disabled={busy} onClick={() => void recover()}>Kiểm tra trạng thái đơn</button></div> : null}</section>
      <aside className="checkout-summary"><p className="eyebrow">Kỳ nghỉ đã chọn</p><h2>{selection.propertyName}</h2><p>{detail.roomTypeName} · {detail.ratePlanName}</p>
        <dl><div><dt>Nhận phòng</dt><dd>{search.arrivalDate}</dd></div><div><dt>Trả phòng</dt><dd>{search.departureDate}</dd></div><div><dt>Số phòng</dt><dd>{search.rooms.length}</dd></div><div><dt>Khách / phòng</dt><dd>{search.rooms[0]!.adults} người lớn · {search.rooms[0]!.children} trẻ em · {search.rooms[0]!.infants} em bé</dd></div><div><dt>Giá net / phòng / kỳ</dt><dd>{money(detail.total, detail.currency)}</dd></div><div className="booking-total"><dt>Tổng giá net</dt><dd>{money(total, detail.currency)}</dd></div></dl>
        <p>{detail.tax === undefined ? "Chưa có dữ liệu thuế riêng từ khách sạn." : `Thuế theo báo giá: ${money(detail.tax * search.rooms.length, detail.currency)}`}</p>
        <h3>Chính sách</h3>{detail.policies.length ? detail.policies.map((policy) => <p key={`${policy.type}-${policy.description}`}><strong>{policy.type}</strong><br />{policy.description}</p>) : <p>Khách sạn chưa cung cấp mô tả chính sách.</p>}
        <p className="booking-help">Giá và tồn phòng được kiểm tra lại khi tạo đơn. Đơn cần được xác nhận ở bước tiếp theo.</p>
      </aside></div>
  </main>;
}

export function BookingDetails({ initial, onBack }: { initial: BookingDto; onBack: () => void }) {
  const [booking, setBooking] = useState(initial);
  const heading = useBookingHeading(booking.status);
  const [terms, setTerms] = useState<BookingGuaranteesDto>();
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
      <ul className="booking-reservations">{booking.reservations.map((item, index) => <li key={item.id}><span>Phòng {index + 1}</span><strong>{item.confirmationNumber || item.id}</strong><span>{item.status === "Reserved" ? "Đã xác nhận" : item.status === "Prospect" ? "Chờ xác nhận" : item.status}</span>{item.error ? <p role="alert">{item.error}</p> : null}</li>)}</ul>
      {booking.message ? <p className="error-state" role="alert">{booking.message}</p> : null}
      {["creating", "confirming"].includes(booking.status) ? <p>Yêu cầu có thể vẫn đang xử lý. Kiểm tra lại trạng thái hoặc liên hệ vận hành với mã đối soát trước khi gửi đơn mới.</p> : null}
      <button className="quiet-button" type="button" disabled={busy} onClick={() => void refresh()}>Kiểm tra trạng thái đơn</button>
    </div><BookingError message={error} />
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
  const visible = bookings.filter((booking) => [booking.propertyName, booking.reference, ...booking.reservations.map((item) => item.confirmationNumber), ...booking.request.guests.map((guest) => `${guest.lastName} ${guest.firstName}`)].join(" ").toLocaleLowerCase("vi").includes(normalized));
  return <main className="module-page" id="main-content"><div className="module-heading"><div><p>Theo dõi đặt phòng</p><h1 ref={heading} tabIndex={-1}>Đặt phòng của tôi</h1><span>100 yêu cầu gần nhất được bạn tạo qua NT Travel.</span></div><button type="button" onClick={onSearch}>Đặt phòng mới</button></div>
    <div className="booking-toolbar"><label>Tìm trong danh sách<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Mã đặt phòng, khách sạn, tên khách…" /></label><button type="button" className="quiet-button" disabled={loading} onClick={() => void load()}>Làm mới</button></div>
    <BookingError message={error} />{loading ? <p className="loading-state" role="status">Đang tải đặt phòng…</p> : null}
    {!loading && !error && !visible.length ? <div className="empty-state"><h2>{bookings.length ? "Không tìm thấy đặt phòng phù hợp." : "Bạn chưa có đặt phòng nào."}</h2><p>Chọn khách sạn và hạng phòng để bắt đầu đặt phòng.</p></div> : null}
    <section className="booking-list" aria-label="Danh sách đặt phòng">{visible.map((booking) => <article className="booking-list-item" key={booking.id}><div><span className="status" data-pending={booking.status !== "confirmed"}>{statusLabel[booking.status]}{booking.mode === "mock" ? " · Thử nghiệm" : ""}</span><h2>{booking.propertyName}</h2><p>{booking.request.arrivalDate} → {booking.request.departureDate} · {booking.request.rooms.length} phòng</p><p>{booking.reservations.map((item) => item.confirmationNumber).filter(Boolean).join(", ") || booking.reference}</p></div><div><strong>{money(booking.total, booking.currency)}</strong><button type="button" className="select-room" onClick={() => onSelect(booking)}>Xem đặt phòng</button></div></article>)}</section>
  </main>;
}
