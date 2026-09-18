import { appendUrgentAccessLogs, createBookingBatch, getDashboardData, getSlotsWithStatus, getUrgentAccessLogs } from "../../../lib/sheets";
import { getUrgentAccessDefaultDateIso, isBeforeOperationalBlockStart } from "../../../lib/operational-day";
import { requireRole, ROLE } from "../../../lib/auth";
import { invalidateDashboardCache } from "../../../lib/dashboard-cache";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!session) return;
  const accessDate = req.query.date || getUrgentAccessDefaultDateIso();
  if (req.method === "GET") {
    const { customer } = req.query;
    if (!customer) return res.status(400).json({ error: "ต้องระบุลูกค้า" });
    try {
      const [dashboard, logs] = await Promise.all([getDashboardData(accessDate), getUrgentAccessLogs()]);
      const paidBookings = (dashboard.bookings || []).filter((booking) => booking.customer === customer && !booking.isUrgent);
      const history = logs.filter((log) => log.customer === customer).slice(-5).reverse();
      return res.status(200).json({ accessDate, paymentStatus: dashboard.paymentStatus, paidBookings, history });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { customer, accessDate: requestedDate, note, newBooking, bookingKind } = req.body || {};
  const date = requestedDate || getUrgentAccessDefaultDateIso();
  if (date !== getUrgentAccessDefaultDateIso()) return res.status(400).json({ error: "สิทธิ์ระหว่างวันบันทึกได้เฉพาะวันปฏิบัติการปัจจุบัน" });
  try {
    if (!customer || !newBooking || !["additional", "daily-new"].includes(bookingKind)) throw new Error("กรอกข้อมูลจองรายวันไม่ครบถ้วน");
    const dashboard = await getDashboardData(date);
    if (dashboard.paymentStatus !== "READY") throw new Error("ข้อมูลสถานะการชำระเงินยังไม่พร้อม กรุณารอหรืออัปเดตข้อมูลใหม่");
    const hasPaidEntitlement = (dashboard.bookings || []).some((booking) => booking.customer === customer && !booking.isUrgent);
    if (bookingKind === "additional" && !hasPaidEntitlement) throw new Error("ลูกค้ารายนี้ไม่มีสิทธิ์ที่ชำระแล้วสำหรับวันนี้ กรุณาใช้จองใหม่รายวัน");
    let logEntries = [];
    if (newBooking) {
      const timeList = newBooking.startTime ? [newBooking.startTime] : [];
      if (timeList.length !== 1 || !isBeforeOperationalBlockStart(date, timeList[0])) throw new Error("สิทธิ์ระหว่างวันเลือกได้ 1 รอบที่ยังไม่เริ่มเท่านั้น");
      await createBookingBatch({ ...newBooking, customer, startDate: date, endDate: date, startTimes: timeList, startTime: timeList[0], reason: bookingKind === "additional" ? "จองเพิ่มระหว่างวัน" : "จองใหม่รายวัน", actor: session, bookingType: "Urgent" });
      const slots = await getSlotsWithStatus();
      logEntries = (newBooking.slots || []).flatMap((slot) => { const info = slots.find((s) => s.slotCode === slot) || {}; return timeList.map((startTime) => ({ lot: newBooking.lot, slot, number: info.number || "", startTime })); });
    }
    if (logEntries.some((entry) => !isBeforeOperationalBlockStart(date, entry.startTime))) throw new Error("เลือกรอบที่ยังไม่เริ่มเท่านั้น");
    const result = await appendUrgentAccessLogs({ customer, accessDate: date, entries: logEntries, note, actionType: bookingKind === "additional" ? "จองเพิ่ม" : "จองใหม่รายวัน", actor: session });
    invalidateDashboardCache();
    return res.status(200).json(result);
  } catch (err) { return res.status(409).json({ error: err.message }); }
}
