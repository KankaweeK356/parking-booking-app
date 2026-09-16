import {
  appendSlotStatusLog,
  getActiveBookingsForSlot,
  closeSlotWithBookings,
  openSlot,
} from "../../lib/sheets";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]))) return;
  if (req.method === "GET") {
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
    const { slotCode, action, reason, bookingRowNumbersToClose } = req.body || {};
    if (!slotCode || !action) return res.status(400).json({ error: "ต้องระบุ slotCode และ action" });
    if (action !== "ปิด" && action !== "เปิด") return res.status(400).json({ error: "action ต้องเป็น 'ปิด' หรือ 'เปิด'" });
    if (action === "ปิด" && !reason) return res.status(400).json({ error: "กรุณากรอกเหตุผลตอนปิดช่อง" });

    try {
      if (action === "เปิด") {
        await openSlot(slotCode);
        return res.status(200).json({ ok: true });
      }

      // action === "ปิด"
      if (Array.isArray(bookingRowNumbersToClose) && bookingRowNumbersToClose.length > 0) {
        const result = await closeSlotWithBookings({
          slotCode,
          reason,
          bookingRowNumbersToClose,
        });
        return res.status(200).json(result);
      }

      await appendSlotStatusLog({ slotCode, action, reason });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
