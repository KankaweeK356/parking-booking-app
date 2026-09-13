import { changeSlot } from "../../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const {
    oldRowNumber,
    oldEndDate,
    customer,
    newLot,
    newSlot,
    newStartDate,
    newEndDate,
    newStartTime,
  } = req.body || {};

  if (!oldRowNumber || !oldEndDate || !customer || !newLot || !newSlot || !newStartDate || !newEndDate || !newStartTime) {
    return res.status(400).json({ error: "กรอกข้อมูลไม่ครบถ้วนสำหรับการย้ายช่องจอด" });
  }

  try {
    const result = await changeSlot({
      oldRowNumber,
      oldEndDate,
      customer,
      newLot,
      newSlot,
      newStartDate,
      newEndDate,
      newStartTime,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
}
