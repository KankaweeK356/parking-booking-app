import { useMemo } from "react";
import { OPERATIONAL_TIME_BLOCKS } from "../lib/operational-day";

function operationalMinute(time) {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  const total = ((hour || 0) * 60) + (minute || 0);
  return total < 420 ? total + 1440 : total;
}

function overlapsBlock(booking, slotCode, blockStartTime) {
  if (booking.slot !== slotCode) return false;
  const bookingStart = operationalMinute(booking.startTime);
  const blockStart = operationalMinute(blockStartTime);
  return bookingStart < blockStart + 240 && blockStart < bookingStart + 240;
}

export default function ParkingTimelineGrid({ slots, bookings, mode }) {
  const bookingMap = useMemo(() => {
    const map = new Map();
    (bookings || []).forEach((booking) => {
      if (!map.has(booking.slot)) map.set(booking.slot, []);
      map.get(booking.slot).push(booking);
    });
    return map;
  }, [bookings]);

  return (
    <div className="timeline-scroll">
      <table className="timeline-grid">
        <thead>
          <tr>
            <th className="timeline-slot-heading">ช่อง</th>
            {OPERATIONAL_TIME_BLOCKS.map((block) => <th key={block.startTime}>{block.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.code}>
              <th scope="row" className="timeline-slot-heading">{slot.code}</th>
              {OPERATIONAL_TIME_BLOCKS.map((block) => {
                const closed = slot.isClosed || slot.isRoad;
                const booking = (bookingMap.get(slot.code) || []).find((item) => overlapsBlock(item, slot.code, block.startTime));
                if (closed) {
                  return <td key={block.startTime} className="timeline-cell timeline-closed" title={slot.closedReason || "ปิดใช้งาน"}>ปิดใช้งาน</td>;
                }
                if (booking) {
                  const label = mode === "cs" ? `คุณ${booking.customer}` : "มีการจอง";
                  return <td key={block.startTime} className="timeline-cell timeline-booked" title={mode === "cs" ? label : `คุณ${booking.customer}`}>{label}</td>;
                }
                return <td key={block.startTime} className="timeline-cell timeline-vacant">ว่าง</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
