import { appendFieldInspectionLog } from "../../lib/sheets";
import { getCurrentOperationalDateIso, isVerticalAllocationActive } from "../../lib/operational-day";
import { requireRole, ROLE } from "../../lib/auth";
import { invalidateDashboardCache } from "../../lib/dashboard-cache";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS, ROLE.FIELD]);
  if (!session) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      operationalDate = getCurrentOperationalDateIso(),
      docId = "",
      customer = "",
      lot = "",
      startTime = "",
      contractedSlots = 0,
      actualUsedSlots = 0,
    } = req.body || {};

    if (!isVerticalAllocationActive(operationalDate)) {
      return res.status(400).json({ error: "ระบบปรับยอดใช้จริงหน้างานจะเริ่มทำงานตั้งแต่วันตัดรอบใหม่เป็นต้นไป" });
    }

    const result = await appendFieldInspectionLog({
      operationalDate,
      docId,
      customer,
      lot,
      startTime,
      contractedSlots,
      actualUsedSlots,
      actor: session,
    });

    invalidateDashboardCache();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || "บันทึกข้อมูลไม่สำเร็จ" });
  }
}
