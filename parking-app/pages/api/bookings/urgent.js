import { appendUrgentAccessLogs, createBookingBatch, getActiveBookingsForCustomer, getDashboardData, getSlotsWithStatus, getUrgentAccessLogs } from "../../../lib/sheets";
import { getUrgentAccessDefaultDateIso, isBeforeOperationalBlockStart } from "../../../lib/operational-day";
import { requireRole, ROLE } from "../../../lib/auth";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!session) return;
  const accessDate = req.query.date || getUrgentAccessDefaultDateIso();
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
  const date = requestedDate || getUrgentAccessDefaultDateIso();
  if (date !== getUrgentAccessDefaultDateIso()) return res.status(400).json({ error: "สิทธิ์ระหว่างวันบันทึกได้เฉพาะวันปฏิบัติการปัจจุบัน" });
  try {
    let logEntries = entries || [];
    if (newBooking) {
      const timeList = newBooking.startTimes || (newBooking.startTime ? [newBooking.startTime] : []);
      if (timeList.length === 0 || timeList.some((time) => !isBeforeOperationalBlockStart(date, time))) throw new Error("เลือกรอบที่ยังไม่เริ่มเท่านั้น");
      await createBookingBatch({ ...newBooking, customer, startDate: date, endDate: date, startTimes: timeList, startTime: timeList[0], reason: "เพิ่มช่องด่วนระหว่างวัน", actor: session });
      const slots = await getSlotsWithStatus();
      logEntries = (newBooking.slots || []).flatMap((slot) => { const info = slots.find((s) => s.slotCode === slot) || {}; return timeList.map((startTime) => ({ lot: newBooking.lot, slot, number: info.number || "", startTime })); });
    }
    if (logEntries.some((entry) => !isBeforeOperationalBlockStart(date, entry.startTime))) throw new Error("เลือกรอบที่ยังไม่เริ่มเท่านั้น");
    const result = await appendUrgentAccessLogs({ customer, accessDate: date, entries: logEntries, reason, note, actionType: newBooking ? "เพิ่มช่องด่วนระหว่างวัน" : "ตีตั๋วเพิ่มตามการจองเดิม", actor: session });
    return res.status(200).json(result);
  } catch (err) { return res.status(409).json({ error: err.message }); }
}
