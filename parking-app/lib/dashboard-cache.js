import { unstable_cache } from "next/cache";
import { getDashboardData, getPaymentRefreshState, getPaymentSnapshot } from "./sheets";

// Dashboard เป็นข้อมูลเดียวกันสำหรับผู้ใช้ที่ผ่านการยืนยันสิทธิ์แล้ว
// จึงเก็บผลฝั่ง server 60 วินาที เพื่อลดการอ่าน Google Sheet ซ้ำจากหลายเครื่อง
const getCachedDashboard = unstable_cache(
  async (date) => getDashboardData(date),
  ["parking-dashboard-data"],
  { revalidate: 60, tags: ["parking-dashboard"] }
);

const getCachedPaymentUpdate = unstable_cache(
  async (date) => {
    const [snapshot, refresh] = await Promise.all([getPaymentSnapshot(date), getPaymentRefreshState(date)]);
    return { date, status: snapshot ? "READY" : refresh?.status === "FAILED" ? "FAILED" : "UPDATING", snapshot, refresh };
  },
  ["parking-payment-update"],
  { revalidate: 60, tags: ["parking-dashboard"] }
);

export function getDashboardDataCached(date) {
  return getCachedDashboard(date);
}

export function getPaymentUpdateCached(date) {
  return getCachedPaymentUpdate(date);
}

export function invalidateDashboardCache() {
  // Pages Router API routes do not provide the static-generation store that
  // revalidateTag requires. Calling it after a successful write throws and
  // incorrectly tells the user that the booking failed. The 60-second cache
  // lifetime above is the intentional fallback for Dashboard and Mobile.
}
