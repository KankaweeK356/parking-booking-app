import {
  appendSlotStatusLog,
  getActiveBookingsForSlot,
  closeSlotWithBookings,
  openSlot,
} from "../../lib/sheets";
import { requireRole, ROLE } from "../../lib/auth";
import { invalidateDashboardCache } from "../../lib/dashboard-cache";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!session) return;
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
        await openSlot(slotCode, session);
        invalidateDashboardCache();
        return res.status(200).json({ ok: true });
      }

      // A closure must never silently cancel bookings.  CS must resolve them
      // through the adjustment flow (move, pause, or cancel) first.
      const active = await getActiveBookingsForSlot(slotCode);
      if (active.length) return res.status(409).json({ error: "ช่องนี้ยังมีรายการจองอยู่ กรุณาย้ายช่อง พักการจอง หรือยกเลิกรายการที่กระทบก่อนปิดช่อง" });

      await appendSlotStatusLog({ slotCode, action, reason, actor: session });
      invalidateDashboardCache();
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
