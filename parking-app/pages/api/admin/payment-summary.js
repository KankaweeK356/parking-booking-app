import { requireRole, ROLE } from "../../../lib/auth";
import { getCustomerSummaryData } from "../../../lib/sheets";
import { getBangkokCalendarDateIso } from "../../../lib/operational-day";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await requireRole(req, res, [ROLE.ADMIN]);
  if (!session) return;

  const mode = req.query.mode === "range" ? "range" : "day";
  const date = String(req.query.date || getBangkokCalendarDateIso());
  const startDate = String(req.query.startDate || date);
  const endDate = String(req.query.endDate || date);

  try {
    const data = await getCustomerSummaryData({
      mode,
      date,
      startDate,
      endDate,
    });
    return res.status(200).json({ ok: true, ...data });
  } catch (err) {
    console.error("Payment summary error:", err);
    return res.status(500).json({ error: err.message || "เกิดข้อผิดพลาดในการดึงข้อมูลสรุปการชำระเงิน" });
  }
}
