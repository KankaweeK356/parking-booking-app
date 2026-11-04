// pages/api/admin/revenue-reconciliation.js
// API รายงานกระทบยอดการชำระเงินสำหรับฝ่ายบัญชี (Admin, Accounting, Account)

import { requireRole, ROLE } from "../../../lib/auth";
import { getRevenueReconciliationData } from "../../../lib/accounting";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await requireRole(req, res, [ROLE.ADMIN, ROLE.ACCOUNTING, ROLE.ACCOUNT]);
  if (!session) return;

  try {
    const { startDate, endDate } = req.query;
    const data = await getRevenueReconciliationData({
      startDate: typeof startDate === "string" && startDate.trim() ? startDate.trim() : undefined,
      endDate: typeof endDate === "string" && endDate.trim() ? endDate.trim() : undefined,
    });
    return res.status(200).json(data);
  } catch (error) {
    console.error("Revenue reconciliation error:", error);
    return res.status(500).json({
      error: error.message || "เกิดข้อผิดพลาดในการดึงข้อมูลกระทบยอด",
    });
  }
}
