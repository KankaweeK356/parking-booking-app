import { appendUrgentAccessLogs, createBookingBatch, getActiveBookingsForCustomer, getDashboardData, getSlotsWithStatus, getUrgentAccessLogs } from "../../../lib/sheets";
import { getCurrentOperationalDateIso } from "../../../lib/operational-day";

export default async function handler(req, res) {
  const accessDate = req.query.date || getCurrentOperationalDateIso();
  if (req.method === "GET") {
    const { customer } = req.query;
    if (!customer) return res.status(400).json({ error: "ต้องระบุลูกค้า" });
    try {
      const [bookings, dashboard, logs] = await Promise.all([getActiveBookingsForCustomer(customer), getDashboardData(accessDate), getUrgentAccessLogs()]);
      const active = bookings.filter((b) => b.startDate <= accessDate && (!b.endDate || b.endDate >= accessDate));
      const covered = new Set((dashboard.bookings || []).filter((b) => b.customer === customer).map((b) => `${b.slot}::${b.startTime}`));
      const history = logs.filter((log) => log.customer === customer).slice(-5).reverse();
      return res.status(200).json({ accessDate, bookings: active, coveredKeys: [...covered], history });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { customer, accessDate: requestedDate, entries, reason, note, newBooking } = req.body || {};
  const date = requestedDate || getCurrentOperationalDateIso();
  try {
    let logEntries = entries || [];
    if (newBooking) {
      await createBookingBatch({ ...newBooking, customer, startDate: date, endDate: date, reason: "จองด่วนเพิ่ม" });
      const slots = await getSlotsWithStatus();
      logEntries = (newBooking.slots || []).map((slot) => { const info = slots.find((s) => s.slotCode === slot) || {}; return { lot: newBooking.lot, slot, number: info.number || "", startTime: newBooking.startTime }; });
    }
    const result = await appendUrgentAccessLogs({ customer, accessDate: date, entries: logEntries, reason, note, actionType: newBooking ? "จองด่วนเพิ่ม" : "เปิดสิทธิ์จาก booking เดิม" });
    return res.status(200).json(result);
  } catch (err) { return res.status(409).json({ error: err.message }); }
}
