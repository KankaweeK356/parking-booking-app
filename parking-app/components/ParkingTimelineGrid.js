import { useMemo } from "react";
import { formatBangkokTime, OPERATIONAL_TIME_BLOCKS, getPreviousOperationalBlock } from "../lib/operational-day";
import { displayCustomerName, formatFieldCustomerName } from "../lib/display";
import { getDashboardCellStatus, bookingForBlock } from "../lib/timeline-status";

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

function savedAtLabel(createdAt) {
  return formatBangkokTime(createdAt);
}

export default function ParkingTimelineGrid({
  slots,
  bookings,
  unpaidBookings = [],
  mode,
  currentBlockStartTime,
  isLiveOperationalDate = false,
}) {
  const bookingMap = useMemo(() => {
    const map = new Map();
    (bookings || []).forEach((booking) => {
      if (!map.has(booking.slot)) map.set(booking.slot, []);
      map.get(booking.slot).push(booking);
    });
    return map;
  }, [bookings]);

  const unpaidMap = useMemo(() => {
    const map = new Map();
    (unpaidBookings || []).forEach((booking) => {
      if (!map.has(booking.slot)) map.set(booking.slot, []);
      map.get(booking.slot).push(booking);
    });
    return map;
  }, [unpaidBookings]);

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
              <th scope="row" className="timeline-slot-heading">ช่อง {slot.number || "-"}</th>
              {OPERATIONAL_TIME_BLOCKS.map((block) => {
                const closed = slot.isClosed || slot.isRoad;
                const booking = (bookingMap.get(slot.code) || []).find((item) => overlapsBlock(item, slot.code, block.startTime));
                if (closed) {
                  return <td key={block.startTime} className="timeline-cell timeline-closed" title={slot.closedReason || "ปิดใช้งาน"}>ปิดใช้งาน</td>;
                }
                if (booking) {
                  const fieldName = formatFieldCustomerName(booking.customer);
                  const label = mode === "cs" ? displayCustomerName(booking.customer) : fieldName || "จองแล้ว";
                  const className = mode === "cs" ? "timeline-booked" : booking.isUrgent ? "timeline-ticket-check" : "timeline-booked";
                  const savedAt = booking.isUrgent ? savedAtLabel(booking.createdAt) : "";
                  const title = mode === "cs"
                    ? displayCustomerName(booking.customer)
                    : `${displayCustomerName(booking.customer)}${savedAt ? ` — รอตรวจตั๋ว (บันทึก ${savedAt})` : ""}`;
                  return (
                    <td key={block.startTime} className={`timeline-cell ${className}`} title={title}>
                      <span>{label}</span>
                      {mode !== "cs" && booking.isUrgent && savedAt && <small>รอตรวจตั๋ว {savedAt}</small>}
                    </td>
                  );
                }
                if (mode === "dashboard") {
                  const cellStatus = getDashboardCellStatus({
                    slot,
                    bookings,
                    unpaidBookings,
                    blockStartTime: block.startTime,
                    currentBlockStartTime,
                    isLiveOperationalDate,
                  });
                  if (cellStatus === "unpaid-booking") {
                    const unpaidBooking = (unpaidMap.get(slot.code) || []).find((item) =>
                      overlapsBlock(item, slot.code, block.startTime)
                    );
                    const unpaidCustomer = unpaidBooking ? formatFieldCustomerName(unpaidBooking.customer) : "";
                    const title = unpaidBooking
                      ? `${displayCustomerName(unpaidBooking.customer)} — จองไว้แต่ไม่ตีตั๋ว`
                      : "จองไว้แต่ไม่ตีตั๋ว";
                    return (
                      <td key={block.startTime} className="timeline-cell timeline-unpaid" title={title}>
                        <span>{unpaidCustomer || "ไม่ตีตั๋ว"}</span>
                        <small>ไม่ตีตั๋ว</small>
                      </td>
                    );
                  }
                  if (cellStatus === "expired") {
                    const previousBlock = getPreviousOperationalBlock(block.startTime);
                    const prevBooking = bookingForBlock(bookings, slot.code, previousBlock?.startTime);
                    const prevCustomer = prevBooking ? formatFieldCustomerName(prevBooking.customer) : "";
                    const title = prevBooking
                      ? `${displayCustomerName(prevBooking.customer)} — หมดเวลาจอด`
                      : "หมดเวลาจอด";
                    return (
                      <td key={block.startTime} className="timeline-cell timeline-expired" title={title}>
                        <span>{prevCustomer || "หมดเวลาจอด"}</span>
                        {prevCustomer && <small>หมดเวลาจอด</small>}
                      </td>
                    );
                  }
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
