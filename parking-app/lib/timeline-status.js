import { OPERATIONAL_TIME_BLOCKS, getPreviousOperationalBlock } from "./operational-day.js";

export function bookingForBlock(bookings, slotCode, startTime) {
  return (bookings || []).find((booking) => booking.slot === slotCode && booking.startTime === startTime);
}

export function getDashboardCellStatus({ slot, bookings, unpaidBookings = [], blockStartTime, currentBlockStartTime, isLiveOperationalDate }) {
  if (slot.isClosed || slot.isRoad) return "closed";
  const booking = bookingForBlock(bookings, slot.code, blockStartTime);
  if (booking) return booking.isUrgent ? "ticket-check" : "booked";

  const unpaid = bookingForBlock(unpaidBookings, slot.code, blockStartTime);
  if (unpaid) return "unpaid-booking";

  if (isLiveOperationalDate && blockStartTime === currentBlockStartTime) {
    const previous = getPreviousOperationalBlock(blockStartTime);
    const previousBooking = bookingForBlock(bookings, slot.code, previous.startTime);
    // ทั้งการจองสัญญาปกติและสิทธิ์ด่วน เมื่อหมดรอบแล้วไม่มีคนจองต่อ จะขึ้นเตือนหมดเวลาจอดเพื่อให้ทีมสนามตรวจพื้นที่
    if (previousBooking) return "expired";
  }
  return "vacant";
}

export function getDashboardStatusCounts({ slots, bookings, unpaidBookings = [], currentBlockStartTime, isLiveOperationalDate }) {
  const counts = { booked: 0, "unpaid-booking": 0, vacant: 0, "ticket-check": 0, expired: 0, closed: 0 };
  (slots || []).forEach((slot) => {
    const status = getDashboardCellStatus({
      slot,
      bookings,
      unpaidBookings,
      blockStartTime: currentBlockStartTime || OPERATIONAL_TIME_BLOCKS[0].startTime,
      currentBlockStartTime,
      isLiveOperationalDate,
    });
    counts[status] = (counts[status] || 0) + 1;
  });
  return counts;
}
