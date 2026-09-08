import { useEffect, useRef, useState, type FormEvent } from "react";
import { BedDouble, CalendarDays, Check, Hotel, LogOut, Search, ShieldCheck, UserCog, UsersRound, X } from "lucide-react";
import type { BookingDto, HotelAvailabilityDto, Profile, PropertyDto, RateDetailDto, RoomAvailabilityDto, SearchRequest } from "../shared/contracts";
import { ApiError, bedbankApi } from "./api";
import { BookingCheckout, BookingDetails, BookingsList, type BookingSelection } from "./Booking";

type View = "search" | "users" | "bookings" | "checkout" | "booking";
type SearchState = SearchRequest & { roomCount: number; adults: number; children: number; infants: number };
function createInitialSearch(): SearchState {
  const arrival = new Date(); arrival.setDate(arrival.getDate() + 1);
  const departure = new Date(); departure.setDate(departure.getDate() + 3);
  const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { destination: "", arrivalDate: localDate(arrival), departureDate: localDate(departure), roomCount: 1, adults: 2, children: 0, infants: 0, rooms: [{ adults: 2, children: 0, infants: 0 }] };
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

function RateDetail({ detail, close, onBook }: { detail: RateDetailDto; close: () => void; onBook: () => void }) {
  return <aside className="booking-summary detail-panel" aria-labelledby="detail-title"><div className="summary-head"><div><p>Giá và chính sách đặt phòng</p><h2 id="detail-title">Chi tiết giá net</h2></div><button type="button" onClick={close} aria-label="Đóng chi tiết"><X size={19} /></button></div><dl><div><dt>Hạng phòng</dt><dd>{detail.roomTypeName}</dd></div><div><dt>Rate plan</dt><dd>{detail.ratePlanName}</dd></div><div><dt>Còn lại</dt><dd>{detail.quantity} phòng</dd></div><div><dt>Thuế</dt><dd>{moneyOrDash(detail.tax, detail.currency)}</dd></div><div className="summary-total"><dt>Tổng giá net</dt><dd>{money(detail.total, detail.currency)}</dd></div></dl>{detail.tax === undefined ? <p className="summary-note">CloudHMS không trả dữ liệu thuế cho hạng phòng này.</p> : null}<h3>Giá từng ngày</h3><ul className="daily-rates">{detail.dailyRates.map((rate) => <li key={rate.date}><span>{dateLabel(rate.date)}</span><strong>{money(rate.amount, detail.currency)}</strong></li>)}</ul><h3>Chính sách</h3><ul className="policy-list">{detail.policies.map((policy) => <li key={`${policy.type}-${policy.description}`}><strong>{policy.type}</strong><span>{policy.description}</span></li>)}</ul><button type="button" className="continue-button" onClick={onBook}>Tiếp tục đặt phòng</button><p className="summary-note"><ShieldCheck size={15} /> Giá được kiểm tra lại khi tạo đặt phòng.</p></aside>;
}

function SearchView({ onBook }: { onBook: (selection: BookingSelection) => void }) {
  const [form, setForm] = useState(createInitialSearch); const [suggestions, setSuggestions] = useState<PropertyDto[]>([]); const [hotels, setHotels] = useState<HotelAvailabilityDto[] | null>(null); const [rooms, setRooms] = useState<RoomAvailabilityDto[]>([]); const [selectedHotel, setSelectedHotel] = useState<string>(); const [detail, setDetail] = useState<RateDetailDto>(); const [busy, setBusy] = useState<"hotels" | "rooms" | "detail">(); const [error, setError] = useState("");
  const generation = useRef(0);
  const submittedSearch = useRef<SearchRequest | undefined>(undefined);
  useEffect(() => () => { generation.current += 1; }, []);
  const request = (): SearchRequest => ({ destination: form.destination.trim(), arrivalDate: form.arrivalDate, departureDate: form.departureDate, rooms: Array.from({ length: form.roomCount }, () => ({ adults: form.adults, children: form.children, infants: form.infants })) });
  useEffect(() => {
    if (form.destination.trim().length < 2) { setSuggestions([]); return; }
    let active = true;
    const timer = window.setTimeout(() => { bedbankApi.properties(form.destination).then((value) => { if (active) setSuggestions(value); }).catch(() => { if (active) setSuggestions([]); }); }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form.destination]);
  const searchHotels = async () => {
    const version = ++generation.current;
    const search = request();
    setBusy("hotels"); setError(""); setHotels(null); setRooms([]); setDetail(undefined); setSelectedHotel(undefined);
    try { const result = await bedbankApi.hotels(search); if (version === generation.current) { submittedSearch.current = search; setHotels(result); } }
    catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : "Không thể tìm khách sạn"); }
    finally { if (version === generation.current) setBusy(undefined); }
  };
  const searchRooms = async (propertyId: string) => {
    const search = submittedSearch.current;
    if (!search) return;
    const version = ++generation.current;
    setBusy("rooms"); setError(""); setRooms([]); setSelectedHotel(propertyId); setDetail(undefined);
    try { const result = await bedbankApi.rooms({ ...search, propertyId }); if (version === generation.current) setRooms(result); }
    catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : "Không thể tải hạng phòng"); }
    finally { if (version === generation.current) setBusy(undefined); }
  };
  const startBooking = (rate: RateDetailDto) => {
    const search = submittedSearch.current;
    if (!search) return;
    onBook({ requestId: crypto.randomUUID(), search, detail: rate, propertyName: hotels?.find((hotel) => hotel.id === rate.propertyId)?.name ?? search.destination });
  };
  const loadDetail = async (room: RoomAvailabilityDto, book = false) => {
    const search = submittedSearch.current;
    if (!search) return;
    const version = ++generation.current;
    setBusy("detail"); setError("");
    try {
      const result = await bedbankApi.detail({ ...search, rooms: [search.rooms[0]!], propertyId: room.propertyId, roomTypeId: room.roomTypeId, ratePlanId: room.ratePlanId });
      if (version === generation.current) { setDetail(result); if (book) startBooking(result); }
    } catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : "Không thể tải chi tiết giá"); }
    finally { if (version === generation.current) setBusy(undefined); }
  };
  const update = (key: keyof SearchState, value: string | number) => {
    generation.current += 1; submittedSearch.current = undefined;
    setBusy(undefined); setHotels(null); setRooms([]); setDetail(undefined); setSelectedHotel(undefined); setError("");
    setForm((current) => ({ ...current, [key]: value }));
  };
  return <><section className="search-shell reveal" aria-labelledby="search-title"><div className="search-intro"><div><p className="staff-context"><span /> Dành cho nhân viên NT Travel</p><h1 id="search-title">Tìm kỳ nghỉ xứng tầm.</h1></div><p className="search-lede">Tồn phòng, giá net và chính sách lấy từ CloudHMS trên cùng một màn hình.</p></div><form className="search-form" onSubmit={(event) => { event.preventDefault(); void searchHotels(); }}>
    <div className="field field-destination"><label htmlFor="destination">Điểm đến hoặc khách sạn</label><div className="field-control"><Hotel size={18} /><input id="destination" list="property-suggestions" required value={form.destination} onChange={(event) => update("destination", event.target.value)} placeholder="Nha Trang, Phú Quốc…" /><datalist id="property-suggestions">{suggestions.map((property) => <option key={property.id} value={property.name}>{property.city}</option>)}</datalist></div></div>
    <div className="field"><label htmlFor="arrival">Nhận phòng</label><div className="field-control"><CalendarDays size={18} /><input id="arrival" aria-label="Ngày nhận phòng" type="date" required value={form.arrivalDate} onChange={(event) => update("arrivalDate", event.target.value)} /></div></div>
    <div className="field"><label htmlFor="departure">Trả phòng</label><div className="field-control"><CalendarDays size={18} /><input id="departure" aria-label="Ngày trả phòng" type="date" required min={form.arrivalDate} value={form.departureDate} onChange={(event) => update("departureDate", event.target.value)} /></div></div>
    <div className="field"><label htmlFor="adults">Người lớn / phòng</label><div className="field-control"><UsersRound size={18} /><input id="adults" aria-label="Người lớn mỗi phòng" type="number" min={1} max={8} value={form.adults} onChange={(event) => update("adults", Number(event.target.value))} /></div></div>
    <div className="field"><label htmlFor="children">Trẻ em / phòng</label><div className="field-control"><UsersRound size={18} /><input id="children" aria-label="Trẻ em mỗi phòng" type="number" min={0} max={6} value={form.children} onChange={(event) => update("children", Number(event.target.value))} /></div></div>
    <div className="field"><label htmlFor="infants">Em bé / phòng</label><div className="field-control"><UsersRound size={18} /><input id="infants" aria-label="Em bé mỗi phòng" type="number" min={0} max={4} value={form.infants} onChange={(event) => update("infants", Number(event.target.value))} /></div></div>
    <div className="field"><label htmlFor="rooms">Số phòng</label><div className="field-control"><BedDouble size={18} /><input id="rooms" aria-label="Số phòng" type="number" min={1} max={8} value={form.roomCount} onChange={(event) => update("roomCount", Number(event.target.value))} /></div></div>
    <button className="search-button" type="submit" disabled={Boolean(busy)}><Search size={19} />{busy === "hotels" ? "Đang tìm…" : "Tìm khách sạn"}</button>
  </form><div className="search-meta"><span><ShieldCheck size={16} /> Giá net, không markup</span><span><Check size={16} /> Availability gọi trực tiếp</span></div></section><main className="content-grid" id="main-content">
    <section className="results" aria-live="polite">{error ? <ErrorMessage error={error} retry={() => void searchHotels()} /> : null}{busy && busy !== "hotels" ? <div className="loading-state">Đang tải dữ liệu CloudHMS…</div> : null}{hotels === null && !busy ? <div className="empty-state"><div className="empty-art"><Hotel size={34} /></div><h2>Bắt đầu từ một điểm đến.</h2><p>Tìm theo thành phố hoặc tên khách sạn để xem phòng, rate plan và giá net.</p></div> : null}{hotels?.length === 0 ? <div className="empty-state"><h2>Không còn phòng phù hợp.</h2><p>Thử đổi ngày lưu trú, số khách hoặc điểm đến.</p></div> : null}{hotels && hotels.length > 0 ? <><div className="results-heading"><div><h2>{hotels.length} khách sạn còn phòng</h2><p>{form.destination} · {form.arrivalDate} → {form.departureDate}</p></div></div><div className="hotel-list">{hotels.map((hotel) => <article className="hotel-card" key={hotel.id}>{hotel.imageUrl ? <figure className="hotel-image"><img src={hotel.imageUrl} alt={`Không gian tại ${hotel.name}`} /></figure> : null}<div className="hotel-main"><div className="hotel-heading"><div><p>{hotel.city}</p><h3>{hotel.name}</h3></div><span className="availability-badge">Còn {hotel.quantity}</span></div><div className="hotel-rate"><span>Từ</span><strong>{money(hotel.fromPrice, hotel.currency)}</strong></div><button className="select-room" type="button" disabled={Boolean(busy)} onClick={() => void searchRooms(hotel.id)} aria-label={`Xem phòng tại ${hotel.name}`}>Xem hạng phòng</button>{selectedHotel === hotel.id && !busy && rooms.length === 0 ? <p className="inline-empty" role="status">Khách sạn này chưa có hạng phòng khả dụng cho tiêu chí đã chọn.</p> : null}{selectedHotel === hotel.id && rooms.length > 0 ? <div className="room-options">{rooms.map((room) => <article className="room-option" key={`${room.roomTypeId}-${room.ratePlanId}`}><div><h4>{room.roomTypeName}</h4><p>{room.ratePlanName} · Còn {room.quantity} phòng{room.maxOccupancy ? ` · Tối đa ${room.maxOccupancy} khách` : ""}</p></div><div className="rate-block"><small>Net toàn kỳ</small><strong>{money(room.total, room.currency)}</strong><span>{room.tax === undefined ? "Thuế: chưa có dữ liệu" : `Thuế ${money(room.tax, room.currency)}`}</span></div><div className="room-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void loadDetail(room)} aria-label={`Xem giá chi tiết ${room.roomTypeName}`}>Xem giá & chính sách</button><button type="button" className="select-room" disabled={Boolean(busy) || room.quantity < form.roomCount} onClick={() => void loadDetail(room, true)} aria-label={`Đặt phòng ${room.roomTypeName}`}>Đặt phòng</button></div></article>)}</div> : null}</div></article>)}</div></> : null}</section>{detail ? <RateDetail detail={detail} close={() => setDetail(undefined)} onBook={() => startBooking(detail)} /> : null}
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
  const [profile, setProfile] = useState<Profile | null>(); const [view, setView] = useState<View>("search"); const [sessionError, setSessionError] = useState("");
  const currentUserId = useRef<string | undefined>(undefined);
  currentUserId.current = profile?.userId;
  // 401 nghĩa là chưa đăng nhập; mọi lỗi khác là sự cố hệ thống và phải nói rõ, nếu không
  // nhân viên sẽ nhập lại mật khẩu đúng nhiều lần mà không hiểu vì sao vẫn hỏng.
  useEffect(() => { bedbankApi.me().then(setProfile).catch((error) => { if (!(error instanceof ApiError) || error.status !== 401) setSessionError(error instanceof Error ? error.message : "Không thể kiểm tra phiên đăng nhập"); setProfile(null); }); }, []);
  if (profile === undefined) return <main className="auth-page"><div className="loading-state" role="status">Đang kiểm tra phiên đăng nhập…</div></main>;
  if (profile === null) return <Login onLogin={setProfile} notice={sessionError} />;
  if (profile.mustChangePassword) return <ChangePassword profile={profile} onDone={setProfile} />;
  const logout = async () => { try { await bedbankApi.logout(); } finally { setProfile(null); setSelection(undefined); setBooking(undefined); setView("search"); } };
  return <div className="app-shell"><a className="skip-link" href="#main-content">Bỏ qua điều hướng</a><Header profile={profile} view={view} onView={setView} onLogout={() => void logout()} />{view === "search" ? <SearchView onBook={(value) => { setSelection(value); setView("checkout"); }} /> : null}
    {view === "users" && profile.role === "admin" ? <UsersView /> : null}
    {view === "checkout" && selection ? <BookingCheckout key={selection.requestId} selection={selection} onBack={() => setView("search")} onCreated={(value) => { if (currentUserId.current !== profile.userId) return; setBooking(value); setSelection(undefined); setView("booking"); }} /> : null}
    {view === "booking" && booking ? <BookingDetails key={booking.id} initial={booking} onBack={() => setView("bookings")} /> : null}
    {view === "bookings" ? <BookingsList onSearch={() => setView("search")} onSelect={(value) => { setBooking(value); setView("booking"); }} /> : null}<footer className="foot-line"><span>NT Travel Bedbank</span><span>Tìm phòng & đặt phòng · CiHMS</span><span>Hỗ trợ vận hành</span></footer></div>;
}
