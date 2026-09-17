import { revalidateTag, unstable_cache } from "next/cache";
import { getDashboardData } from "./sheets";

// Dashboard เป็นข้อมูลเดียวกันสำหรับผู้ใช้ที่ผ่านการยืนยันสิทธิ์แล้ว
// จึงเก็บผลฝั่ง server 60 วินาที เพื่อลดการอ่าน Google Sheet ซ้ำจากหลายเครื่อง
const getCachedDashboard = unstable_cache(
  async (date) => getDashboardData(date),
  ["parking-dashboard-data"],
  { revalidate: 60, tags: ["parking-dashboard"] }
);

export function getDashboardDataCached(date) {
  return getCachedDashboard(date);
}

export function invalidateDashboardCache() {
  revalidateTag("parking-dashboard");
}
