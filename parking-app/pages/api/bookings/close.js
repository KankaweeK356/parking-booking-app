import { closeBookingRow } from "../../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { rowNumber, endDate, reason } = req.body || {};
  if (!rowNumber || !endDate || !reason) {
    return res.status(400).json({ error: "ต้องระบุ rowNumber, วันสิ้นสุด และเหตุผล" });
  }
  try {
    await closeBookingRow({ rowNumber, endDate, reason });
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
