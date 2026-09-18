export const OPERATIONAL_TIME_BLOCKS = [
  { startTime: "07:00", label: "07:00–11:00", crossesMidnight: false },
  { startTime: "11:00", label: "11:00–15:00", crossesMidnight: false },
  { startTime: "15:00", label: "15:00–19:00", crossesMidnight: false },
  { startTime: "19:00", label: "19:00–23:00", crossesMidnight: false },
  { startTime: "23:00", label: "23:00–03:00 (+1)", crossesMidnight: true },
  { startTime: "03:00", label: "03:00–07:00 (+1)", crossesMidnight: true },
];

export const OPERATIONAL_TIME_VALUES = OPERATIONAL_TIME_BLOCKS.map((block) => block.startTime);

export function isOperationalTimeBlock(value) {
  return OPERATIONAL_TIME_VALUES.includes(String(value || ""));
}

export function addMonthsToIso(dateStr, months) {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return "";
  const result = new Date(Date.UTC(year, month - 1 + months, 1));
  const finalDay = Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate());
  result.setUTCDate(finalDay);
  return result.toISOString().slice(0, 10);
}

// ใช้ UTC เฉพาะสำหรับ "เลขวัน" เพื่อไม่ให้วันที่ถอย 1 วันเมื่อผู้ใช้เปิดจากเวลาไทย
export function addDaysToIso(dateStr, days) {
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  if (!year || !month || !day || !Number.isInteger(days)) return "";
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function getCurrentOperationalDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const date = new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day"))));
  if (Number(value("hour")) < 7) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function getNextOperationalDateIso(now = new Date()) {
  return addDaysToIso(getCurrentOperationalDateIso(now), 1);
}

export function formatBangkokTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  }
  const match = String(value).match(/T(\d{2}:\d{2})/) || String(value).match(/\s(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

// วันที่สำหรับสิทธิ์ระหว่างวันต้องอ้างอิง "รอบถัดไปที่ยังไม่เริ่ม":
// 00:00–02:59 ยังเตรียมรอบ 03:00 ของ operational day เดิม,
// 03:00–06:59 เตรียมรอบ 07:00 ของ operational day ใหม่
export function getUrgentAccessDefaultDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const date = new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day"))));
  if (Number(value("hour")) < 3) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function getBangkokCalendarDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function getBangkokMinutesAfterMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return (value("hour") * 60) + value("minute");
}

export function isBeforeOperationalBlockStart(accessDate, startTime, now = new Date()) {
  if (!accessDate || !isOperationalTimeBlock(startTime)) return false;
  const [hour, minute] = String(startTime).split(":").map(Number);
  const [year, month, day] = String(accessDate).split("-").map(Number);
  // Bangkok ไม่มี daylight-saving time และรอบ 03:00 อยู่วันปฏิทินถัดไป
  const target = new Date(Date.UTC(year, month - 1, day + (hour < 7 ? 1 : 0), hour - 7, minute));
  return now.getTime() < target.getTime();
}

export function getCurrentOperationalBlock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const minutes = (value("hour") * 60) + value("minute");
  const operationalMinutes = minutes < 420 ? minutes + 1440 : minutes;
  return OPERATIONAL_TIME_BLOCKS.find((block) => {
    const [hour, minute] = block.startTime.split(":").map(Number);
    const start = ((hour * 60) + minute) < 420 ? (hour * 60) + minute + 1440 : (hour * 60) + minute;
    return operationalMinutes >= start && operationalMinutes < start + 240;
  }) || OPERATIONAL_TIME_BLOCKS[0];
}

export function getPreviousOperationalBlock(startTime) {
  const index = OPERATIONAL_TIME_VALUES.indexOf(String(startTime || ""));
  return OPERATIONAL_TIME_BLOCKS[(index <= 0 ? OPERATIONAL_TIME_BLOCKS.length : index) - 1];
}
