import { appendSlotStatusLog, getActiveBookingsForSlot } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // ใช้เช็คก่อนกดปิดช่อง ว่ามีคนจองอยู่ไหม (สำหรับ Popup เตือน)
    const { slot } = req.query;
    if (!slot) return res.status(400).json({ error: "ต้องระบุ slot" });
    try {
      const active = await getActiveBookingsForSlot(slot);
      const mapped = active.map((b) => ({
        rowNumber: b.rowNumber,
        customer: b.customer,
        docId: b.docId,
        lot: b.lot,
        slot: b.slot,
        startDate: b.startDate,
        endDate: b.endDate,
        startTime: b.startTime,
        endTime: b.endTime,
      }));
      return res.status(200).json({ hasActiveBooking: mapped.length > 0, bookings: mapped });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { slotCode, action, reason } = req.body || {};
    if (!slotCode || !action) return res.status(400).json({ error: "ต้องระบุ slotCode และ action" });
    if (action !== "ปิด" && action !== "เปิด") return res.status(400).json({ error: "action ต้องเป็น 'ปิด' หรือ 'เปิด'" });
    if (action === "ปิด" && !reason) return res.status(400).json({ error: "กรอกเหตุผลตอนปิดช่อง" });
    try {
      await appendSlotStatusLog({ slotCode, action, reason });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
