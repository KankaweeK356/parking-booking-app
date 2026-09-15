import { OPERATIONAL_TIME_BLOCKS, getPreviousOperationalBlock } from "./operational-day";

export function bookingForBlock(bookings, slotCode, startTime) {
  return (bookings || []).find((booking) => booking.slot === slotCode && booking.startTime === startTime);
}

export function getDashboardCellStatus({ slot, bookings, blockStartTime, currentBlockStartTime, isLiveOperationalDate }) {
  if (slot.isClosed || slot.isRoad) return "closed";
  const booking = bookingForBlock(bookings, slot.code, blockStartTime);
  if (booking) return booking.isUrgent ? "ticket-check" : "booked";

  if (isLiveOperationalDate && blockStartTime === currentBlockStartTime) {
    const previous = getPreviousOperationalBlock(blockStartTime);
    if (bookingForBlock(bookings, slot.code, previous.startTime)) return "expired";
  }
  return "vacant";
}

export function getDashboardStatusCounts({ slots, bookings, currentBlockStartTime, isLiveOperationalDate }) {
  const counts = { booked: 0, vacant: 0, "ticket-check": 0, expired: 0, closed: 0 };
  (slots || []).forEach((slot) => {
    const status = getDashboardCellStatus({
      slot,
      bookings,
      blockStartTime: currentBlockStartTime || OPERATIONAL_TIME_BLOCKS[0].startTime,
      currentBlockStartTime,
      isLiveOperationalDate,
    });
    counts[status] += 1;
  });
  return counts;
}
