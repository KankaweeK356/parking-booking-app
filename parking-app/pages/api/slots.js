import { getSlotList, getSlotStatusMap } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const [slots, statusMap] = await Promise.all([getSlotList(), getSlotStatusMap()]);
    const withStatus = slots.map((s) => ({
      ...s,
      status: statusMap[s.slotCode]?.action === "ปิด" ? "ปิด" : "เปิด",
      reason: statusMap[s.slotCode]?.reason || "",
    }));
    res.status(200).json(withStatus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
