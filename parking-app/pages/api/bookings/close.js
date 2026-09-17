import { appendDailyAdjustments, closeBookingRow, closeMultipleBookingRows } from "../../../lib/sheets";
import { requireRole, ROLE } from "../../../lib/auth";
import { invalidateDashboardCache } from "../../../lib/dashboard-cache";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { rowNumber, rowNumbers, endDate, reason, adjustmentDate } = req.body || {};

  if ((!rowNumber && (!Array.isArray(rowNumbers) || rowNumbers.length === 0)) || !endDate || !reason) {
    return res.status(400).json({ error: "ต้องระบุ rowNumber (หรือ rowNumbers), วันสิ้นสุด และเหตุผล" });
  }

  try {
    if (adjustmentDate && Array.isArray(rowNumbers) && rowNumbers.length > 0) {
      await appendDailyAdjustments({ rowNumbers, effectiveDate: adjustmentDate, reason, actor: session });
      invalidateDashboardCache();
      return res.status(200).json({ ok: true, outcomes: rowNumbers.map((item) => ({ rowNumber: item, ok: true })) });
    }
    if (Array.isArray(rowNumbers) && rowNumbers.length > 0) {
      const outcomes = await closeMultipleBookingRows(rowNumbers, endDate, reason, session);
      invalidateDashboardCache();
      return res.status(200).json({ ok: true, outcomes });
    }
    await closeBookingRow({ rowNumber, endDate, reason, actor: session });
    invalidateDashboardCache();
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
