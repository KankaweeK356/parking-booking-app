export const TICKET_PRICE_PER_UNIT = 100;

export function calculateTicketAmount(ticketCount) {
  return Math.max(0, Number(ticketCount) || 0) * TICKET_PRICE_PER_UNIT;
}
