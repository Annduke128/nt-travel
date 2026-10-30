import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CalendarDays, ChevronDown, Hotel, LogOut, Search, ShieldCheck, UserCog, X } from "lucide-react";
import { MAX_BOOKING_ROOMS, rateKey, sameRate } from "../shared/contracts";
import type { BookingDto, HotelAvailabilityDto, NoAvailabilityDetails, Profile, PropertyDto, RateDetailDto, RoomAvailabilityDto, SearchRequest } from "../shared/contracts";
import { ApiError, bedbankApi } from "./api";
import { BookingCheckout, BookingDetails, BookingsList, type BookingDraftFields, type BookingSelection } from "./Booking";
import { SearchFilters } from "./SearchFilters";
import { RoomRateTable, type ChosenRate } from "./RoomRateTable";
import { EMPTY_FILTERS, filterHotels, hasFilters, matchesRate, type AvailabilityFilters } from "./availabilityFilters";

type View = "search" | "users" | "bookings" | "checkout" | "booking";
// Hai lý do "không có kết quả" mà BFF phân biệt bằng mã lỗi: sai tên thì sửa tên, khớp tên mà
// hết phòng thì đổi ngày. Lỗi hạ tầng (503/429) vẫn đi đường alert đỏ như trước.
type SearchOutcome =
  | { code: "PROPERTY_NOT_FOUND"; message: string }
  | { code: "NO_AVAILABILITY"; message: string; properties: PropertyDto[] };

const matchedProperties = (details: unknown): PropertyDto[] => {
  const properties = (details as NoAvailabilityDetails | undefined)?.properties;
  return Array.isArray(properties) ? properties : [];
};
const withRoomCapacity = (detail: RateDetailDto, room: RoomAvailabilityDto): RateDetailDto => ({
  ...detail, roomTypeCode: detail.roomTypeCode ?? room.roomTypeCode, maxOccupancy: room.maxOccupancy ?? detail.maxOccupancy,
});
function createInitialSearch(): SearchRequest {
  const arrival = new Date(); arrival.setDate(arrival.getDate() + 1);
  const departure = new Date(); departure.setDate(departure.getDate() + 3);
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { destination: "", arrivalDate: localDate(arrival), departureDate: localDate(departure), rooms: [{ adults: 2, children: 0, infants: 0 }] };
}

function Brand() {
  return <span className="brand"><span className="brand-mark" aria-hidden="true"><span>N</span><i /></span><span className="brand-copy"><strong>NT Travel</strong><small>Bedbank</small></span></span>;
}

function ErrorMessage({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><strong>Không thể hoàn tất yêu cầu</strong><span>{error}</span>{retry ? <button type="button" onClick={retry}>Thử lại</button> : null}</div>;
}

function Login({ onLogin, notice }: { onLogin: (profile: Profile) => void; notice?: string }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { onLogin(await bedbankApi.login(email, password)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đăng nhập"); } finally { setBusy(false); } };
  return <main className="auth-page"><section className="auth-card"><Brand /><p className="eyebrow">Cổng nội bộ</p><h1>Đăng nhập Bedbank</h1><p>Truy cập tồn phòng và giá net dành cho nhân viên NT Travel.</p>{notice ? <p className="form-error" role="alert">{notice}</p> : null}<form onSubmit={submit}>
    <label>Email<input aria-label="Email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label>Mật khẩu<input aria-label="Mật khẩu" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}<button className="search-button" disabled={busy}>{busy ? "Đang xác thực…" : "Đăng nhập"}</button>
  </form></section></main>;
}

function ChangePassword({ profile, onDone }: { profile: Profile; onDone: (profile: Profile) => void }) {
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (password !== confirm) { setError("Hai mật khẩu chưa khớp"); return; } setBusy(true); setError(""); try { await bedbankApi.changePassword(password); onDone({ ...profile, mustChangePassword: false }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đổi mật khẩu"); } finally { setBusy(false); } };
  return <main className="auth-page"><section className="auth-card"><Brand /><p className="eyebrow">Bảo mật tài khoản</p><h1>Đổi mật khẩu tạm</h1><p>Tạo mật khẩu riêng có ít nhất 12 ký tự để tiếp tục.</p><form onSubmit={submit}>
    <label>Mật khẩu mới<input aria-label="Mật khẩu mới" type="password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <label>Xác nhận mật khẩu<input aria-label="Xác nhận mật khẩu" type="password" minLength={12} required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}<button className="search-button" disabled={busy}>{busy ? "Đang lưu…" : "Đổi mật khẩu"}</button>
  </form></section></main>;
}

function Header({ profile, view, onView, onLogout }: { profile: Profile; view: View; onView: (view: View) => void; onLogout: () => void }) {
  return <header className="app-header"><div className="header-inner"><button type="button" className="brand-button" onClick={() => onView("search")} aria-label="Về trang tìm kiếm"><Brand /></button><nav className="desktop-nav" aria-label="Điều hướng chính"><button type="button" className="nav-link" data-active={view === "search"} onClick={() => onView("search")}>Tìm phòng</button><button type="button" className="nav-link" data-active={["bookings", "booking", "checkout"].includes(view)} onClick={() => onView("bookings")}>Đặt phòng của tôi</button>{profile.role === "admin" ? <button type="button" className="nav-link" data-active={view === "users"} onClick={() => onView("users")}><UserCog size={16} /> Nhân viên</button> : null}</nav><div className="header-actions"><span className="staff-menu"><span className="staff-avatar">{profile.displayName.slice(0, 2).toLocaleUpperCase("vi")}</span><span className="staff-copy"><strong>{profile.displayName}</strong><small>{profile.role === "admin" ? "Admin" : "Staff"}</small></span></span><button className="icon-button" type="button" onClick={onLogout} aria-label="Đăng xuất"><LogOut size={18} /></button></div></div></header>;
}

const money = (value: number, currency: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
// CloudHMS không trả thuế ở mọi rate plan; "—" khác hẳn "0 ₫" về nghĩa với nhân viên bán hàng.
const moneyOrDash = (value: number | undefined, currency: string) => value === undefined ? "—" : money(value, currency);
const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

function RateDetail({ detail, nights, close, onBook, canBook, bookLabel }: { detail: RateDetailDto; nights: number; close: () => void; onBook: () => void; canBook: boolean; bookLabel: string }) {
  return <aside className="booking-summary detail-panel" aria-labelledby="detail-title"><div className="summary-head"><div><p>Giá và chính sách đặt phòng</p><h2 id="detail-title">Chi tiết giá net</h2></div><button type="button" onClick={close} aria-label="Đóng chi tiết"><X size={19} /></button></div><dl><div><dt>Hạng phòng</dt><dd>{detail.roomTypeName}</dd></div>{detail.allotmentName ? <div><dt>Allotment</dt><dd>{detail.allotmentName}</dd></div> : null}<div><dt>Chương trình giá</dt><dd>{detail.ratePlanName}</dd></div><div><dt>Còn lại</dt><dd>{detail.quantity} phòng</dd></div><div><dt>Thuế / đêm</dt><dd>{moneyOrDash(detail.tax === undefined ? undefined : detail.tax / nights, detail.currency)}</dd></div><div className="summary-total"><dt>Giá net / phòng / đêm</dt><dd>{money(detail.total / nights, detail.currency)}</dd></div><div><dt>Tổng {nights} đêm / phòng</dt><dd>{money(detail.total, detail.currency)}</dd></div></dl>{detail.tax === undefined ? <p className="summary-note">CloudHMS không trả dữ liệu thuế cho hạng phòng này.</p> : null}<h3>Giá từng ngày</h3><ul className="daily-rates">{detail.dailyRates.map((rate) => <li key={rate.date}><span>{dateLabel(rate.date)}</span><strong>{money(rate.amount, detail.currency)}</strong></li>)}</ul><h3>Chính sách</h3><ul className="policy-list">{detail.policies.map((policy) => <li key={`${policy.type}-${policy.description}`}><strong>{policy.type}</strong><span>{policy.description}</span></li>)}</ul><button type="button" className="continue-button" disabled={!canBook} onClick={onBook}>{bookLabel}</button><p className="summary-note"><ShieldCheck size={15} /> Giá được kiểm tra lại khi tạo đặt phòng.</p></aside>;
}

// Combobox tự dựng thay cho `<datalist>`: trình duyệt tự lọc option của datalist theo chuỗi
// đang gõ, nên gợi ý mờ ("vinpearl" → "Vinpear Discovery") bị ẩn dù API đã trả về. Listbox này
// hiển thị đúng những gì API trả, kèm bàn phím và ARIA theo pattern combobox.
const SUGGESTION_LIST_ID = "property-suggestions";
const suggestionOptionId = (index: number) => `${SUGGESTION_LIST_ID}-option-${index}`;

function DestinationField({ value, suggestions, failed, onChange, onSelect }: {
  value: string;
  suggestions: PropertyDto[];
  failed: boolean;
  onChange: (value: string) => void;
  onSelect: (property: PropertyDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const expanded = open && suggestions.length > 0;
  const close = () => { setOpen(false); setActive(-1); };
  const commit = (property: PropertyDto) => { onSelect(property); close(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
      return;
    }
    // Enter khi đang chọn gợi ý phải nhận gợi ý, không submit luôn cả form tìm kiếm.
    if (event.key === "Enter" && expanded && active >= 0) { event.preventDefault(); commit(suggestions[active]!); return; }
    if (event.key === "Escape" && expanded) { event.preventDefault(); close(); }
  };
  return <div className="field field-destination">
    <label htmlFor="destination">Điểm đến hoặc khách sạn</label>
    <div className="field-control"><Hotel size={18} />
      <input id="destination" role="combobox" aria-expanded={expanded} aria-controls={SUGGESTION_LIST_ID} aria-autocomplete="list"
        {...(expanded && active >= 0 ? { "aria-activedescendant": suggestionOptionId(active) } : {})}
        autoComplete="off" required value={value} placeholder="Nha Trang, Phú Quốc…"
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)} onBlur={close} onKeyDown={onKeyDown} />
    </div>
    <ul className="suggestion-list" id={SUGGESTION_LIST_ID} role="listbox" aria-label="Khách sạn gợi ý" hidden={!expanded}>
      {suggestions.map((property, index) => <li key={property.id} id={suggestionOptionId(index)} role="option" aria-selected={index === active} data-active={index === active}
        // mousedown thay vì click: blur của input chạy trước click và sẽ đóng danh sách.
        onMouseDown={(event) => { event.preventDefault(); commit(property); }}>
        <strong>{property.name}</strong>{property.city ? <span>{property.city}</span> : null}
      </li>)}
    </ul>
    {failed ? <p className="field-hint" role="status">Chưa tải được gợi ý. Bạn vẫn có thể bấm “Tìm khách sạn”.</p> : null}
  </div>;
}

function SearchView({ onBook }: { onBook: (selection: BookingSelection) => void }) {
  const [filters, setFilters] = useState<AvailabilityFilters>(EMPTY_FILTERS);
  const [selectionExpanded, setSelectionExpanded] = useState(false);
  const [form, setForm] = useState(createInitialSearch); const [suggestions, setSuggestions] = useState<PropertyDto[]>([]); const [suggestFailed, setSuggestFailed] = useState(false); const [hotels, setHotels] = useState<HotelAvailabilityDto[] | null>(null); const [rooms, setRooms] = useState<RoomAvailabilityDto[]>([]); const [selectedHotel, setSelectedHotel] = useState<string>(); const [detail, setDetail] = useState<RateDetailDto>(); const [chosen, setChosen] = useState<ChosenRate[]>([]); const [busy, setBusy] = useState<"hotels" | "rooms" | "detail">(); const [error, setError] = useState(""); const [outcome, setOutcome] = useState<SearchOutcome>();
  const generation = useRef(0);
  const arrivalRef = useRef<HTMLInputElement>(null);
  const submittedSearch = useRef<SearchRequest | undefined>(undefined);
  useEffect(() => () => { generation.current += 1; }, []);
  // Search quotes use a reference occupancy; final guests are assigned per room at checkout.
  const request = (): SearchRequest => ({ ...form, destination: form.destination.trim(), rooms: [{ ...form.rooms[0]! }] });
  useEffect(() => {
    if (form.destination.trim().length < 2) { setSuggestions([]); return; }
    let active = true;
    // Lỗi gợi ý trước đây bị nuốt: 401/503 hiện ra y như "không có khách sạn nào".
    const timer = window.setTimeout(() => {
      bedbankApi.properties(form.destination)
        .then((value) => { if (active) { setSuggestions(value); setSuggestFailed(false); } })
        .catch(() => { if (active) { setSuggestions([]); setSuggestFailed(true); } });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form.destination]);
  const searchHotels = async () => {
    const version = ++generation.current;
    const search = request();
    setBusy("hotels"); setError(""); setOutcome(undefined); setHotels(null); setRooms([]); setDetail(undefined); setChosen([]); setSelectedHotel(undefined);
    try { const result = await bedbankApi.hotels({ ...search, rooms: [search.rooms[0]!] }); if (version === generation.current) { submittedSearch.current = search; setHotels(result); } }
    catch (reason) {
      if (version !== generation.current) return;
      if (reason instanceof ApiError && reason.code === "PROPERTY_NOT_FOUND") setOutcome({ code: reason.code, message: reason.message });
      else if (reason instanceof ApiError && reason.code === "NO_AVAILABILITY") setOutcome({ code: reason.code, message: reason.message, properties: matchedProperties(reason.details) });
      else setError(reason instanceof Error ? reason.message : "Không thể tìm khách sạn");
    }
    finally { if (version === generation.current) setBusy(undefined); }
  };
  const searchRooms = async (propertyId: string) => {
    const search = submittedSearch.current;
    if (!search) return;
    const version = ++generation.current;
    setBusy("rooms"); setError(""); setRooms([]); setSelectedHotel(propertyId); setDetail(undefined); setChosen([]);
    try { const result = await bedbankApi.rooms({ ...search, rooms: [search.rooms[0]!], propertyId }); if (version === generation.current) setRooms(result); }
    catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : "Không thể tải hạng phòng"); }
    finally { if (version === generation.current) setBusy(undefined); }
  };
  const startBooking = (rate: RateDetailDto) => {
    const search = submittedSearch.current;
    if (!search || rate.quantity < 1) return;
    onBook({ requestId: crypto.randomUUID(), search, detail: rate, items: [{ detail: rate, quantity: 1 }], propertyName: hotels?.find((hotel) => hotel.id === rate.propertyId)?.name ?? search.destination });
  };
  const chosenCount = chosen.reduce((sum, item) => sum + item.quantity, 0);
  const chooseRate = async (room: RoomAvailabilityDto) => {
    const search = submittedSearch.current;
    if (!search) return;
    const index = chosen.findIndex((item) => sameRate(item.detail, room));
    if (index >= 0) { setChosen((current) => current.filter((_, position) => position !== index)); return; }
    if (chosenCount >= MAX_BOOKING_ROOMS) return;
    const version = ++generation.current;
    setBusy("detail"); setError("");
    try {
      const result = await bedbankApi.detail({ ...search, rooms: [search.rooms[0]!], propertyId: room.propertyId, roomTypeId: room.roomTypeId, ratePlanId: room.ratePlanId, allotmentId: room.allotmentId });
      if (result.propertyId !== room.propertyId || !sameRate(result, room)) throw new Error("Giá trả về không đúng phòng, allotment hoặc chương trình đã chọn. Vui lòng tìm lại phòng.");
      if (result.quantity < 1) throw new Error("Chương trình đã hết phòng. Vui lòng chọn giá khác.");
      if (version === generation.current) {
        if (chosen.length > 0 && result.currency !== chosen[0]!.detail.currency) setError("Không thể gộp các hạng phòng khác loại tiền tệ trong cùng booking.");
        else setChosen((current) => [...current, { detail: withRoomCapacity(result, room), quantity: 1 }]);
      }
    } catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : "Không thể tải chi tiết giá"); }
    finally { if (version === generation.current) setBusy(undefined); }
  };
  const updateChosenQuantity = (room: RoomAvailabilityDto, quantity: number) => {
    const other = chosenCount - (chosen.find((item) => sameRate(item.detail, room))?.quantity ?? 0);
    const selected = chosen.find((item) => sameRate(item.detail, room));
    if (!selected || !Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(room.quantity, selected.detail.quantity) || quantity + other > MAX_BOOKING_ROOMS) return;
    setChosen((current) => current.map((item) => sameRate(item.detail, room) ? { ...item, quantity } : item));
  };
  const continueChosen = () => {
    const search = submittedSearch.current;
    if (!search || chosenCount < 1 || chosenCount > MAX_BOOKING_ROOMS) return;
    const first = chosen[0]!.detail;
    const bookingSearch = { ...search, rooms: Array.from({ length: chosenCount }, () => ({ ...search.rooms[0]! })) };
    onBook({ requestId: crypto.randomUUID(), search: bookingSearch, detail: first, items: chosen, propertyName: hotels?.find((hotel) => hotel.id === first.propertyId)?.name ?? search.destination });
  };
  const loadDetail = async (room: RoomAvailabilityDto, book = false) => {
    const search = submittedSearch.current;
    if (!search) return;
    const version = ++generation.current;
    setBusy("detail"); setError("");
    try {
      const result = await bedbankApi.detail({ ...search, rooms: [search.rooms[0]!], propertyId: room.propertyId, roomTypeId: room.roomTypeId, ratePlanId: room.ratePlanId, allotmentId: room.allotmentId });
      if (result.propertyId !== room.propertyId || !sameRate(result, room)) throw new Error("Giá trả về không đúng phòng, allotment hoặc chương trình đã chọn. Vui lòng tìm lại phòng.");
      if (version === generation.current) { const rated = withRoomCapacity(result, room); setDetail(rated); if (book) startBooking(rated); }
    } catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : "Không thể tải chi tiết giá"); }
    finally { if (version === generation.current) setBusy(undefined); }
  };
  const update = (key: "destination" | "arrivalDate" | "departureDate", value: string) => {
    generation.current += 1; submittedSearch.current = undefined;
    setBusy(undefined); setHotels(null); setRooms([]); setDetail(undefined); setChosen([]); setSelectedHotel(undefined); setError(""); setOutcome(undefined);
    setForm((current) => ({ ...current, [key]: value }));
    setFilters(EMPTY_FILTERS);
  };
  const changeFilters = (value: AvailabilityFilters) => { setFilters(value); setChosen([]); setDetail(undefined); };
  const nights = Math.max(1, (Date.parse(form.departureDate) - Date.parse(form.arrivalDate)) / 86_400_000) || 1;
  const visibleHotels = filterHotels(hotels ?? [], filters, nights);
  const visibleRooms = rooms.filter((room) => matchesRate(room, filters, nights, hotels?.find((hotel) => hotel.id === room.propertyId)?.services));
  return <><section className="search-shell" aria-labelledby="search-title"><h1 id="search-title" className="visually-hidden">Tìm phòng</h1><form className="search-form" onSubmit={(event) => { event.preventDefault(); void searchHotels(); }}>
    <DestinationField value={form.destination} suggestions={suggestions} failed={suggestFailed} onChange={(value) => update("destination", value)} onSelect={(property) => update("destination", property.name)} />
    <fieldset className="field field-dates"><legend>Nhận phòng – Trả phòng</legend><div className="field-control date-range-control"><CalendarDays size={18} aria-hidden="true" /><input id="arrival" ref={arrivalRef} aria-label="Ngày nhận phòng" type="date" required value={form.arrivalDate} onChange={(event) => update("arrivalDate", event.target.value)} /><span aria-hidden="true">→</span><input id="departure" aria-label="Ngày trả phòng" type="date" required min={form.arrivalDate} value={form.departureDate} onChange={(event) => update("departureDate", event.target.value)} /></div></fieldset>
    <button className="search-button" type="submit" disabled={Boolean(busy)}><Search size={19} />{busy === "hotels" ? "Đang tìm…" : "Tìm khách sạn"}</button>
    <div className="search-refinements"><SearchFilters hotels={hotels ?? []} value={filters} disabled={Boolean(busy)} onChange={changeFilters} />
    </div>
  </form></section><main className="content-grid" id="main-content" data-has-room-selection={Boolean(selectedHotel && rooms.length > 0)} data-has-chosen={chosen.length > 0}>
    <section className="results" aria-live="polite">{error ? <ErrorMessage error={error} retry={() => void searchHotels()} /> : null}{busy && busy !== "hotels" ? <div className="loading-state">Đang tải dữ liệu CloudHMS…</div> : null}{hotels === null && !busy && !outcome && !error ? <div className="empty-state"><div className="empty-art"><Hotel size={34} /></div><h2>Bắt đầu từ một điểm đến.</h2><p>Tìm theo thành phố hoặc tên khách sạn để xem phòng, rate plan và giá net.</p></div> : null}{outcome?.code === "PROPERTY_NOT_FOUND" ? <div className="empty-state"><div className="empty-art"><Hotel size={34} /></div><h2>Không tìm thấy khách sạn nào.</h2><p>{outcome.message}</p><p>Thử tên ngắn hơn hoặc bỏ bớt từ, ví dụ “vinpearl hue” thay cho tên đầy đủ.</p></div> : null}{outcome?.code === "NO_AVAILABILITY" ? <div className="empty-state"><h2>Không còn phòng cho ngày đã chọn.</h2><p>{outcome.message}</p>{outcome.properties.length > 0 ? <ul className="matched-properties" aria-label="Khách sạn khớp tên">{outcome.properties.map((property) => <li key={property.id}><strong>{property.name}</strong>{property.city ? <span>{property.city}</span> : null}</li>)}</ul> : null}<button type="button" className="select-room" onClick={() => arrivalRef.current?.focus()}>Đổi ngày</button></div> : null}{hotels?.length === 0 ? <div className="empty-state"><h2>Không còn phòng phù hợp.</h2><p>Thử đổi ngày lưu trú, số khách hoặc điểm đến.</p></div> : null}{hotels && hotels.length > 0 ? <>
      <div className="results-heading"><div><h2>{visibleHotels.length} khách sạn còn phòng</h2><p>{form.destination} · {dateLabel(form.arrivalDate)} → {dateLabel(form.departureDate)}{hasFilters(filters) ? ` · Đang lọc từ ${hotels.length} kết quả` : ""}</p></div></div>
      {visibleHotels.length === 0 ? <div className="empty-state"><h3>Không có kết quả phù hợp bộ lọc.</h3><p>Thử thay đổi tiêu chí hoặc bỏ lọc để xem tất cả phòng còn trống.</p></div> : null}
      <div className="hotel-list">{visibleHotels.map((hotel) => <article className="hotel-card" key={hotel.id}>
        <div className="hotel-main">
          <div className="hotel-overview">
            <div className="hotel-heading"><div><p>{[hotel.city, hotel.propertyType, hotel.starRating ? `${hotel.starRating} sao` : undefined].filter(Boolean).join(" · ")}</p><h3>{hotel.name}</h3></div><span className="availability-badge">Tồn theo hạng phòng</span></div>
            <div className="hotel-offer"><div className="hotel-rate"><span>Từ / phòng / đêm</span><strong>{money(hotel.fromPrice / nights, hotel.currency)}</strong></div>
              <button className="select-room" type="button" disabled={Boolean(busy)} onClick={() => void searchRooms(hotel.id)} aria-label={`Xem phòng tại ${hotel.name}`}>Xem hạng phòng</button></div>
          </div>
          {selectedHotel === hotel.id && !busy && rooms.length === 0 ? <p className="inline-empty" role="status">Khách sạn này chưa có hạng phòng khả dụng cho tiêu chí đã chọn.</p> : null}
          {selectedHotel === hotel.id && rooms.length > 0 && visibleRooms.length === 0 ? <p className="inline-empty" role="status">Không có chương trình phù hợp bộ lọc. Hãy thay đổi tiêu chí hoặc bỏ lọc.</p> : null}
          {selectedHotel === hotel.id && visibleRooms.length > 0 ? <RoomRateTable hotelName={hotel.name} nights={nights} rooms={visibleRooms} chosen={chosen} busy={Boolean(busy)}
            onDetail={(room) => void loadDetail(room)} onChoose={(room) => void chooseRate(room)} onQuantity={updateChosenQuantity} onQuickBook={(room) => void loadDetail(room, true)} /> : null}
          {selectedHotel === hotel.id && detail ? <RateDetail detail={detail} nights={nights} close={() => setDetail(undefined)} canBook={chosen.length > 0 || detail.quantity > 0}
            bookLabel="Tiếp tục đặt phòng"
            onBook={() => chosen.length > 0 ? continueChosen() : startBooking(detail)} /> : null}
        </div>
      </article>)}</div>
    </> : null}</section>
    {selectedHotel && rooms.length > 0 ? <aside className="selection-sidebar" aria-labelledby="selection-title" data-empty={chosen.length === 0} data-expanded={selectionExpanded}>
      <div className="selection-heading"><div><h2 id="selection-title">Hạng phòng đã chọn</h2><span>{chosenCount} phòng</span></div><button className="selection-toggle" type="button" aria-label="Xem phòng đã chọn" aria-expanded={selectionExpanded} aria-controls="selected-room-items" onClick={() => setSelectionExpanded((current) => !current)}><ChevronDown size={18} aria-hidden="true" /></button></div>
      <div className="selection-items" id="selected-room-items">{chosen.length > 0 ? <ul>{chosen.map((item) => <li key={rateKey(item.detail)}>
        <div className="chosen-room-heading"><h3>{item.detail.roomTypeName}</h3><button className="icon-button" type="button" aria-label={`Bỏ chọn ${item.detail.roomTypeName} · ${item.detail.allotmentName ?? ""} · ${item.detail.ratePlanName}`} disabled={Boolean(busy)} onClick={() => void chooseRate(item.detail)}><X size={16} aria-hidden="true" /></button></div>
        {item.detail.allotmentName ? <span className="chosen-allotment">{item.detail.allotmentName}</span> : null}<span className="chosen-program">{item.detail.ratePlanName}</span>
        <div className="chosen-room-line">{item.detail.allotmentId ? <label className="room-quantity">Số phòng<input aria-label={`Số phòng ${item.detail.roomTypeName} · ${item.detail.allotmentName ?? item.detail.allotmentId} · ${item.detail.ratePlanName}`} type="number" min={1} max={Math.min(item.detail.quantity, MAX_BOOKING_ROOMS - chosenCount + item.quantity)} value={item.quantity} disabled={Boolean(busy)} onChange={(event) => { const room = rooms.find((rate) => sameRate(rate, item.detail)); if (room) updateChosenQuantity(room, Number(event.target.value)); }} /></label> : <span>{item.quantity} phòng</span>}<strong>{money(item.quantity * item.detail.total, item.detail.currency)}</strong></div>
      </li>)}</ul> : <p className="selection-empty">Chọn giá trong bảng để thêm phòng.</p>}</div>
      <div className="selection-footer"><p><span>Tổng giá net</span><strong>{chosen.length > 0 ? money(chosen.reduce((sum, item) => sum + item.detail.total * item.quantity, 0), chosen[0]!.detail.currency) : "—"}</strong></p><button type="button" className="select-room" disabled={Boolean(busy) || chosenCount < 1} onClick={continueChosen}>Tiếp tục với {chosenCount} phòng</button></div>
    </aside> : null}
  </main></>;
}

function UsersView() {
  const [users, setUsers] = useState<Profile[]>([]); const [error, setError] = useState(""); const [showCreate, setShowCreate] = useState(false); const [form, setForm] = useState({ email: "", displayName: "", role: "staff" as "admin" | "staff", temporaryPassword: "" }); const [resetUser, setResetUser] = useState<Profile>(); const [resetPassword, setResetPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); return bedbankApi.users().then(setUsers).catch((reason) => setError(reason instanceof Error ? reason.message : "Không thể tải nhân viên")).finally(() => setLoading(false)); }; useEffect(() => { void load(); }, []);
  const create = async (event: FormEvent) => { event.preventDefault(); setError(""); try { const user = await bedbankApi.createUser(form); setUsers((current) => [...current, user]); setShowCreate(false); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể tạo nhân viên"); } };
  const update = async (user: Profile, input: Record<string, string>) => { setError(""); try { const changed = await bedbankApi.updateUser(user.userId, input); setUsers((current) => current.map((item) => item.userId === changed.userId ? changed : item)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể cập nhật nhân viên"); } };
  const reset = async (event: FormEvent) => { event.preventDefault(); if (!resetUser) return; setError(""); try { await bedbankApi.resetPassword(resetUser.userId, resetPassword); setUsers((current) => current.map((item) => item.userId === resetUser.userId ? { ...item, mustChangePassword: true } : item)); setResetUser(undefined); setResetPassword(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đặt lại mật khẩu"); } };
  return <main className="module-page" id="main-content"><div className="module-heading"><div><p>Quyền truy cập nội bộ</p><h1>Quản lý nhân viên</h1><span>Tạo tài khoản tạm, phân quyền và khóa quyền truy cập.</span></div><button type="button" onClick={() => setShowCreate((value) => !value)}>Thêm nhân viên</button></div>{error ? <ErrorMessage error={error} retry={load} /> : null}{showCreate ? <form className="user-create" onSubmit={create}><label>Họ tên<input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>Email<input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Vai trò<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "admin" | "staff" })}><option value="staff">Staff</option><option value="admin">Admin</option></select></label><label>Mật khẩu tạm<input type="password" minLength={12} required value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} /></label><button className="search-button">Tạo tài khoản</button></form> : null}{resetUser ? <form className="password-reset" onSubmit={reset}><div><strong>Đặt lại mật khẩu cho {resetUser.displayName}</strong><span>Nhân viên sẽ phải đổi mật khẩu ở lần đăng nhập kế tiếp.</span></div><label>Mật khẩu tạm mới<input aria-label="Mật khẩu tạm mới" type="password" minLength={12} required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label><button className="search-button">Xác nhận đặt lại</button><button type="button" onClick={() => setResetUser(undefined)}>Hủy</button></form> : null}{loading ? <div className="loading-state" role="status">Đang tải danh sách nhân viên…</div> : null}{!loading && !error && users.length === 0 ? <div className="empty-state"><h2>Chưa có nhân viên nào.</h2><p>Thêm tài khoản đầu tiên để cấp quyền truy cập hệ thống.</p></div> : null}<section className="user-list" aria-label="Danh sách nhân viên">{users.map((user) => <article className="user-row" key={user.userId}><div><strong>{user.displayName}</strong><span>{user.email}</span></div><select aria-label={`Vai trò của ${user.displayName}`} value={user.role} onChange={(event) => void update(user, { role: event.target.value })}><option value="staff">Staff</option><option value="admin">Admin</option></select><span className="status" data-pending={user.status === "disabled"}>{user.status === "active" ? "Đang hoạt động" : "Đã khóa"}</span><div className="user-actions"><button type="button" onClick={() => void update(user, { status: user.status === "active" ? "disabled" : "active" })}>{user.status === "active" ? "Khóa" : "Mở khóa"}</button><button type="button" aria-label={`Đặt lại mật khẩu cho ${user.displayName}`} onClick={() => setResetUser(user)}>Đặt lại mật khẩu</button></div></article>)}</section></main>;
}

export default function App() {
  const [selection, setSelection] = useState<BookingSelection>(); const [booking, setBooking] = useState<BookingDto>();
  const [editingDraftId, setEditingDraftId] = useState<string>();
  const [drafts, setDrafts] = useState<BookingSelection[]>([]);
  const [draftFields, setDraftFields] = useState<Record<string, BookingDraftFields>>({});
  const [draftsReadyFor, setDraftsReadyFor] = useState<string>();
  const [profile, setProfile] = useState<Profile | null>(); const [view, setView] = useState<View>("search"); const [sessionError, setSessionError] = useState("");
  const currentUserId = useRef<string | undefined>(undefined);
  currentUserId.current = profile?.userId;
  // 401 nghĩa là chưa đăng nhập; mọi lỗi khác là sự cố hệ thống và phải nói rõ, nếu không
  // nhân viên sẽ nhập lại mật khẩu đúng nhiều lần mà không hiểu vì sao vẫn hỏng.
  useEffect(() => { bedbankApi.me().then(setProfile).catch((error) => { if (!(error instanceof ApiError) || error.status !== 401) setSessionError(error instanceof Error ? error.message : "Không thể kiểm tra phiên đăng nhập"); setProfile(null); }); }, []);
  useEffect(() => {
    if (!profile?.userId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`nt-journey-drafts:${profile.userId}`) ?? "{}") as { legs?: BookingSelection[]; fields?: Record<string, BookingDraftFields> };
      setDrafts(Array.isArray(saved.legs) ? saved.legs : []);
      setDraftFields(saved.fields && typeof saved.fields === "object" ? saved.fields : {});
    } catch { setDrafts([]); setDraftFields({}); }
    setDraftsReadyFor(profile.userId);
  }, [profile?.userId]);
  useEffect(() => {
    if (!profile?.userId || draftsReadyFor !== profile.userId) return;
    try { localStorage.setItem(`nt-journey-drafts:${profile.userId}`, JSON.stringify({ legs: drafts, fields: draftFields })); } catch { /* Booking vẫn dùng được trong phiên hiện tại. */ }
  }, [profile?.userId, draftsReadyFor, drafts, draftFields]);
  if (profile === undefined) return <main className="auth-page"><div className="loading-state" role="status">Đang kiểm tra phiên đăng nhập…</div></main>;
  if (profile === null) return <Login onLogin={setProfile} notice={sessionError} />;
  if (profile.mustChangePassword) return <ChangePassword profile={profile} onDone={setProfile} />;
  const logout = async () => { try { await bedbankApi.logout(); } finally { try { localStorage.removeItem(`nt-journey-drafts:${profile.userId}`); } catch { /* Bộ nhớ trình duyệt có thể bị khóa. */ } setProfile(null); setSelection(undefined); setBooking(undefined); setEditingDraftId(undefined); setDrafts([]); setDraftFields({}); setDraftsReadyFor(undefined); setView("search"); } };
  const openDraft = (draft: BookingSelection) => {
    setSelection(draft); setEditingDraftId(undefined);
    setDraftFields((current) => current[draft.requestId] ? current : { ...current, [draft.requestId]: {} });
    setView("checkout");
  };
  const beginBooking = (value: BookingSelection) => {
    if (editingDraftId) setDraftFields((current) => { const updated = { ...current }; delete updated[editingDraftId]; return updated; });
    setDrafts((current) => [...current.filter((draft) => draft.requestId !== editingDraftId && draft.requestId !== value.requestId), value]);
    setSelection(value); setEditingDraftId(undefined); setView("checkout");
  };
  return <div className="app-shell"><a className="skip-link" href="#main-content">Bỏ qua điều hướng</a><Header profile={profile} view={view} onView={(next) => { if (next === "search") setEditingDraftId(undefined); setView(next); }} onLogout={() => void logout()} />{view === "search" ? <SearchView onBook={beginBooking} /> : null}
    {view === "users" && profile.role === "admin" ? <UsersView /> : null}
    {view === "checkout" && selection ? <BookingCheckout key={selection.requestId} selection={selection}
      initialDraft={draftFields[selection.requestId]} onDraftChange={(draft) => {
        if (currentUserId.current !== profile.userId) return;
        setDraftFields((current) => ({ ...current, [selection.requestId]: draft }));
        if (draft.dates) setDrafts((current) => current.map((item) => item.requestId === selection.requestId ? { ...item, search: { ...item.search, ...draft.dates } } : item));
      }}
      onBack={() => { setEditingDraftId(selection.requestId); setView("search"); }}
      onCreated={(value) => { if (currentUserId.current !== profile.userId) return;
        setDrafts((current) => current.filter((draft) => draft.requestId !== value.id));
        setDraftFields((current) => { const next = { ...current }; delete next[value.id]; return next; });
        setBooking(value); setSelection(undefined); setView("booking"); }} /> : null}
    {view === "booking" && booking ? <BookingDetails key={booking.id} initial={booking} onBack={() => setView("bookings")} /> : null}
    {view === "bookings" ? <BookingsList drafts={drafts} onOpenDraft={openDraft} onSearch={() => { setEditingDraftId(undefined); setView("search"); }} onSelect={(value) => { setBooking(value); setView("booking"); }} /> : null}<footer className="foot-line"><span>NT Travel Bedbank</span><span>Tìm phòng & đặt phòng · CiHMS</span><span>Hỗ trợ vận hành</span></footer></div>;
}
