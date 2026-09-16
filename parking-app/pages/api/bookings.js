import {
  getActiveBookingsForCustomer,
  createBookingBatch,
} from "../../lib/sheets";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]))) return;
  if (req.method === "GET") {
    const { customer } = req.query;
    if (!customer) return res.status(400).json({ error: "ต้องระบุ customer" });
    try {
      const rows = await getActiveBookingsForCustomer(customer);
      return res.status(200).json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { customer, lot, slot, slots, startDate, endDate, startTime, startTimes, reason } = req.body || {};
    const slotList = Array.isArray(slots) ? slots : (slot ? [slot] : []);
    const timeList = Array.isArray(startTimes) && startTimes.length > 0 ? startTimes : (startTime ? [startTime] : []);
    if (!customer || !lot || slotList.length === 0 || !startDate || !endDate || timeList.length === 0) {
      return res.status(400).json({ error: "กรอกข้อมูลไม่ครบถ้วน (ลูกค้า/ลาน/ช่อง/วันเริ่ม/วันสิ้นสุด/รอบเวลา)" });
    }
    try {
      const result = await createBookingBatch({
        customer,
        lot,
        slots: slotList,
        startDate,
        endDate,
        startTime: timeList[0],
        startTimes: timeList,
        reason: reason || "จองใหม่",
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      // If error is conflict or closed slot, return 409 Conflict
      return res.status(409).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
