import { getDashboardData, getPaymentRefreshState, getPaymentSnapshot } from "./sheets";

// Dashboard เป็นข้อมูลเดียวกันสำหรับผู้ใช้ที่ผ่านการยืนยันสิทธิ์แล้ว
// จึงเก็บผลฝั่ง server 60 วินาที เพื่อลดการอ่าน Google Sheet ซ้ำจากหลายเครื่อง
const CACHE_TTL_MS = 60 * 1000;
const dashboardCache = new Map();
const paymentUpdateCache = new Map();

export async function getDashboardDataCached(date, { force = false } = {}) {
  const cacheKey = String(date || "");
  const now = Date.now();
  if (!force && dashboardCache.has(cacheKey)) {
    const entry = dashboardCache.get(cacheKey);
    if (now - entry.timestamp < CACHE_TTL_MS) {
      return entry.data;
    }
  }
  const data = await getDashboardData(date);
  dashboardCache.set(cacheKey, { timestamp: now, data });
  return data;
}

export async function getPaymentUpdateCached(date, { force = false } = {}) {
  const cacheKey = String(date || "");
  const now = Date.now();
  if (!force && paymentUpdateCache.has(cacheKey)) {
    const entry = paymentUpdateCache.get(cacheKey);
    if (now - entry.timestamp < CACHE_TTL_MS) {
      return entry.data;
    }
  }
  const [snapshot, refresh] = await Promise.all([getPaymentSnapshot(date), getPaymentRefreshState(date)]);
  const data = { date, status: snapshot ? "READY" : refresh?.status === "FAILED" ? "FAILED" : "UPDATING", snapshot, refresh };
  paymentUpdateCache.set(cacheKey, { timestamp: now, data });
  return data;
}

export function invalidateDashboardCache() {
  dashboardCache.clear();
  paymentUpdateCache.clear();
}
