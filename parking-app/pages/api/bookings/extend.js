import { extendBooking } from "../../../lib/sheets";
import { requireRole, ROLE } from "../../../lib/auth";
import { invalidateDashboardCache } from "../../../lib/dashboard-cache";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]))) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { rowNumber, lot, slot, startDate, endDate, startTime } = req.body || {};

  if (!rowNumber || !slot || !endDate) {
    return res.status(400).json({ error: "ต้องระบุรายการและวันสิ้นสุด" });
  }

  try {
    const result = await extendBooking({ rowNumber, lot, slot, startDate, endDate, startTime });
    invalidateDashboardCache();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
}
