import { getRequiredSummary } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { date } = req.query;
    try {
      const data = await getRequiredSummary(date);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { date } = req.body || {};
    try {
      const data = await getRequiredSummary(date);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
