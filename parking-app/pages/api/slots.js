import { getSlotsWithStatus, getLots } from "../../lib/sheets";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS, ROLE.FIELD]))) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const [slots, lots] = await Promise.all([getSlotsWithStatus(), getLots()]);
    if (req.query.flat === "true") {
      return res.status(200).json(slots);
    }
    return res.status(200).json({ slots, lots });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
