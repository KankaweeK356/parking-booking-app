import { bookingForBlock, getDashboardCellStatus } from "../lib/timeline-status";
import { formatBangkokTime, getPreviousOperationalBlock } from "../lib/operational-day";

function savedAtLabel(createdAt) {
  return formatBangkokTime(createdAt);
}

export default function DashboardAttentionList({ slots, bookings, currentBlockStartTime, isLiveOperationalDate }) {
  if (!isLiveOperationalDate || !currentBlockStartTime) return null;
  const previous = getPreviousOperationalBlock(currentBlockStartTime);
  const items = (slots || []).flatMap((slot) => {
    const status = getDashboardCellStatus({ slot, bookings, blockStartTime: currentBlockStartTime, currentBlockStartTime, isLiveOperationalDate });
    if (status === "ticket-check") {
      const booking = bookingForBlock(bookings, slot.code, currentBlockStartTime);
      return [{ slot, status, savedAt: savedAtLabel(booking?.createdAt), round: currentBlockStartTime }];
    }
    if (status === "expired") return [{ slot, status, round: previous.startTime }];
    return [];
  });
  return <div className="card dashboard-attention"><h2>ต้องตรวจตอนนี้ ({items.length})</h2>{items.length === 0 ? <p className="subtitle">ไม่มีช่องที่ต้องตรวจตั๋วหรือตรวจการออกในรอบนี้</p> : <div className="attention-list">{items.map((item) => <div key={`${item.slot.code}-${item.status}`} className={`attention-item ${item.status}`}><strong>ช่อง {item.slot.number || "-"}</strong><span>{item.status === "ticket-check" ? "รอตรวจตั๋ว" : "หมดเวลาจอด"}</span><small>{item.status === "ticket-check" ? `รอบ ${item.round}${item.savedAt ? ` · บันทึก ${item.savedAt}` : ""}` : `สิทธิ์รอบ ${item.round} สิ้นสุดแล้ว`}</small></div>)}</div>}</div>;
}
