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
