import { getRequiredSummary, updateRequiredSummaryDate } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const data = await getRequiredSummary();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { date } = req.body || {};
    if (!date) {
      return res.status(400).json({ error: "ต้องระบุ date (YYYY-MM-DD)" });
    }
    try {
      const data = await updateRequiredSummaryDate(date);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
