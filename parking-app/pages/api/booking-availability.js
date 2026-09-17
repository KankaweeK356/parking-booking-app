import { getSlotAvailability } from "../../lib/sheets";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]))) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { lot, startDate, endDate, startTimes = "" } = req.query;
  if (!lot || !startDate || !endDate) return res.status(400).json({ error: "ต้องระบุลานและช่วงวันที่" });
  try {
    const availability = await getSlotAvailability({ lot, startDate, endDate, startTimes: String(startTimes).split(",").filter(Boolean) });
    return res.status(200).json({ availability });
  } catch (error) { return res.status(500).json({ error: error.message }); }
}
