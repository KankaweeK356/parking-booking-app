import {
  getActiveBookingsForCustomer,
  createBooking,
  findConflict,
  getSlotStatusMap,
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
    const { customer, lot, slot, startDate, endDate, startTime } = req.body || {};
    if (!customer || !lot || !slot || !startDate || !startTime) {
      return res.status(400).json({ error: "กรอกข้อมูลไม่ครบ (ลูกค้า/ลาน/ช่อง/วันเริ่ม/เวลาเริ่ม)" });
    }
    try {
      // Hard block 1: ช่องปิดอยู่ไหม
      const statusMap = await getSlotStatusMap();
      if (statusMap[slot]?.action === "ปิด") {
        return res.status(409).json({
          error: `ช่อง ${slot} ถูกปิดใช้งานอยู่ (เหตุผล: ${statusMap[slot].reason || "ไม่ระบุ"}) — กรุณาไปกดเปิดช่องนี้ก่อนถึงจะจองได้`,
        });
      }
      // Hard block 2: เวลาชนกับคนอื่นไหม
      const conflict = await findConflict({ slot, startDate, endDate, startTime });
      if (conflict.conflict) {
        return res.status(409).json({
          error: `ช่วงเวลานี้ชนกับ "${conflict.withCustomer}" ที่จองช่อง ${conflict.withSlot} ไว้แล้ว`,
        });
      }
      const result = await createBooking({ customer, lot, slot, startDate, endDate, startTime });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
