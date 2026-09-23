import { formatBangkokTime } from "../lib/operational-day";
import { formatFieldCustomerName } from "../lib/display";
import { bookingForBlock, getDashboardCellStatus } from "../lib/timeline-status";

const STATUS_LABELS = {
  booked: "มีการจอง",
  vacant: "ว่าง",
  "ticket-check": "รอตรวจตั๋ว",
  expired: "หมดเวลาจอด",
  closed: "ปิดใช้งาน",
};

export default function MobileRoundSlotList({ slots, bookings, selectedRound, currentBlockStartTime, isLiveOperationalDate }) {
  return <section className="card mobile-round-slots">
    <h2>สถานะช่องรอบ {selectedRound}</h2>
    <div className="mobile-slot-grid">
      {(slots || []).map((slot) => {
        const status = getDashboardCellStatus({ slot, bookings, blockStartTime: selectedRound, currentBlockStartTime, isLiveOperationalDate });
        const booking = bookingForBlock(bookings, slot.code, selectedRound);
        const fieldName = booking ? formatFieldCustomerName(booking.customer) : "";
        const savedAt = status === "ticket-check" ? formatBangkokTime(booking?.createdAt) : "";

        let mainLabel = STATUS_LABELS[status];
        if (status === "booked" || status === "ticket-check") {
          mainLabel = fieldName || STATUS_LABELS[status];
        }

        const detail = status === "ticket-check"
          ? `รอตรวจตั๋ว${savedAt ? ` (${savedAt})` : ""}`
          : "";

        return <div key={slot.code} className={`mobile-slot-card mobile-slot-${status}`} title={booking?.customer || ""}>
          <strong>ช่อง {slot.number || "-"}</strong>
          <span className="mobile-slot-label">{mainLabel}</span>
          {detail && <small>{detail}</small>}
        </div>;
      })}
    </div>
  </section>;
}
