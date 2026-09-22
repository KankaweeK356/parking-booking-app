import { getDashboardData, getPaymentRefreshState, getPaymentSnapshot } from "./sheets";

// Dashboard เป็นข้อมูลเดียวกันสำหรับผู้ใช้ที่ผ่านการยืนยันสิทธิ์แล้ว
// จึงเก็บผลฝั่ง server 60 วินาที เพื่อลดการอ่าน Google Sheet ซ้ำจากหลายเครื่อง
const CACHE_TTL_MS = 60 * 1000;
const FORCE_BUFFER_MS = 5 * 1000; // ป้องกันการกดย้ำใน 5 วินาที
const dashboardCache = new Map();
const paymentUpdateCache = new Map();
const inFlightDashboard = new Map();
const inFlightPaymentUpdate = new Map();

export async function getDashboardDataCached(date, { force = false } = {}) {
  const cacheKey = String(date || "");
  const now = Date.now();
  if (dashboardCache.has(cacheKey)) {
    const entry = dashboardCache.get(cacheKey);
    // หากไม่บังคับ force หรือเพิ่งดึงไปไม่เกิน 5 วินาที ให้ใช้ข้อมูลในแคชทันที
    if (!force && now - entry.timestamp < CACHE_TTL_MS) {
      return entry.data;
    }
    if (force && now - entry.timestamp < FORCE_BUFFER_MS) {
      return entry.data;
    }
  }

  // In-flight deduplication: หากมีคำขอกำลังดึงข้อมูลวันที่เดียวกันอยู่ ให้รอใช้ผลลัพธ์ร่วมกัน
  if (inFlightDashboard.has(cacheKey)) {
    return inFlightDashboard.get(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      const data = await getDashboardData(date);
      dashboardCache.set(cacheKey, { timestamp: Date.now(), data });
      return data;
    } finally {
      inFlightDashboard.delete(cacheKey);
    }
  })();

  inFlightDashboard.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export async function getPaymentUpdateCached(date, { force = false } = {}) {
  const cacheKey = String(date || "");
  const now = Date.now();
  if (paymentUpdateCache.has(cacheKey)) {
    const entry = paymentUpdateCache.get(cacheKey);
    if (!force && now - entry.timestamp < CACHE_TTL_MS) {
      return entry.data;
    }
    if (force && now - entry.timestamp < FORCE_BUFFER_MS) {
      return entry.data;
    }
  }

  if (inFlightPaymentUpdate.has(cacheKey)) {
    return inFlightPaymentUpdate.get(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      const [snapshot, refresh] = await Promise.all([getPaymentSnapshot(date), getPaymentRefreshState(date)]);
      const data = { date, status: snapshot ? "READY" : refresh?.status === "FAILED" ? "FAILED" : "UPDATING", snapshot, refresh };
      paymentUpdateCache.set(cacheKey, { timestamp: Date.now(), data });
      return data;
    } finally {
      inFlightPaymentUpdate.delete(cacheKey);
    }
  })();

  inFlightPaymentUpdate.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export function invalidateDashboardCache() {
  dashboardCache.clear();
  paymentUpdateCache.clear();
}

