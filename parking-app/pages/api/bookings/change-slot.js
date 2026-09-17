import { changeSlot } from "../../../lib/sheets";
import { requireRole, ROLE } from "../../../lib/auth";
import { invalidateDashboardCache } from "../../../lib/dashboard-cache";

export default async function handler(req, res) {
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const {
    oldRowNumber,
    customer,
    newLot,
    newSlot,
    newStartDate,
    newEndDate,
    newStartTime,
  } = req.body || {};

  if (!oldRowNumber || !customer || !newLot || !newSlot || !newStartDate || !newEndDate || !newStartTime) {
    return res.status(400).json({ error: "กรอกข้อมูลไม่ครบถ้วนสำหรับการย้ายช่องจอด" });
  }

  try {
    const result = await changeSlot({
      oldRowNumber,
      customer,
      newLot,
      newSlot,
      newStartDate,
      newEndDate,
      newStartTime,
      actor: session,
    });
    invalidateDashboardCache();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
}
