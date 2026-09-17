import { appendPaymentRefreshState, createPaymentSnapshot, getPaymentRefreshState, getPaymentSnapshot } from "../../lib/sheets";
import { getBangkokCalendarDateIso, getBangkokMinutesAfterMidnight } from "../../lib/operational-day";
import { requireRole, ROLE } from "../../lib/auth";
import { invalidateDashboardCache } from "../../lib/dashboard-cache";

const RETRY_COOLDOWN_MS = 2 * 60 * 1000;

function isCronRequest(req) {
  return Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

async function createSnapshot({ date, source }) {
  await appendPaymentRefreshState({ operationalDate: date, source, status: "STARTED" });
  try {
    const result = await createPaymentSnapshot(date);
    await appendPaymentRefreshState({ operationalDate: date, source, status: "READY" });
    invalidateDashboardCache();
    return result;
  } catch (err) {
    await appendPaymentRefreshState({ operationalDate: date, source, status: "FAILED", message: err.message });
    throw err;
  }
}

export default async function handler(req, res) {
  const date = String(req.query.date || getBangkokCalendarDateIso());
  const isCron = isCronRequest(req);
  if (req.method === "GET") {
    if (isCron) {
      try { return res.status(200).json({ ok: true, ...(await createSnapshot({ date, source: "CRON" })) }); }
      catch (err) { return res.status(500).json({ error: err.message }); }
    }
    const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.CS, ROLE.FIELD]);
    if (!session) return;
    try { return res.status(200).json({ snapshot: await getPaymentSnapshot(date) }); }
    catch (err) { return res.status(500).json({ error: err.message }); }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.FIELD]);
  if (!session) return;
  if (date !== getBangkokCalendarDateIso()) return res.status(400).json({ error: "อัปเดตสถานะชำระเงินได้เฉพาะวันตามปฏิทินปัจจุบัน" });
  if (getBangkokMinutesAfterMidnight() < 5) return res.status(409).json({ error: "ระบบเริ่มสร้างสิทธิ์วันใหม่ได้ตั้งแต่ 00:05" });
  const previousAttempt = await getPaymentRefreshState(date);
  const remainingMs = RETRY_COOLDOWN_MS - (Date.now() - Date.parse(previousAttempt?.attemptedAt || 0));
  if (!isCron && remainingMs > 0) {
    const availableAt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + remainingMs));
    return res.status(429).json({ error: `เพิ่งดึงข้อมูล MIS ไปแล้ว กรุณาลองใหม่หลัง ${availableAt}` });
  }
  try {
    const result = await createSnapshot({ date, source: `MANUAL:${session.role}` });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) { return res.status(500).json({ error: err.message }); }
}
