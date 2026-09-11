import { closeBookingRow, closeMultipleBookingRows } from "../../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { rowNumber, rowNumbers, endDate, reason } = req.body || {};

  if ((!rowNumber && (!Array.isArray(rowNumbers) || rowNumbers.length === 0)) || !endDate || !reason) {
    return res.status(400).json({ error: "ต้องระบุ rowNumber (หรือ rowNumbers), วันสิ้นสุด และเหตุผล" });
  }

  try {
    if (Array.isArray(rowNumbers) && rowNumbers.length > 0) {
      const outcomes = await closeMultipleBookingRows(rowNumbers, endDate, reason);
      return res.status(200).json({ ok: true, outcomes });
    }
    await closeBookingRow({ rowNumber, endDate, reason });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
