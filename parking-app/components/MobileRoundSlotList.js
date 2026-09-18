import { formatBangkokTime, getPreviousOperationalBlock } from "../lib/operational-day";
import { bookingForBlock, getDashboardCellStatus } from "../lib/timeline-status";

const STATUS_LABELS = {
  booked: "มีการจอง",
  vacant: "ว่าง",
  "ticket-check": "รอตรวจตั๋ว",
  expired: "หมดเวลาจอด",
  closed: "ปิดใช้งาน",
};

export default function MobileRoundSlotList({ slots, bookings, selectedRound, currentBlockStartTime, isLiveOperationalDate }) {
  const previousRound = getPreviousOperationalBlock(selectedRound);
  return <section className="card mobile-round-slots">
    <h2>สถานะช่องรอบ {selectedRound}</h2>
    <div className="mobile-slot-grid">
      {(slots || []).map((slot) => {
        const status = getDashboardCellStatus({ slot, bookings, blockStartTime: selectedRound, currentBlockStartTime, isLiveOperationalDate });
        const booking = bookingForBlock(bookings, slot.code, selectedRound);
        const savedAt = status === "ticket-check" ? formatBangkokTime(booking?.createdAt) : "";
        const detail = status === "ticket-check"
          ? `${savedAt ? `บันทึก ${savedAt}` : "ต้องตรวจตั๋ว"}`
          : status === "expired"
            ? `สิทธิ์รอบ ${previousRound.startTime} สิ้นสุดแล้ว`
            : "";
        return <div key={slot.code} className={`mobile-slot-card mobile-slot-${status}`}>
          <strong>ช่อง {slot.number || "-"}</strong>
          <span>{STATUS_LABELS[status]}</span>
          {detail && <small>{detail}</small>}
        </div>;
      })}
    </div>
  </section>;
}
