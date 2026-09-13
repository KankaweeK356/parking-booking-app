import {
  getActiveBookingsForCustomer,
  createBookingBatch,
} from "../../lib/sheets";

export default async function handler(req, res) {
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
    const { customer, lot, slot, slots, startDate, endDate, startTime, reason } = req.body || {};
    const slotList = Array.isArray(slots) ? slots : (slot ? [slot] : []);
    if (!customer || !lot || slotList.length === 0 || !startDate || !endDate || !startTime) {
      return res.status(400).json({ error: "กรอกข้อมูลไม่ครบถ้วน (ลูกค้า/ลาน/ช่อง/วันเริ่ม/วันสิ้นสุด/รอบเวลา)" });
    }
    try {
      const result = await createBookingBatch({
        customer,
        lot,
        slots: slotList,
        startDate,
        endDate,
        startTime,
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
