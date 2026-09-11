import { extendBooking } from "../../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { rowNumber, lot, slot, startDate, endDate, startTime } = req.body || {};

  if (!rowNumber || !slot || !startDate || !startTime) {
    return res.status(400).json({ error: "กรอกข้อมูลไม่ครบถ้วน (rowNumber, ช่อง, วันเริ่ม, เวลาเริ่ม)" });
  }

  try {
    const result = await extendBooking({ rowNumber, lot, slot, startDate, endDate, startTime });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
}
