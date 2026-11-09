// pages/api/cron/accounting-archive.js
// API สำหรับตั้งเวลาอัตโนมัติ (Cron Job / Daily Sync) บันทึกตั๋วด่านและสรุปยอดเข้า Accounting Archive ถาวร
// ป้องกันข้อมูลหลุดหายช่วงวันหยุดยาวและหมุนรอบ 5 วันของ tbt_DailyFee

import { getRevenueReconciliationData } from "../../../lib/accounting";
import { getTodaySerial, isoFromSerial, isoDateToSerial } from "../../../lib/sheets";
import { readSession, ROLE } from "../../../lib/auth";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 1. ตรวจสอบสิทธิ์ความปลอดภัย: รองรับทั้ง CRON_SECRET (Automated) และ User Session (Manual by Admin/Accounting)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const customKey = req.headers["x-cron-key"] || req.query.secret || "";

  const isCronAuthorized =
    cronSecret && (token === cronSecret || customKey === cronSecret);

  let isUserAuthorized = false;
  if (!isCronAuthorized) {
    const session = readSession(req);
    if (session && [ROLE.ADMIN, ROLE.ACCOUNTING, ROLE.ACCOUNT].includes(session.role)) {
      isUserAuthorized = true;
    }
  }

  if (!isCronAuthorized && !isUserAuthorized) {
    return res.status(401).json({
      error: "ไม่มีสิทธิ์เรียกใช้งาน (Unauthorized: Invalid CRON_SECRET or Session)",
    });
  }

  try {
    const todaySerial = getTodaySerial();
    // ค่าเริ่มต้นของ Cron: ซิงค์รอบกว้าง 4 วันล่าสุด (D-4 ถึง D-1)
    // เพื่อครอบคลุมทั้งกะที่ปิดไปแล้ว และป้องกันการดีเลย์ของข้อมูลด่าน
    const defaultStart = isoFromSerial(todaySerial - 4);
    const defaultEnd = isoFromSerial(todaySerial - 1);

    const sDate =
      typeof req.query.startDate === "string" && req.query.startDate.trim()
        ? req.query.startDate.trim()
        : defaultStart;
    const eDate =
      typeof req.query.endDate === "string" && req.query.endDate.trim()
        ? req.query.endDate.trim()
        : defaultEnd;

    // คำนวณและบันทึก Snapshot เข้า Accounting_Daily_Summary และ Accounting_Ticket_Archive อัตโนมัติ
    const data = await getRevenueReconciliationData({
      startDate: sDate,
      endDate: eDate,
      autoArchive: true,
    });

    return res.status(200).json({
      ok: true,
      message: "บันทึกข้อมูลตั๋วด่านและกระทบยอดเข้า Accounting Archive ถาวรเรียบร้อยแล้ว",
      triggeredBy: isCronAuthorized ? "cron" : "user",
      dateRange: {
        startDate: sDate,
        endDate: eDate,
        days: data.dateRange.days,
      },
      stats: {
        totalTicketsArchived: data.totals.totalTickets,
        totalCashArchived: data.totals.totalCash,
        earnedTodayArchived: data.totals.earnedToday,
        advanceTomorrowArchived: data.totals.advanceTomorrow,
        surplusArchived: data.totals.surplus,
        shortfallArchived: data.totals.shortfall,
        customersCount: data.totals.customerCount,
      },
      timestamp: new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
        timeZone: "Asia/Bangkok",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date()),
    });
  } catch (error) {
    console.error("Cron Accounting Archive Error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "เกิดข้อผิดพลาดในการประมวลผล Archive อัตโนมัติ",
    });
  }
}
