import { getTicketReport } from "../../lib/sheets";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]))) return;
  if (req.method === "GET") {
    const { date, customer } = req.query;
    try {
      const data = await getTicketReport(date, customer);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { date, customer } = req.body || {};
    try {
      const data = await getTicketReport(date, customer);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
