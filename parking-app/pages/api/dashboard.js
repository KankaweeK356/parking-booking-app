import { getDashboardDataCached } from "../../lib/dashboard-cache";
import { getCurrentOperationalBlock, getCurrentOperationalDateIso } from "../../lib/operational-day";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  if (!(await requireRole(req, res, [ROLE.ADMIN, ROLE.CS, ROLE.FIELD]))) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { date } = req.query;
  try {
    const data = await getDashboardDataCached(date);
    // เวลาเดินต่อเนื่องแม้ข้อมูลช่องจอดอยู่ใน cache จึงคำนวณรอบปัจจุบันใหม่ทุกคำขอ
    return res.status(200).json({
      ...data,
      isLiveOperationalDate: date === getCurrentOperationalDateIso(),
      currentBlock: getCurrentOperationalBlock(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
