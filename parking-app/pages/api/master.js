import { getMasterList } from "../../lib/sheets";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]))) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const list = await getMasterList();
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
