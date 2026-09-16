import { createPaymentSnapshot, getPaymentSnapshot } from "../../lib/sheets";
import { getBangkokCalendarDateIso, getBangkokMinutesAfterMidnight } from "../../lib/operational-day";
import { requireRole, ROLE } from "../../lib/auth";

export default async function handler(req, res) {
  const date = String(req.query.date || getBangkokCalendarDateIso());
  if (req.method === "GET") {
    const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS, ROLE.FIELD]);
    if (!session) return;
    return res.status(200).json({ snapshot: await getPaymentSnapshot(date) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const isCron = Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const session = isCron ? null : await requireRole(req, res, [ROLE.ADMIN, ROLE.CS]);
  if (!isCron && !session) return;
  if (date !== getBangkokCalendarDateIso()) return res.status(400).json({ error: "อัปเดตสถานะชำระเงินได้เฉพาะวันตามปฏิทินปัจจุบัน" });
  if (getBangkokMinutesAfterMidnight() < 5) return res.status(409).json({ error: "ระบบเริ่มสร้างสิทธิ์วันใหม่ได้ตั้งแต่ 00:05" });
  try {
    const result = await createPaymentSnapshot(date);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) { return res.status(500).json({ error: err.message }); }
}
