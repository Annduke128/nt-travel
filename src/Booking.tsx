import { useEffect, useRef, useState, type FormEvent } from "react";
import { sameRate } from "../shared/contracts";
import type { BookingCreateRequest, BookingDto, BookingGuest, BookingGuaranteesDto, BookingStatus, BookingRoomLine, RateDetailDto, RoomAvailabilityDto, RoomOccupancy, RoomStayQuote, SearchRequest } from "../shared/contracts";
import { rebaseStays, replaceNight, roomStayStockAvailable, summarizeStays } from "../shared/roomStays";
import { ApiError, bedbankApi } from "./api";
import { RoomConfiguration } from "./RoomConfiguration";
import { GuestRooms, guestComplete } from "./GuestRooms";
import { countryName } from "../shared/countries";

export type BookingSelection = { requestId: string; search: SearchRequest; detail: RateDetailDto; propertyName: string; items?: { detail: RateDetailDto; quantity: number }[]; journeyId?: string; journeyLeg?: number };
export type BookingDraftFields = { dates?: Pick<SearchRequest, "arrivalDate" | "departureDate">; roomGuests?: BookingGuest[][]; rooms?: RoomOccupancy[]; roomDetails?: RateDetailDto[]; roomStays?: RoomStayQuote[][]; notes?: string; accepted?: boolean; step?: "rooms" | "guests" };
const money = (amount: number, currency: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const statusLabel: Record<BookingStatus, string> = { creating: "Đang tạo · cần kiểm tra kết quả", created: "Chờ xác nhận", confirming: "Đang xác nhận · cần kiểm tra kết quả", confirmed: "Đã xác nhận", attention: "Cần đối soát" };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : "Không thể hoàn tất yêu cầu";
const emptyGuest = (): BookingGuest => ({ firstName: "", lastName: "", country: "", nationality: "", email: "", phoneNumber: "" });
const scrollToHeading = (heading: HTMLHeadingElement | null) => {
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
};

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

export function BookingCheckout({ selection, onCreated, onBack, initialDraft, onDraftChange }: { selection: BookingSelection; onCreated: (booking: BookingDto) => void; onBack: () => void; initialDraft?: BookingDraftFields; onDraftChange?: (draft: BookingDraftFields) => void }) {
  const { detail } = selection;
  const [search, setSearch] = useState<SearchRequest>(() => ({ ...selection.search, ...initialDraft?.dates }));
  const items = selection.items ?? [{ detail, quantity: search.rooms.length }];
  const selectedRoomDetails = items.flatMap((item) => Array.from({ length: item.quantity }, () => item.detail));
  const [roomDetails, setRoomDetails] = useState(() => initialDraft?.roomStays?.map(summarizeStays) ?? initialDraft?.roomDetails ?? selectedRoomDetails);
  const [roomStays, setRoomStays] = useState<RoomStayQuote[][]>(() => initialDraft?.roomStays ?? selectedRoomDetails.map((room, index) => [{ arrivalDate: search.arrivalDate, departureDate: search.departureDate, detail: initialDraft?.roomDetails?.[index] ?? room }]));
  const [roomCapacities, setRoomCapacities] = useState(() => roomStays.map((stays, index) => summarizeStays(stays).maxOccupancy ?? (stays.length === 1 && sameRate(stays[0]!.detail, selectedRoomDetails[index]!) ? selectedRoomDetails[index]?.maxOccupancy : undefined)));
  const [roomOccupancies, setRoomOccupancies] = useState(() => initialDraft?.rooms ?? search.rooms);
  const [roomGuests, setRoomGuests] = useState(() => (initialDraft?.roomGuests ?? search.rooms.map((room) => Array.from({ length: room.adults + room.children + room.infants }, emptyGuest))).map((room) => room.map((guest) => ({ ...guest, country: guest.country ?? "", nationality: guest.nationality ?? "", email: guest.email ?? "", phoneNumber: guest.phoneNumber ?? "" }))));
  const [notes, setNotes] = useState(initialDraft?.notes ?? "");
  const [accepted, setAccepted] = useState(initialDraft?.accepted ?? false);
  const [step, setStep] = useState<"rooms" | "guests">(initialDraft?.step === "guests" ? "guests" : "rooms");
  const [busy, setBusy] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [datesDirty, setDatesDirty] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [configurationError, setConfigurationError] = useState("");
  const [guestScrollRequest, setGuestScrollRequest] = useState(0);
  const [guestEditor, setGuestEditor] = useState<{ roomIndex: number; validate?: boolean }>();
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const heading = useBookingHeading("checkout");
  const guestHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step === "guests") scrollToHeading(guestHeading.current);
  }, [step, guestScrollRequest]);
  const persistDraft = (draft: BookingDraftFields) => { if (mounted.current) onDraftChange?.({ step, dates: { arrivalDate: search.arrivalDate, departureDate: search.departureDate }, roomStays, ...draft }); };
  const needsCapacity = roomCapacities.some((capacity) => capacity === undefined) && Boolean(initialDraft);
  useEffect(() => {
    if (!needsCapacity) return;
    let active = true;
    bedbankApi.rooms({ ...search, rooms: [search.rooms[0]!], propertyId: detail.propertyId }).then((rates) => {
      if (!active) return;
      setRoomCapacities((current) => current.map((capacity, index) => {
        if (capacity !== undefined) return capacity;
        const limits = roomStays[index]!.map((stay) => stay.detail.maxOccupancy ?? rates.find((rate) => rate.roomTypeId === stay.detail.roomTypeId)?.maxOccupancy);
        return limits.every((limit) => limit !== undefined) ? Math.min(...limits as number[]) : undefined;
      }));
    }).catch(() => { if (active) setConfigurationError("Chưa tải được sức chứa phòng. Vui lòng quay lại danh sách phòng và chọn lại hạng phòng."); });
    return () => { active = false; };
  }, [selection.requestId, needsCapacity, search.arrivalDate, search.departureDate]);
  const total = roomDetails.reduce((sum, room) => sum + room.total, 0);
  const exceedsCapacity = roomOccupancies.some((room, index) => roomCapacities[index] !== undefined && room.adults + room.children + room.infants > roomCapacities[index]!);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step !== "guests" || exceedsCapacity || datesDirty || sending.current || repricing || uncertain || !accepted) return;
    const incompleteRoom = roomGuests.findIndex((guests) => guests.some((guest) => !guestComplete(guest)));
    if (incompleteRoom >= 0) { setError(`Vui lòng điền đủ thông tin khách của phòng ${incompleteRoom + 1}.`); setGuestEditor({ roomIndex: incompleteRoom, validate: true }); return; }
    sending.current = true; setBusy(true); setError("");
    const firstRate = roomStays[0]![0]!.detail;
    const datedCodes = roomStays.some((stays, index) => stays.length > 1 || !sameRate(stays[0]!.detail, selectedRoomDetails[index]!));
    const input: BookingCreateRequest = { ...search, rooms: roomOccupancies, requestId: selection.requestId, journeyId: selection.journeyId, journeyLeg: selection.journeyLeg,
      propertyId: firstRate.propertyId, roomTypeId: firstRate.roomTypeId, ratePlanId: firstRate.ratePlanId, allotmentId: firstRate.allotmentId,
      ...(datedCodes ? { roomStaySelections: roomStays.map((stays) => stays.map((stay) => ({ arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, roomTypeId: stay.detail.roomTypeId, ratePlanId: stay.detail.ratePlanId, allotmentId: stay.detail.allotmentId, expectedUnitTotal: stay.detail.total }))) } : { roomSelections: roomDetails.map((room) => ({ roomTypeId: room.roomTypeId, ratePlanId: room.ratePlanId, allotmentId: room.allotmentId, expectedUnitTotal: room.total })) }),
      expectedTotal: total, currency: detail.currency, guests: roomGuests.map((room) => room[0]!), roomGuests, notes, acceptedPolicies: true };
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
    setError("");
    persistDraft({ roomGuests: next, rooms: roomOccupancies, roomDetails, notes, accepted });
  };
  const quoteRoomPlan = async (roomIndex: number, plan: { arrivalDate: string; departureDate: string; rate: RoomAvailabilityDto }[], nextRoom: RoomOccupancy): Promise<boolean> => {
    if (repricing || busy || uncertain) return false;
    const nextCount = nextRoom.adults + nextRoom.children + nextRoom.infants;
    setRepricing(true); setConfigurationError(""); setError("");
    try {
      const quotes = await Promise.all(plan.map(async (stay): Promise<RoomStayQuote> => {
        const quote = await bedbankApi.detail({ ...search, arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, rooms: [nextRoom], propertyId: detail.propertyId, roomTypeId: stay.rate.roomTypeId, ratePlanId: stay.rate.ratePlanId, allotmentId: stay.rate.allotmentId });
        const capacity = quote.maxOccupancy ?? stay.rate.maxOccupancy ?? (plan.length === 1 ? roomCapacities[roomIndex] : undefined);
        if (quote.propertyId !== detail.propertyId || !sameRate(quote, stay.rate) || quote.currency !== detail.currency || quote.quantity < 1 || (capacity !== undefined && nextCount > capacity)) throw new Error("Hạng phòng không còn phù hợp với số khách ở một trong các đêm. Vui lòng chọn lại mã phòng.");
        return { arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, detail: { ...quote, roomTypeCode: quote.roomTypeCode ?? stay.rate.roomTypeCode, maxOccupancy: capacity } };
      }));
      const summary = summarizeStays(quotes);
      const nextStays = roomStays.map((stays, index) => index === roomIndex ? quotes : stays);
      const nextGuests = roomGuests.map((room, index) => index === roomIndex ? Array.from({ length: nextCount }, (_, guestIndex) => room[guestIndex] ?? emptyGuest()) : room);
      const nextRooms = roomOccupancies.map((room, index) => index === roomIndex ? nextRoom : room);
      const nextDetails = roomDetails.map((room, index) => index === roomIndex ? summary : room);
      setRoomStays(nextStays); setRoomGuests(nextGuests); setRoomOccupancies(nextRooms); setRoomDetails(nextDetails); setAccepted(false);
      setRoomCapacities((current) => current.map((capacity, index) => index === roomIndex ? summary.maxOccupancy : capacity));
      persistDraft({ roomStays: nextStays, roomGuests: nextGuests, rooms: nextRooms, roomDetails: nextDetails, notes, accepted: false });
      return true;
    } catch (reason) { setConfigurationError(messageOf(reason)); return false; }
    finally { setRepricing(false); }
  };
  const changeRoomOccupancy = async (roomIndex: number, nextRoom: RoomOccupancy) => {
    const currentGuests = roomGuests[roomIndex]!;
    const nextCount = nextRoom.adults + nextRoom.children + nextRoom.infants;
    const maximum = Math.min(18, roomCapacities[roomIndex] ?? currentGuests.length);
    if (!Object.values(nextRoom).every(Number.isInteger) || nextRoom.adults < 1 || nextRoom.adults > 8 || nextRoom.children < 0 || nextRoom.children > 6 || nextRoom.infants < 0 || nextRoom.infants > 4 || nextCount > maximum) return;
    await quoteRoomPlan(roomIndex, roomStays[roomIndex]!.map((stay) => ({ arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, rate: stay.detail })), nextRoom);
  };
  const changeNightCode = (roomIndex: number, date: string, rate: RoomAvailabilityDto) => quoteRoomPlan(roomIndex, replaceNight(roomStays[roomIndex]!, date, rate), roomOccupancies[roomIndex]!);
  const changeStayDates = async (arrivalDate: string, departureDate: string): Promise<string | undefined> => {
    if (busy || repricing || uncertain) return "Vui lòng chờ cập nhật hiện tại hoàn tất.";
    const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const nights = (Date.parse(departureDate) - Date.parse(arrivalDate)) / 86_400_000;
    if (!validDate(arrivalDate) || !validDate(departureDate) || arrivalDate < today || nights < 1 || nights > 30) return "Chọn ngày nhận phòng từ hôm nay và ngày trả phòng sau ngày nhận, tối đa 30 đêm.";
    setRepricing(true); setConfigurationError(""); setError("");
    try {
      const nextSearch = { ...search, arrivalDate, departureDate };
      const availability = new Map<string, Promise<RoomAvailabilityDto[]>>();
      const details = new Map<string, Promise<RateDetailDto>>();
      const nextStays = await Promise.all(roomStays.map(async (stays, index) => {
        const occupancy = roomOccupancies[index]!;
        const count = occupancy.adults + occupancy.children + occupancy.infants;
        return Promise.all(rebaseStays(stays, arrivalDate, departureDate).map(async (stay): Promise<RoomStayQuote> => {
          const input = { ...nextSearch, arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, rooms: [occupancy], propertyId: detail.propertyId };
          const key = JSON.stringify(input);
          if (!availability.has(key)) availability.set(key, bedbankApi.rooms(input));
          const available = (await availability.get(key)!).find((rate) => sameRate(rate, stay.rate));
          if (!available || available.propertyId !== detail.propertyId || available.currency !== detail.currency || available.quantity < 1) throw new Error("Mã phòng / chương trình không còn khả dụng trong ngày mới. Ngày và giá cũ được giữ lại.");
          const quoteInput = { ...input, roomTypeId: available.roomTypeId, ratePlanId: available.ratePlanId, allotmentId: available.allotmentId };
          const quoteKey = JSON.stringify(quoteInput);
          if (!details.has(quoteKey)) details.set(quoteKey, bedbankApi.detail(quoteInput));
          const quote = await details.get(quoteKey)!;
          const knownCapacities = [quote.maxOccupancy, available.maxOccupancy, stay.rate.maxOccupancy].filter((value): value is number => value !== undefined);
          const capacity = knownCapacities.length ? Math.min(...knownCapacities) : undefined;
          if (quote.propertyId !== detail.propertyId || !sameRate(quote, available) || quote.currency !== detail.currency || quote.quantity < 1 || (capacity !== undefined && count > capacity)) throw new Error("Hạng phòng không còn phù hợp với số khách trong ngày mới. Ngày và giá cũ được giữ lại.");
          return { arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, detail: { ...quote, roomTypeCode: quote.roomTypeCode ?? available.roomTypeCode ?? stay.rate.roomTypeCode, quantity: Math.min(quote.quantity, available.quantity), maxOccupancy: capacity } };
        }));
      }));
      if (!roomStayStockAvailable(nextStays)) throw new Error("Không còn đủ phòng trong ngày mới. Ngày và giá cũ được giữ lại.");
      if (!mounted.current) return;
      const nextDetails = nextStays.map(summarizeStays);
      setSearch(nextSearch); setRoomStays(nextStays); setRoomDetails(nextDetails); setRoomCapacities(nextDetails.map((room) => room.maxOccupancy)); setAccepted(false); setDatesDirty(false);
      persistDraft({ dates: { arrivalDate, departureDate }, roomStays: nextStays, roomDetails: nextDetails, roomGuests, rooms: roomOccupancies, notes, accepted: false });
      return;
    } catch (reason) { return messageOf(reason); }
    finally { if (mounted.current) setRepricing(false); }
  };
  const confirmRooms = () => {
    if (busy || repricing || uncertain || datesDirty || exceedsCapacity) return;
    setStep("guests"); setGuestScrollRequest((current) => current + 1);
    persistDraft({ step: "guests", roomGuests, rooms: roomOccupancies, roomDetails, notes, accepted });
  };
  return <main className="module-page room-booking-page" id="main-content">
    <h1 className="booking-property-title" ref={heading} tabIndex={-1}>{selection.propertyName}</h1>
    <RoomConfiguration arrivalDate={search.arrivalDate} departureDate={search.departureDate} rooms={roomDetails} occupancies={roomOccupancies} capacities={roomCapacities} stays={roomStays} search={search} onNightChange={changeNightCode} datesDirty={datesDirty} onDatesEditingChange={setDatesDirty} onDatesChange={changeStayDates} disabled={busy || repricing || uncertain} repricing={repricing} notes={notes} onBack={onBack}
      onOccupancyChange={(index, occupancy) => void changeRoomOccupancy(index, occupancy)} onNotesChange={(value) => { setNotes(value); persistDraft({ roomGuests, rooms: roomOccupancies, roomDetails, notes: value, accepted }); }} onConfirm={confirmRooms} /><BookingError message={configurationError} />
    {step === "guests" ? <section className="guest-information" aria-labelledby="booking-guest-title"><div className="guest-information-heading"><h2 id="booking-guest-title" className="booking-section-title" ref={guestHeading} tabIndex={-1}>Thông tin khách trong từng phòng</h2><button type="button" className="quiet-button" disabled={busy || repricing || uncertain} onClick={() => scrollToHeading(heading.current)}>Chỉnh lại phòng</button></div><p className="booking-help">Bấm vào từng phòng để điền thông tin khách. Bạn có thể cuộn lên để chỉnh lại phòng.</p><div className="checkout-grid"><section className="checkout-main"><GuestRooms rooms={roomDetails} guests={roomGuests} capacities={roomCapacities} disabled={busy || repricing || uncertain} editor={guestEditor} onOpen={setGuestEditor} onClose={() => setGuestEditor(undefined)} onChange={updateGuest} /><form onSubmit={submit}>
      <fieldset disabled={busy || repricing || uncertain} className="booking-fields">
        <label>Yêu cầu đặc biệt<textarea rows={3} maxLength={1000} value={notes} onChange={(event) => { setNotes(event.target.value); persistDraft({ roomGuests, rooms: roomOccupancies, roomDetails, notes: event.target.value, accepted }); }} placeholder="Giờ đến dự kiến, yêu cầu giường…" /></label>
        <p className="booking-help">Yêu cầu đặc biệt tùy thuộc khả năng đáp ứng của khách sạn.</p>
        <label className="booking-check"><input type="checkbox" required checked={accepted} onChange={(event) => { setAccepted(event.target.checked); persistDraft({ roomGuests, rooms: roomOccupancies, roomDetails, notes, accepted: event.target.checked }); }} /><span>Tôi đã đọc giá và chính sách đặt phòng.</span></label>
        <button className="search-button" disabled={!accepted || exceedsCapacity || datesDirty || busy || repricing || uncertain} type="submit">{busy ? "Đang tạo đặt phòng…" : "Tạo đặt phòng"}</button>
      </fieldset>
    </form><BookingError message={error} />{uncertain ? <div className="booking-recovery"><p>Mã đối soát: <strong>NT-{selection.requestId}</strong></p><button type="button" className="select-room" disabled={busy} onClick={() => void recover()}>Kiểm tra trạng thái đơn</button></div> : null}</section>
      <aside className="checkout-summary"><p className="eyebrow">Kỳ nghỉ đã chọn</p><h2>{selection.propertyName}</h2>
        <dl><div><dt>Nhận phòng</dt><dd>{search.arrivalDate}</dd></div><div><dt>Trả phòng</dt><dd>{search.departureDate}</dd></div><div><dt>Số phòng</dt><dd>{roomDetails.length}</dd></div><div><dt>Tổng số khách</dt><dd>{roomGuests.reduce((sum, room) => sum + room.length, 0)}</dd></div></dl>
        <h3>Giá từng phòng</h3><ul className="booking-price-lines" aria-label="Giá từng phòng">{roomDetails.map((room, index) => <li key={index}><span>Phòng {index + 1} · {room.roomTypeName}{room.allotmentName ? ` · ${room.allotmentName}` : ""} · {room.ratePlanName} · {roomGuests[index]!.length} khách</span><strong>{money(room.total, room.currency)}</strong></li>)}</ul>
        <dl><div className="booking-total"><dt>Tổng giá net</dt><dd>{money(total, detail.currency)}</dd></div></dl>
        <p>{roomDetails.some((room) => room.tax === undefined) ? "Một số hạng phòng chưa có dữ liệu thuế riêng từ khách sạn." : `Thuế theo báo giá: ${money(roomDetails.reduce((sum, room) => sum + room.tax!, 0), detail.currency)}`}</p>
        <details className="guest-summary-policies"><summary>Chính sách đặt phòng</summary>{roomDetails.some((room) => room.policies.length > 0) ? roomDetails.flatMap((room, index) => room.policies.map((policy, policyIndex) => <p key={`${index}-${policyIndex}`}><strong>Phòng {index + 1} · {room.roomTypeName}{room.allotmentName ? ` · ${room.allotmentName}` : ""} · {policy.type}</strong><br />{policy.description}</p>)) : <p>Khách sạn chưa cung cấp mô tả chính sách.</p>}</details>
        <p className="booking-help">Giá và tồn phòng được kiểm tra lại khi tạo đơn. Đơn cần được xác nhận ở bước tiếp theo.</p>
      </aside></div></section> : null}
  </main>;
}

export function BookingDetails({ initial, onBack }: { initial: BookingDto; onBack: () => void }) {
  const [booking, setBooking] = useState(initial);
  const roomLines: BookingRoomLine[] = booking.roomLines ?? booking.request.rooms.map((_, index) => ({ roomTypeId: booking.request.roomSelections?.[index]?.roomTypeId ?? booking.request.roomTypeId, ratePlanId: booking.request.roomSelections?.[index]?.ratePlanId ?? booking.request.ratePlanId, roomTypeName: booking.roomTypeName, ratePlanName: booking.ratePlanName, allotmentName: undefined, unitTotal: booking.total / booking.request.rooms.length }));
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
  return <main className="module-page" id="main-content"><div className="module-heading"><div><p>Đặt phòng · 3 / 3</p><h1 ref={heading} tabIndex={-1}>{booking.status === "confirmed" ? "Đặt phòng đã xác nhận" : "Chi tiết đặt phòng"}</h1><span>{booking.propertyName} · {booking.request.arrivalDate} → {booking.request.departureDate}</span></div><button type="button" disabled={busy} onClick={onBack}>Đặt phòng của tôi</button></div>
    {booking.mode === "mock" ? <p className="booking-demo" role="note">Đặt phòng thử nghiệm · Không giữ phòng thật. Dữ liệu được xóa khi khởi động lại máy chủ.</p> : null}
    <div className="booking-record"><span className="status" data-pending={booking.status !== "confirmed"}>{statusLabel[booking.status]}</span><h2>{booking.roomTypeName}</h2><p>{booking.ratePlanName} · {booking.request.rooms.length} phòng · {money(booking.total, booking.currency)}</p>
      <p className="booking-reference">Mã đối soát: <strong>{booking.reference}</strong></p>
      <h3>Giá từng phòng trong yêu cầu</h3><ul className="booking-price-lines">{roomLines.map((line, index) => <li key={`${index}-${line.roomTypeName}`}><span>Phòng {(line.roomIndex ?? index) + 1}{line.arrivalDate ? ` · ${line.arrivalDate} → ${line.departureDate}` : ""} · {line.roomTypeName}{line.allotmentName ? ` · ${line.allotmentName}` : ""} · {line.ratePlanName} · {money(line.unitTotal, booking.currency)}/phòng</span></li>)}</ul>
      {booking.request.roomGuests?.length ? <><h3>Khách trong từng phòng</h3><ul className="booking-guest-list">{booking.request.roomGuests.map((guests, roomIndex) => <li key={roomIndex}><strong>Phòng {roomIndex + 1}</strong>{guests.map((guest, guestIndex) => <span key={guestIndex}>{[`${guest.lastName} ${guest.firstName}`, guest.country ? `Quốc gia: ${countryName(guest.country)}` : undefined, guest.nationality ? `Quốc tịch: ${countryName(guest.nationality)}` : undefined, guest.email, guest.phoneNumber].filter(Boolean).join(" · ")}</span>)}</li>)}</ul></> : null}
      <h3>Mã xác nhận từ CiHMS</h3><p className="booking-help">CiHMS chưa trả liên kết giữa từng mã xác nhận và hạng phòng. Đối chiếu theo mã khi làm việc với khách sạn.</p><ul className="booking-reservations">{booking.reservations.map((item) => <li key={item.id}><span>Mã phòng CiHMS</span><strong>{item.confirmationNumber || item.id}</strong><span>{item.status === "Reserved" ? "Đã xác nhận" : item.status === "Prospect" ? "Chờ xác nhận" : item.status}</span>{item.error ? <p role="alert">{item.error}</p> : null}</li>)}</ul>
      {booking.message ? <p className="error-state" role="alert">{booking.message}</p> : null}
      {["creating", "confirming"].includes(booking.status) ? <p>Yêu cầu có thể vẫn đang xử lý. Kiểm tra lại trạng thái hoặc liên hệ vận hành với mã đối soát trước khi gửi đơn mới.</p> : null}
      <div className="booking-record-actions"><button className="quiet-button" type="button" disabled={busy} onClick={() => void refresh()}>Kiểm tra trạng thái đơn</button>
      </div>
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

export function BookingsList({ onSelect, onSearch, drafts = [], onOpenDraft }: { onSelect: (booking: BookingDto) => void; onSearch: () => void; drafts?: BookingSelection[]; onOpenDraft?: (draft: BookingSelection) => void }) {
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
    {drafts.length > 0 ? <section className="booking-drafts" aria-label="Đặt phòng đang soạn"><h2>Đặt phòng đang soạn</h2><ul>{drafts.map((draft, index) => <li key={draft.requestId}><div><strong>{draft.propertyName}</strong><span>{draft.search.arrivalDate} → {draft.search.departureDate} · {draft.search.rooms.length} phòng</span></div><button type="button" className="quiet-button" disabled={!onOpenDraft} onClick={() => onOpenDraft?.(draft)}>Mở bản nháp {index + 1}</button></li>)}</ul></section> : null}
    <div className="booking-toolbar"><label>Tìm trong danh sách<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Mã đặt phòng, khách sạn, tên khách…" /></label><button type="button" className="quiet-button" disabled={loading} onClick={() => void load()}>Làm mới</button></div>
    <BookingError message={error} />{loading ? <p className="loading-state" role="status">Đang tải đặt phòng…</p> : null}
    {!loading && !error && !visible.length ? <div className="empty-state"><h2>{bookings.length ? "Không tìm thấy đặt phòng phù hợp." : "Bạn chưa có đặt phòng nào."}</h2><p>Chọn khách sạn và hạng phòng để bắt đầu đặt phòng.</p></div> : null}
    <section className="booking-list" aria-label="Danh sách đặt phòng">{visible.map((booking) => <article className="booking-list-item" key={booking.id}><div><span className="status" data-pending={booking.status !== "confirmed"}>{statusLabel[booking.status]}{booking.mode === "mock" ? " · Thử nghiệm" : ""}</span><h2>{booking.propertyName}</h2><p>{booking.request.arrivalDate} → {booking.request.departureDate} · {booking.request.rooms.length} phòng</p><p>{booking.reservations.map((item) => item.confirmationNumber).filter(Boolean).join(", ") || booking.reference}</p></div><div><strong>{money(booking.total, booking.currency)}</strong><button type="button" className="select-room" onClick={() => onSelect(booking)}>Xem đặt phòng</button></div></article>)}</section>
  </main>;
}
