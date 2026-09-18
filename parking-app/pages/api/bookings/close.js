import { appendDailyAdjustments, appendPauseAdjustments, closeBookingRow, closeMultipleBookingRows } from "../../../lib/sheets";
import { requireRole, ROLE } from "../../../lib/auth";
import { invalidateDashboardCache } from "../../../lib/dashboard-cache";
import { addDaysToIso, getCurrentOperationalDateIso } from "../../../lib/operational-day";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { rowNumber, rowNumbers, endDate, reason, adjustmentDate, pauseStartDate, pauseEndDate } = req.body || {};

  if ((!rowNumber && (!Array.isArray(rowNumbers) || rowNumbers.length === 0)) || !endDate || !reason) {
    return res.status(400).json({ error: "ต้องระบุ rowNumber (หรือ rowNumbers), วันสิ้นสุด และเหตุผล" });
  }

  if (pauseStartDate || pauseEndDate) {
    const firstAllowedDate = addDaysToIso(getCurrentOperationalDateIso(), 1);
    if (!pauseStartDate || !pauseEndDate) return res.status(400).json({ error: "กรุณาระบุวันเริ่มพักและสิ้นสุดพักให้ครบ" });
    if (pauseStartDate < firstAllowedDate) return res.status(400).json({ error: `พักการจองเริ่มได้เร็วสุดวันที่ ${firstAllowedDate} เวลา 07:00` });
    if (pauseEndDate < pauseStartDate) return res.status(400).json({ error: "วันสิ้นสุดพักต้องไม่ก่อนวันเริ่มพัก" });
  }

  try {
    if (pauseStartDate && pauseEndDate && Array.isArray(rowNumbers) && rowNumbers.length > 0) {
      await appendPauseAdjustments({ rowNumbers, startDate: pauseStartDate, endDate: pauseEndDate, reason: reason || "พักการจอง", actor: session });
      invalidateDashboardCache();
      return res.status(200).json({ ok: true, outcomes: rowNumbers.map((item) => ({ rowNumber: item, ok: true })) });
    }
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
