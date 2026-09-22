import { appendDailyAdjustments, appendPauseAdjustments, closeBookingRow, closeMultipleBookingRows } from "../../../lib/sheets";
import { requireRole, ROLE } from "../../../lib/auth";
import { invalidateDashboardCache } from "../../../lib/dashboard-cache";
import { addDaysToIso, getCurrentOperationalDateIso } from "../../../lib/operational-day";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { mode, rowNumber, rowNumbers, endDate, reason, adjustmentDate, pauseStartDate, pauseEndDate } = req.body || {};

  const isVoid = mode === "void" || String(reason || "").includes("คีย์ผิด");

  if (!rowNumber && (!Array.isArray(rowNumbers) || rowNumbers.length === 0)) {
    return res.status(400).json({ error: "ต้องระบุ rowNumber หรือ rowNumbers" });
  }

  if (!isVoid && !endDate && !pauseStartDate && !adjustmentDate) {
    return res.status(400).json({ error: "ต้องระบุวันสิ้นสุด หรือช่วงวันพัก" });
  }

  if (!isVoid && !reason) {
    return res.status(400).json({ error: "ต้องระบุเหตุผล" });
  }

  if (pauseStartDate || pauseEndDate) {
    const firstAllowedDate = addDaysToIso(getCurrentOperationalDateIso(), 1);
    if (!pauseStartDate || !pauseEndDate) return res.status(400).json({ error: "กรุณาระบุวันเริ่มพักและสิ้นสุดพักให้ครบ" });
    if (pauseStartDate < firstAllowedDate) return res.status(400).json({ error: `พักการจองเริ่มได้เร็วสุดวันที่ ${firstAllowedDate} เวลา 07:00` });
    if (pauseEndDate < pauseStartDate) return res.status(400).json({ error: "วันสิ้นสุดพักต้องไม่ก่อนวันเริ่มพัก" });
  }

  const effectiveReason = isVoid ? "ยกเลิก (คีย์ผิด)" : reason;
  const effectiveEndDate = isVoid
    ? addDaysToIso(getCurrentOperationalDateIso(), -1)
    : endDate;

  try {
    if (pauseStartDate && pauseEndDate && Array.isArray(rowNumbers) && rowNumbers.length > 0) {
      await appendPauseAdjustments({ rowNumbers, startDate: pauseStartDate, endDate: pauseEndDate, reason: effectiveReason || "พักการจอง", actor: session });
      invalidateDashboardCache();
      return res.status(200).json({ ok: true, outcomes: rowNumbers.map((item) => ({ rowNumber: item, ok: true })) });
    }
    if (adjustmentDate && Array.isArray(rowNumbers) && rowNumbers.length > 0) {
      await appendDailyAdjustments({ rowNumbers, effectiveDate: adjustmentDate, reason: effectiveReason, actor: session });
      invalidateDashboardCache();
      return res.status(200).json({ ok: true, outcomes: rowNumbers.map((item) => ({ rowNumber: item, ok: true })) });
    }
    if (Array.isArray(rowNumbers) && rowNumbers.length > 0) {
      const outcomes = await closeMultipleBookingRows(rowNumbers, effectiveEndDate, effectiveReason, session);
      invalidateDashboardCache();
      return res.status(200).json({ ok: true, outcomes });
    }
    await closeBookingRow({ rowNumber, endDate: effectiveEndDate, reason: effectiveReason, actor: session });
    invalidateDashboardCache();
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
