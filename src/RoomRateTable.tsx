import { useId, useState, type CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import { MAX_BOOKING_ROOMS, rateKey, sameRate, type RateDetailDto, type RoomAvailabilityDto } from "../shared/contracts";

export type ChosenRate = { detail: RateDetailDto; quantity: number };
type Props = {
  hotelName: string; nights: number; rooms: RoomAvailabilityDto[]; chosen: ChosenRate[]; busy: boolean;
  onDetail: (room: RoomAvailabilityDto) => void; onChoose: (room: RoomAvailabilityDto) => void;
  onQuantity: (room: RoomAvailabilityDto, quantity: number) => void; onQuickBook: (room: RoomAvailabilityDto) => void;
};
type GroupProps = Omit<Props, "hotelName" | "rooms"> & { rates: RoomAvailabilityDto[] };
const money = (value: number, currency: string) => new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const lowestAvailable = (rates: RoomAvailabilityDto[]) => rates.reduce<RoomAvailabilityDto | undefined>((lowest, rate) => rate.quantity > 0 && (!lowest || rate.total < lowest.total) ? rate : lowest, undefined);
const countOf = (chosen: ChosenRate[]) => chosen.reduce((sum, item) => sum + item.quantity, 0);
const totalOf = (chosen: ChosenRate[]) => chosen.reduce((sum, item) => sum + item.detail.total * item.quantity, 0);

function ProgramRows({ rates, nights, chosen, busy, onDetail, onChoose, onQuantity, onQuickBook, visible, id }: GroupProps & { visible: boolean; id: string }) {
  const chosenCount = countOf(chosen);
  return <tbody id={id} className="room-programs" data-allotment={Boolean(rates[0]?.allotmentId)} hidden={!visible}>{visible ? rates.map((room) => {
    const selected = chosen.find((item) => sameRate(item.detail, room));
    const label = room.allotmentId ? `${room.roomTypeName} · ${room.allotmentName ?? room.allotmentId} · ${room.ratePlanName}` : rates.length > 1 ? `${room.roomTypeName} · ${room.ratePlanName}` : room.roomTypeName;
    const unitTotal = selected?.detail.total ?? room.total;
    return <tr key={rateKey(room)} data-selected={Boolean(selected)}>
      <td data-label="Chương trình"><strong>{room.ratePlanName}</strong><span>{selected ? "Đang chọn" : "Chương trình giá"}</span></td>
      <td data-label="Tồn phòng"><strong className={room.quantity > 0 ? undefined : "room-sold-out"}>{room.quantity > 0 ? `${room.quantity} phòng` : "Hết phòng"}</strong></td>
      <td data-label="Giá net / phòng / đêm"><strong className="room-unit-price">{money(unitTotal / nights, room.currency)}</strong><span>{room.tax === undefined ? "Thuế: chưa có dữ liệu" : `Thuế / đêm ${money(room.tax / nights, room.currency)}`}</span></td>
      <td data-label="Số phòng chọn">{selected ? <label className="room-quantity">Số phòng<input aria-label={`Số phòng ${label}`} type="number" min={1} max={Math.min(room.quantity, selected.detail.quantity, MAX_BOOKING_ROOMS - chosenCount + selected.quantity)} value={selected.quantity} disabled={busy} onChange={(event) => onQuantity(room, Number(event.target.value))} /></label> : <span>—</span>}</td>
      <td data-label="Thành tiền"><strong>{selected ? money(unitTotal * selected.quantity, room.currency) : "—"}</strong><div className="room-table-actions">
        <button type="button" disabled={busy} onClick={() => onDetail(room)} aria-label={`Xem giá chi tiết ${label}`}>Xem giá & chính sách</button>
        <button type="button" aria-pressed={Boolean(selected)} disabled={busy || (!selected && (room.quantity <= 0 || chosenCount >= MAX_BOOKING_ROOMS))} onClick={() => onChoose(room)} aria-label={`${selected ? "Bỏ chọn" : "Chọn"} ${label}`}>{selected ? <><Check size={14} aria-hidden="true" /> Bỏ chọn</> : "Chọn chương trình"}</button>
        {chosen.length === 0 ? <button type="button" className="select-room" disabled={busy || room.quantity <= 0} onClick={() => onQuickBook(room)} aria-label={`Đặt phòng ${label}`}>Đặt phòng</button> : null}
      </div></td>
    </tr>;
  }) : null}</tbody>;
}

function AllotmentMatrix({ rates, nights, visible, id, chosen, busy, onChoose }: GroupProps & { visible: boolean; id: string }) {
  const columns = new Map<string, { name: string; offers: Map<string, RoomAvailabilityDto> }>();
  const programs = new Map<string, string>();
  for (const rate of rates) {
    const allotmentId = rate.allotmentId ?? "";
    let column = columns.get(allotmentId);
    if (!column) {
      column = { name: rate.allotmentName ?? rate.allotmentId ?? "Chưa có thông tin allotment", offers: new Map() };
      columns.set(allotmentId, column);
    }
    column.offers.set(rate.ratePlanId, rate);
    if (!programs.has(rate.ratePlanId)) programs.set(rate.ratePlanId, rate.ratePlanName);
  }
  const allotments = [...columns];
  const chosenCount = countOf(chosen);
  return <tbody id={id} className="room-matrix-details" hidden={!visible}>{visible ? <tr><td className="room-matrix-cell" colSpan={5}>
    <div className="allotment-matrix-scroll" role="region" aria-label={`So sánh giá ${rates[0]!.roomTypeName}`} tabIndex={0}>
      <table className="allotment-matrix" aria-label={`Giá theo allotment · ${rates[0]!.roomTypeName}`} style={{ "--allotment-count": allotments.length } as CSSProperties}>
        <caption className="visually-hidden">Giá net / phòng / đêm</caption>
        <thead><tr><th scope="col">Chương trình giá</th>{allotments.map(([key, column]) => <th scope="col" key={key}>{column.name}</th>)}</tr></thead>
        <tbody>{[...programs].map(([programId, name], programIndex) => {
          return <tr key={programId}><th scope="row">{name}</th>{allotments.map(([allotmentId, column], columnIndex) => {
            const room = column.offers.get(programId);
            if (!room) return <td className="matrix-empty" key={allotmentId}>Chưa có giá</td>;
            const selected = chosen.find((item) => sameRate(item.detail, room));
            const label = `${room.roomTypeName} · ${column.name} · ${room.ratePlanName}`;
            const total = selected?.detail.total ?? room.total;
            const priceId = `${id}-price-${programIndex}-${columnIndex}`;
            return <td key={allotmentId} data-selected={Boolean(selected)}>
              <div className="matrix-offer">
                <button type="button" className="matrix-price" aria-pressed={Boolean(selected)} aria-label={`${selected ? "Bỏ chọn" : "Chọn"} ${label}`} aria-describedby={priceId} disabled={busy || (!selected && (room.quantity <= 0 || chosenCount >= MAX_BOOKING_ROOMS))} onClick={() => onChoose(room)}>
                  <strong id={priceId}>{money(total / nights, room.currency)}</strong>{selected ? <Check size={17} aria-hidden="true" /> : null}
                </button>
                <span className={`matrix-inventory${room.quantity > 0 ? "" : " room-sold-out"}`}>{room.quantity > 0 ? `${room.quantity} phòng` : "Hết phòng"}</span>

              </div>
            </td>;
          })}</tr>;
        })}</tbody>
      </table>
    </div>
  </td></tr> : null}</tbody>;
}

function RoomGroup({ rates, ...props }: GroupProps) {
  const [expanded, setExpanded] = useState(false);
  const groupId = useId();
  const room = rates[0]!;
  const selected = props.chosen.filter((item) => item.detail.roomTypeId === room.roomTypeId);
  const selectedCount = countOf(selected);
  const lowest = lowestAvailable(rates);
  const allotments = new Map<string, RoomAvailabilityDto[]>();
  for (const rate of rates) {
    const key = rate.allotmentId ?? "";
    const group = allotments.get(key);
    if (group) group.push(rate);
    else allotments.set(key, [rate]);
  }
  const hasAllotments = rates.some((rate) => Boolean(rate.allotmentId));
  return <>
    <tbody className="room-group-summary"><tr className="room-expandable" data-selected={selectedCount > 0} data-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <td data-label="Hạng phòng"><strong>{room.roomTypeName}</strong><span>{hasAllotments ? `${allotments.size} allotment · ` : ""}{rates.length} chương trình</span>{selected.length > 0 ? <span className="room-selected-programs">Đã chọn {selected.length} chương trình</span> : null}</td>
      <td data-label="Tồn phòng"><strong>{lowest ? hasAllotments ? "Theo allotment" : "Theo chương trình" : "Hết phòng"}</strong>{room.maxOccupancy ? <span>Tối đa {room.maxOccupancy} khách/phòng</span> : null}</td>
      <td data-label="Giá net / phòng / đêm">{lowest ? <><span>Từ</span><strong className="room-unit-price">{money(lowest.total / props.nights, lowest.currency)}</strong></> : <strong className="room-sold-out">Hết phòng</strong>}</td>
      <td data-label="Số phòng chọn"><strong>{selectedCount ? `${selectedCount} phòng` : "—"}</strong></td>
      <td data-label="Thành tiền"><div className="room-summary-end"><strong>{selectedCount ? money(totalOf(selected), selected[0]!.detail.currency) : "—"}</strong><button type="button" className="room-program-toggle" aria-label={`${hasAllotments ? "Allotment" : "Chương trình giá"} ${room.roomTypeName}`} aria-expanded={expanded} aria-controls={groupId}><ChevronDown size={18} aria-hidden="true" /></button></div></td>
    </tr></tbody>
    {hasAllotments ? <AllotmentMatrix id={groupId} rates={rates} {...props} visible={expanded} /> : <ProgramRows id={groupId} rates={rates} {...props} visible={expanded} />}
  </>;
}

export function RoomRateTable({ hotelName, rooms, ...props }: Props) {
  const groups = new Map<string, RoomAvailabilityDto[]>();
  for (const room of rooms) {
    const group = groups.get(room.roomTypeId);
    if (group) group.push(room);
    else groups.set(room.roomTypeId, [room]);
  }
  return <div className="room-table-wrap"><table className="room-table" aria-label={`Hạng phòng tại ${hotelName}`}>
    <caption>Mở hạng phòng để so sánh giá giữa các allotment</caption>
    <thead><tr><th scope="col">Hạng phòng / Allotment / Chương trình</th><th scope="col">Tồn phòng</th><th scope="col">Giá net / phòng / đêm</th><th scope="col">Số phòng chọn</th><th scope="col">Thành tiền</th></tr></thead>
    {Array.from(groups, ([id, rates]) => <RoomGroup key={id} rates={rates} {...props} />)}
  </table></div>;
}
