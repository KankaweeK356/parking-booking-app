// lib/sheets.js
// จุดเดียวที่คุยกับ Google Sheet ทั้งหมด — หน้าอื่นๆ ไม่ต้องรู้เรื่อง Google API เลย
//
// โครงสร้างชีตที่โค้ดนี้อ้างอิง:
//   Master            : Header แถว 1, ข้อมูลแถว 2+   [Doc_Id, ชื่อลูกค้า, สถานะ]
//   Slot_Master       : Header แถว 1, ข้อมูลแถว 2+   [Slot_Code, ลาน, หมายเลขช่อง, ตำแหน่ง, สถานะพื้นฐาน]
//   Booking_Input     : Header แถว 1, ข้อมูลแถว 2+   [ลูกค้า, Doc_Id, ลาน, ช่อง, วันเริ่ม, วันสิ้นสุด,
//                                                     วันสิ้นสุด effective, เวลาเริ่ม, เวลาสิ้นสุด, เหตุผล]
//   Slot_Status_Log   : Header แถว 1, ข้อมูลแถว 2+   [ลาน+ช่อง, การกระทำ, เหตุผล, Timestamp]
//   Required_Summary  : ดูจากรายงาน (คำนวณสดในแอป ไม่เขียนค่าทับชีต)
//   Booking_Change_Log: Header แถว 1, ข้อมูลแถว 2+   [เวลาที่แก้ไข, การกระทำ, ลูกค้า, ลาน, ช่อง, RowNumber, วันเริ่มเดิม, วันสิ้นสุดเดิม, เวลาเริ่มเดิม, วันเริ่มใหม่, วันสิ้นสุดใหม่, เวลาเริ่มใหม่]
//   tbt_DailyFee (Transection): Header แถว 1, ข้อมูลแถว 2+ [BoothCode, Docdate, Quantity, CreateDate]

import { google } from "googleapis";
import { formatBangkokDateTime, getBangkokCalendarDateIso, getCurrentOperationalBlock, getCurrentOperationalDateIso, getUrgentAccessDefaultDateIso, isBeforeOperationalBlockStart, isOperationalTimeBlock } from "./operational-day.js";
import { calculateTicketAmount, TICKET_PRICE_PER_UNIT } from "./ticket-pricing.js";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const BOOKING_FIRST_ROW = 2;
const MASTER_FIRST_ROW = 2;
const SLOT_FIRST_ROW = 2;
const SLOT_LOG_FIRST_ROW = 2;
let knownSheetNames = null;
let loadingSheetNames = null;
const pendingSheetEnsures = new Map();
let adjustmentLogHeadersReady = false;
let urgentLogHeadersReady = false;
let changeLogFormattingReady = false;
let adjustmentLogFormattingReady = false;

const GOOGLE_SHEETS_EPOCH = Date.UTC(1899, 11, 30); // 1899-12-30
const MS_PER_DAY = 86400000;
export const FAR_FUTURE_SERIAL = 73050; // 2099-12-31
const OPERATIONAL_DAY_START_MINUTES = 7 * 60;

function toOperationalMinutes(clockMinutes) {
  return clockMinutes < OPERATIONAL_DAY_START_MINUTES ? clockMinutes + 1440 : clockMinutes;
}

function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key || !SHEET_ID) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY ใน .env.local"
    );
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: "v4", auth });
}

export async function executeWithRetry(apiFn, { maxRetries = 3, baseDelayMs = 1500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await apiFn();
    } catch (err) {
      attempt++;
      const msg = String(err?.message || "").toLowerCase();
      const isRateLimit = err?.status === 429 || err?.code === 429 || msg.includes("quota exceeded") || msg.includes("ratelimitexceeded");
      const isTransient = err?.status === 503 || err?.code === 503 || err?.status === 500 || err?.code === 500;
      if ((isRateLimit || isTransient) && attempt <= maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.warn(`[Google Sheets API] Rate limit or transient error on attempt ${attempt}/${maxRetries}. Retrying in ${Math.round(delay)}ms... (${err.message})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

// ---------- Helper Functions สำหรับคำนวณ Serial Number ของ Google Sheet ----------

export function serialToDateOnly(serial) {
  if (serial === null || serial === undefined || serial === "") return null;
  const num = typeof serial === "number" ? serial : Number(serial);
  if (isNaN(num)) return null;
  return Math.floor(num);
}

export function serialToMinutes(serial) {
  if (serial === null || serial === undefined || serial === "") return 0;
  if (typeof serial === "string" && serial.includes(":")) {
    const [h, m] = serial.split(":").map(Number);
    return ((h || 0) * 60 + (m || 0)) % 1440;
  }
  const num = Number(serial);
  if (isNaN(num)) return 0;
  const frac = num - Math.floor(num);
  return Math.round(frac * 24 * 60) % 1440;
}

export function isoDateToSerial(isoStr) {
  if (!isoStr) return null;
  if (typeof isoStr === "number") return Math.floor(isoStr);
  const parts = String(isoStr).trim().split("-");
  if (parts.length < 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return null;
  const ms = Date.UTC(y, m - 1, d) - GOOGLE_SHEETS_EPOCH;
  return Math.round(ms / MS_PER_DAY);
}

export function isoFromSerial(serial) {
  if (serial === null || serial === undefined || serial === "") return "";
  if (typeof serial === "string" && /^\d{4}-\d{2}-\d{2}$/.test(serial.trim())) {
    return serial.trim();
  }
  const num = Number(serial);
  if (isNaN(num) || num <= 0) return "";
  const date = new Date(GOOGLE_SHEETS_EPOCH + Math.floor(num) * MS_PER_DAY);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function minutesToTimeStr(minutes) {
  if (minutes === null || minutes === undefined || isNaN(minutes)) return "";
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeLogDate(val) {
  if (!val) return "";
  if (typeof val === "number") return isoFromSerial(val);
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const num = Number(s);
  if (!isNaN(num) && num > 30000 && num < 80000) {
    return isoFromSerial(num);
  }
  return s;
}

export function normalizeLogTime(val) {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") {
    if (val < 1) return minutesToTimeStr(serialToMinutes(val));
    return minutesToTimeStr(val);
  }
  const s = String(val).trim();
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  }
  const num = Number(s);
  if (!isNaN(num)) {
    if (num < 1) return minutesToTimeStr(serialToMinutes(num));
    if (num <= 1440) return minutesToTimeStr(num);
  }
  return s;
}

export function getTodaySerial() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return isoDateToSerial(`${y}-${m}-${d}`);
}

export function addDaysIso(isoStr, days) {
  const serial = isoDateToSerial(isoStr);
  if (!serial) return "";
  return isoFromSerial(serial + days);
}

export function parseTransactionDateSerial(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return serialToDateOnly(val);
  const s = String(val).trim();
  if (!s) return null;
  const num = Number(s);
  if (!isNaN(num) && num > 30000 && num < 80000 && !s.includes("-") && !s.includes("/")) {
    return Math.floor(num);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return isoDateToSerial(s.slice(0, 10));
  }
  const firstPart = s.split(/[\sT]+/)[0];
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(firstPart)) {
    const [d, m, y] = firstPart.split("/");
    return isoDateToSerial(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }
  return isoDateToSerial(firstPart);
}

export function parseTransactionQuantity(val) {
  if (val === undefined || val === null || String(val).trim() === "") return 1;
  const num = Math.floor(Number(val));
  if (!isNaN(num) && num > 0) return num;
  const cleaned = String(val).replace(/[^\d.]/g, "").trim();
  const fallbackNum = Math.floor(Number(cleaned));
  if (!isNaN(fallbackNum) && fallbackNum > 0 && !String(val).includes("-")) return fallbackNum;
  return 1;
}

// ตรวจสอบว่าข้อความในคอลัมน์เหตุผลถือเป็น Closing reason (ปิด/ยกเลิก/ย้ายออกไปแล้ว) หรือไม่
// ใช้เฉพาะในหน้า Edit Booking และ Slot Status (linked bookings) เท่านั้น
export function isClosingReason(reason) {
  const r = String(reason || "");
  return r.includes("ยกเลิก") || r.includes("ย้ายออก") || r.includes("ปิดช่อง");
}

// ---------- Tbt_ServiceCharge (รายชื่อลูกค้าที่ MIS อนุญาตให้จอง) ----------

let masterListCache = { data: null, expiresAt: 0 };
export async function getMasterList() {
  const now = Date.now();
  if (masterListCache.data && masterListCache.expiresAt > now) {
    return masterListCache.data;
  }
  const sheets = getSheetsClient();
  const res = await executeWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Tbt_ServiceCharge!A1:Z",
    valueRenderOption: "UNFORMATTED_VALUE",
  }));
  const rows = res.data.values || [];
  if (rows.length < 2) throw new Error("ข้อมูลลูกค้าจาก MIS กำลังอัปเดต กรุณากด Refresh อีกครั้ง");
  const headers = rows[0].map((value) => String(value || "").trim().toLowerCase());
  const docIdIdx = headers.indexOf("docid");
  const nameIdx = headers.indexOf("description");
  if (docIdIdx === -1 || nameIdx === -1) throw new Error('ไม่พบคอลัมน์ "DocId" หรือ "Description" ใน Tbt_ServiceCharge');
  const customers = rows.slice(1)
    .filter((r) => r[docIdIdx] && r[nameIdx])
    .map((r) => ({ docId: String(r[docIdIdx]).trim(), name: String(r[nameIdx]).trim(), status: "Normal" }));
  if (customers.length === 0) throw new Error("ข้อมูลลูกค้าจาก MIS กำลังอัปเดต กรุณากด Refresh อีกครั้ง");
  masterListCache = { data: customers, expiresAt: now + 60 * 1000 };
  return customers;
}

export async function lookupDocId(customerName) {
  const master = await getMasterList();
  const found = master.find((m) => m.name === customerName);
  return found ? found.docId : "";
}

// ---------- Employee accounts ----------
const EMPLOYEE_HEADERS = ["Employee_Id", "Name", "Department", "Role", "Active"];
const USER_HEADERS = ["Employee_Id", "Password_Hash", "Registered_At", "Last_Login_At", "Active", "Session_Version", "Must_Change_Password", "Temporary_Password_Expires_At"];
const RESET_HEADERS = ["Created_At", "Employee_Id", "Reset_By", "Expires_At", "Status"];

async function getKnownSheetNames(sheets) {
  if (knownSheetNames) return knownSheetNames;
  if (!loadingSheetNames) {
    loadingSheetNames = sheets.spreadsheets.get({ spreadsheetId: SHEET_ID }).then((meta) => {
      knownSheetNames = new Set((meta.data.sheets || []).map((sheet) => sheet.properties?.title));
      return knownSheetNames;
    }).finally(() => { loadingSheetNames = null; });
  }
  return loadingSheetNames;
}

async function ensureSheet(title, headers, firstRow) {
  const pending = pendingSheetEnsures.get(title);
  if (pending) return pending;

  const task = ensureSheetInternal(title, headers, firstRow);
  pendingSheetEnsures.set(title, task);
  try {
    return await task;
  } finally {
    pendingSheetEnsures.delete(title);
  }
}

async function ensureSheetInternal(title, headers, firstRow) {
  const sheets = getSheetsClient();
  await getKnownSheetNames(sheets);
  if (!knownSheetNames.has(title)) {
    let created = false;
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
      created = true;
    } catch (err) {
      // Another server instance may have created this tab between our metadata
      // read and addSheet call. It is safe to continue with that same tab.
      if (!String(err.message || err).includes("already exists")) throw err;
    }
    if (created) {
      await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${title}!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: [headers] } });
    }
    knownSheetNames.add(title);
  }
  if (title === "Employee_Directory") {
    const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${title}!A2:E`, valueRenderOption: "UNFORMATTED_VALUE" });
    if (!(existing.data.values || []).some((row) => String(row[0]) === "2709")) {
      await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `${title}!A${firstRow}:E`, valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [["2709", "กันต์กวี แก้วแกมคง", "พัฒนากระบวนการ", "Admin", "ใช้งาน"]] } });
    }
  }
}

export async function ensureAuthSheets() {
  await ensureSheet("Employee_Directory", EMPLOYEE_HEADERS, 2);
  await ensureSheet("User_Accounts", USER_HEADERS, 2);
  await ensureSheet("Password_Reset_Log", RESET_HEADERS, 2);
}

export async function getEmployeeDirectory() {
  await ensureAuthSheets();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Employee_Directory!A2:E", valueRenderOption: "UNFORMATTED_VALUE" });
  return (res.data.values || []).filter((row) => row[0]).map((row, index) => {
    const rawStatus = String(row[4] || "").trim().toLowerCase();
    const isInactive = ["ลาออก", "ระงับ", "ปิดใช้งาน", "ไม่ใช้งาน", "inactive", "false", "0"].includes(rawStatus);
    return {
      rowNumber: index + 2,
      employeeId: String(row[0]).trim(),
      name: String(row[1] || "").trim(),
      department: String(row[2] || "").trim(),
      role: String(row[3] || "Field").trim(),
      active: !isInactive,
    };
  });
}

export async function getUserAccounts() {
  await ensureAuthSheets();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "User_Accounts!A2:H", valueRenderOption: "UNFORMATTED_VALUE" });
  return (res.data.values || []).filter((row) => row[0]).map((row, index) => ({ rowNumber: index + 2, employeeId: String(row[0]).trim(), passwordHash: String(row[1] || ""), registeredAt: String(row[2] || ""), lastLoginAt: String(row[3] || ""), active: ["ใช้งาน", "active", "true", "1"].includes(String(row[4] || "").trim().toLowerCase()), sessionVersion: String(row[5] || "1"), mustChangePassword: ["ใช่", "true", "1"].includes(String(row[6] || "").trim().toLowerCase()), temporaryPasswordExpiresAt: String(row[7] || "") }));
}

export async function getEmployeeUser(employeeId) {
  const [employees, users] = await Promise.all([getEmployeeDirectory(), getUserAccounts()]);
  const employee = employees.find((item) => item.employeeId === String(employeeId));
  const account = users.find((item) => item.employeeId === String(employeeId));
  return employee ? { ...employee, account } : null;
}

export async function createUserAccount({ employeeId, passwordHash }) {
  const existing = await getEmployeeUser(employeeId);
  if (!existing) throw new Error("ไม่พบรหัสพนักงานในฐานข้อมูล กรุณาติดต่อ Admin");
  if (!existing.active) throw new Error("รหัสพนักงานนี้ถูกระงับการใช้งาน กรุณาติดต่อ Admin");
  if (existing.account) throw new Error("รหัสพนักงานนี้สมัครใช้งานแล้ว สามารถเข้าสู่ระบบได้เลย");
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "User_Accounts!A2:H", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [[employeeId, passwordHash, new Date().toISOString(), "", "ใช้งาน", "1", "ไม่", ""]] } });
  return getEmployeeUser(employeeId);
}

export async function updateUserAccount(employeeId, values) {
  const account = (await getUserAccounts()).find((item) => item.employeeId === String(employeeId));
  if (!account) throw new Error("ไม่พบบัญชีผู้ใช้");
  const sheets = getSheetsClient();
  const current = [account.employeeId, account.passwordHash, account.registeredAt, account.lastLoginAt, account.active ? "ใช้งาน" : "ปิดใช้งาน", account.sessionVersion, account.mustChangePassword ? "ใช่" : "ไม่", account.temporaryPasswordExpiresAt];
  const next = { passwordHash: current[1], lastLoginAt: current[3], active: current[4], sessionVersion: current[5], mustChangePassword: current[6], temporaryPasswordExpiresAt: current[7], ...values };
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `User_Accounts!A${account.rowNumber}:H${account.rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [[employeeId, next.passwordHash, current[2], next.lastLoginAt, next.active, next.sessionVersion, next.mustChangePassword, next.temporaryPasswordExpiresAt]] } });
}

export async function appendPasswordResetLog({ employeeId, resetBy }) {
  await ensureAuthSheets();
  const sheets = getSheetsClient();
  const now = new Date();
  const expiry = new Date(now.getTime() + 15 * 60 * 1000);
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Password_Reset_Log!A2:E", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [[now.toISOString(), employeeId, resetBy, expiry.toISOString(), "รหัสชั่วคราวออกแล้ว"]] } });
}

// ---------- Slot_Master (A:E) + Slot_Status_Log ----------
// A: Slot_Code, B: ลาน, C: หมายเลขช่อง, D: ตำแหน่ง, E: สถานะพื้นฐาน
let slotListCache = { data: null, expiresAt: 0 };
export function invalidateSlotListCache() { slotListCache = { data: null, expiresAt: 0 }; }

export async function getSlotList() {
  const now = Date.now();
  if (slotListCache.data && slotListCache.expiresAt > now) {
    return slotListCache.data;
  }
  const sheets = getSheetsClient();
  const res = await executeWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Master!A${SLOT_FIRST_ROW}:E`,
    valueRenderOption: "UNFORMATTED_VALUE",
  }));
  const rows = res.data.values || [];
  const slots = rows
    .filter((r) => r[0])
    .map((r) => ({
      slotCode: String(r[0]).trim(),
      lot: String(r[1] || "").trim(),
      number: String(r[2] || "").trim(),
      position: String(r[3] || "").trim(),
      baseStatus: String(r[4] || "เปิด").trim(),
    }));
  slotListCache = { data: slots, expiresAt: now + 60 * 1000 };
  return slots;
}

export async function getLots() {
  const slots = await getSlotList();
  return Array.from(new Set(slots.map((s) => s.lot).filter(Boolean))).sort();
}

export async function getSlotStatusMap() {
  const sheets = getSheetsClient();
  const res = await executeWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Status_Log!A${SLOT_LOG_FIRST_ROW}:D`,
    valueRenderOption: "UNFORMATTED_VALUE",
  }));
  const rows = res.data.values || [];
  const latestBySlot = {};
  for (const r of rows) {
    const [slotCodeRaw, actionRaw, reasonRaw, tsRaw] = r;
    const slotCode = slotCodeRaw ? String(slotCodeRaw).trim() : "";
    if (!slotCode) continue;
    const action = actionRaw ? String(actionRaw).trim() : "";
    const reason = reasonRaw ? String(reasonRaw).trim() : "";

    let tsNum = 0;
    if (typeof tsRaw === "number") {
      tsNum = tsRaw;
    } else if (typeof tsRaw === "string" && tsRaw) {
      const parsed = Date.parse(tsRaw);
      tsNum = isNaN(parsed) ? 0 : parsed;
    }

    const existing = latestBySlot[slotCode];
    if (!existing || tsNum >= existing.tsNum) {
      latestBySlot[slotCode] = {
        action,
        reason,
        ts: tsNum,
        tsNum,
        tsStr: typeof tsRaw === "number" ? isoFromSerial(tsRaw) : String(tsRaw || ""),
      };
    }
  }
  return latestBySlot;
}

// getSlotsWithStatus ตาม Apps Script Production
// สถานะปัจจุบันเริ่มจาก baseStatus
// หากมีรายการล่าสุดใน Slot_Status_Log ให้ action ล่าสุด override
// isRoad = baseStatus === "ปิด" && ไม่มี action "เปิด" มาทับ
export async function getSlotsWithStatus() {
  const [slots, statusMap] = await Promise.all([
    getSlotList(),
    getSlotStatusMap(),
  ]);

  return slots.map((s) => {
    const st = statusMap[s.slotCode];
    let currentStatus = s.baseStatus || "เปิด";
    let currentReason = "";
    if (st) {
      currentStatus = st.action;
      currentReason = st.reason;
    }
    const isRoad = s.baseStatus === "ปิด" && (!st || st.action !== "เปิด");
    return {
      slotCode: s.slotCode,
      lot: s.lot,
      number: s.number,
      position: s.position,
      baseStatus: s.baseStatus,
      status: currentStatus,
      reason: currentReason,
      isRoad,
    };
  });
}

export async function appendSlotStatusLog({ slotCode, action, reason, actor }) {
  const sheets = getSheetsClient();
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Slot_Status_Log!E1:F1", valueInputOption: "USER_ENTERED", requestBody: { values: [["Created_By_Employee_Id", "Created_By_Name"]] } });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `Slot_Status_Log!A${SLOT_LOG_FIRST_ROW}:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[slotCode, action, reason || "", timestamp, actor?.employeeId || "", actor?.name || ""]] },
  });
}

// ---------- Booking_Change_Log ----------

export async function ensureChangeLogSheet() {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const allSheets = meta.data.sheets || [];
  let changeLogSheet = allSheets.find((s) => s.properties?.title === "Booking_Change_Log");
  if (!changeLogSheet) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: "Booking_Change_Log",
              },
            },
          },
        ],
      },
    });
    changeLogSheet = addRes.data.replies?.[0]?.addSheet;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Booking_Change_Log!A1:L1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          "เวลาที่แก้ไข", "การกระทำ", "ลูกค้า", "ลาน", "ช่อง", "RowNumber",
          "วันเริ่มเดิม", "วันสิ้นสุดเดิม", "เวลาเริ่มเดิม",
          "วันเริ่มใหม่", "วันสิ้นสุดใหม่", "เวลาเริ่มใหม่",
        ]],
      },
    });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Booking_Change_Log!M1:N1", valueInputOption: "USER_ENTERED", requestBody: { values: [["Created_By_Employee_Id", "Created_By_Name"]] } });

  const sheetId = changeLogSheet?.properties?.sheetId;
  if (sheetId !== undefined && !changeLogFormattingReady) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            // คอลัมน์ A (เวลาที่แก้ไข): DATE_TIME
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
                cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd hh:mm:ss" } } },
                fields: "userEnteredFormat.numberFormat",
              },
            },
            // คอลัมน์ F (RowNumber): NUMBER
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 },
                cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } },
                fields: "userEnteredFormat.numberFormat",
              },
            },
            // คอลัมน์ G, H (วันเริ่มเดิม, วันสิ้นสุดเดิม): DATE dd/mm/yyyy
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 8 },
                cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
                fields: "userEnteredFormat.numberFormat",
              },
            },
            // คอลัมน์ I (เวลาเริ่มเดิม): TIME hh:mm
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 },
                cell: { userEnteredFormat: { numberFormat: { type: "TIME", pattern: "hh:mm" } } },
                fields: "userEnteredFormat.numberFormat",
              },
            },
            // คอลัมน์ J, K (วันเริ่มใหม่, วันสิ้นสุดใหม่): DATE dd/mm/yyyy
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 9, endColumnIndex: 11 },
                cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
                fields: "userEnteredFormat.numberFormat",
              },
            },
            // คอลัมน์ L (เวลาเริ่มใหม่): TIME hh:mm
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: 11, endColumnIndex: 12 },
                cell: { userEnteredFormat: { numberFormat: { type: "TIME", pattern: "hh:mm" } } },
                fields: "userEnteredFormat.numberFormat",
              },
            },
          ],
        },
      });
      changeLogFormattingReady = true;
    } catch (e) {
      console.warn("Could not apply change log column formatting:", e.message);
    }
  }
}

export async function appendBookingChangeLog({
  action,
  customer,
  lot,
  slot,
  rowNumber,
  oldStartDate = "",
  oldEndDate = "",
  oldStartTime = "",
  newStartDate = "",
  newEndDate = "",
  newStartTime = "",
  actor,
}) {
  await ensureChangeLogSheet();
  const sheets = getSheetsClient();
  const timestamp = formatBangkokDateTime(new Date());
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Booking_Change_Log!A:N",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        timestamp,
        action,
        customer,
        lot,
        slot,
        Number(rowNumber) || rowNumber,
        normalizeLogDate(oldStartDate),
        normalizeLogDate(oldEndDate),
        normalizeLogTime(oldStartTime),
        normalizeLogDate(newStartDate),
        normalizeLogDate(newEndDate),
        normalizeLogTime(newStartTime),
        actor?.employeeId || "",
        actor?.name || "",
      ]],
    },
  });
}

// ---------- Booking_Adjustment_Log (ลดเฉพาะวัน) ----------
export async function ensureAdjustmentLogSheet() {
  await ensureSheet("Booking_Adjustment_Log", ["Created_At", "Effective_Date", "Action", "Booking_Row_Number", "Reason"], 2);
  if (!adjustmentLogHeadersReady) {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Booking_Adjustment_Log!F1:H1", valueInputOption: "USER_ENTERED", requestBody: { values: [["Created_By_Employee_Id", "Created_By_Name", "End_Date"]] } });
    adjustmentLogHeadersReady = true;
  }
  if (!adjustmentLogFormattingReady) {
    try {
      const sheets = getSheetsClient();
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
      const sheet = (meta.data.sheets || []).find((s) => s.properties?.title === "Booking_Adjustment_Log");
      const sheetId = sheet?.properties?.sheetId;
      if (sheetId !== undefined) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
                  cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd hh:mm:ss" } } },
                  fields: "userEnteredFormat.numberFormat",
                },
              },
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
                  cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
                  fields: "userEnteredFormat.numberFormat",
                },
              },
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
                  cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } },
                  fields: "userEnteredFormat.numberFormat",
                },
              },
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 1, startColumnIndex: 7, endColumnIndex: 8 },
                  cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
                  fields: "userEnteredFormat.numberFormat",
                },
              },
            ],
          },
        });
        adjustmentLogFormattingReady = true;
      }
    } catch (e) {
      console.warn("Could not apply adjustment log column formatting:", e.message);
    }
  }
}

export async function appendDailyAdjustments({ rowNumbers, effectiveDate, reason = "ลดสิทธิ์เฉพาะวัน", actor }) {
  await ensureAdjustmentLogSheet();
  const sheets = getSheetsClient();
  const timestamp = formatBangkokDateTime(new Date());
  const normDate = normalizeLogDate(effectiveDate);
  const rows = rowNumbers.map((rowNumber) => [timestamp, normDate, "ลดเฉพาะวัน", Number(rowNumber) || rowNumber, reason, actor?.employeeId || "", actor?.name || "", normDate]);
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Booking_Adjustment_Log!A2:H", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } });
}

export async function appendPauseAdjustments({ rowNumbers, startDate, endDate, reason = "พักการจอง", actor }) {
  if (!startDate || !endDate || isoDateToSerial(endDate) < isoDateToSerial(startDate)) throw new Error("ช่วงวันพักการจองไม่ถูกต้อง");
  await ensureAdjustmentLogSheet();
  const sheets = getSheetsClient();
  const timestamp = formatBangkokDateTime(new Date());
  const normStart = normalizeLogDate(startDate);
  const normEnd = normalizeLogDate(endDate);
  const rows = rowNumbers.map((rowNumber) => [timestamp, normStart, "พักการจอง", Number(rowNumber) || rowNumber, reason, actor?.employeeId || "", actor?.name || "", normEnd]);
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Booking_Adjustment_Log!A2:H", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } });
}

export async function getBookingAdjustments() {
  await ensureAdjustmentLogSheet();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Booking_Adjustment_Log!A2:H", valueRenderOption: "UNFORMATTED_VALUE" });
  return (res.data.values || []).map((row) => ({
    startDate: isoFromSerial(row[1]) || String(row[1] || ""),
    endDate: isoFromSerial(row[7]) || String(row[7] || "") || isoFromSerial(row[1]) || String(row[1] || ""),
    action: String(row[2] || ""), rowNumber: Number(row[3] || 0),
  })).filter((row) => row.rowNumber && row.startDate);
}

export async function getAdjustedBookingRows(dateStr) {
  const target = isoDateToSerial(dateStr);
  const adjustments = await getBookingAdjustments();
  return new Set(adjustments.filter((row) => (row.action.includes("ลด") || row.action.includes("พัก")) && isoDateToSerial(row.startDate) <= target && target <= isoDateToSerial(row.endDate)).map((row) => row.rowNumber));
}

// ---------- Urgent_Access_Log ----------
export async function ensureUrgentAccessLogSheet() {
  const sheets = getSheetsClient();
  await getKnownSheetNames(sheets);
  const exists = knownSheetNames.has("Urgent_Access_Log");
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: "Urgent_Access_Log" } } }] } });
    knownSheetNames.add("Urgent_Access_Log");
  }
  // ต่อท้ายคอลัมน์เดิมเท่านั้น เพื่อไม่ให้ MIS/formula ที่มีอยู่เสีย
  if (!urgentLogHeadersReady) {
    const headerRange = exists ? "Urgent_Access_Log!O1:P1" : "Urgent_Access_Log!A1:P1";
    const headerValues = exists ? [["Created_By_Employee_Id", "Created_By_Name"]] : [["Created_At", "Ticket_Issued_Date", "Access_Operational_Date", "Action_Type", "Customer", "Doc_Id", "Booking_Row_Number", "Lot", "Slot_Code", "Slot_Number", "Start_Time", "Ticket_Count", "Reason", "Note", "Created_By_Employee_Id", "Created_By_Name"]];
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: headerRange, valueInputOption: "USER_ENTERED", requestBody: { values: headerValues } });
    urgentLogHeadersReady = true;
  }
}

export async function getUrgentAccessLogs() {
  await ensureUrgentAccessLogSheet();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Urgent_Access_Log!A2:P", valueRenderOption: "UNFORMATTED_VALUE" });
  return (res.data.values || []).map((r) => ({ createdAt: String(r[0] || ""), ticketIssuedDate: typeof r[1] === "number" ? isoFromSerial(r[1]) : String(r[1] || ""), accessDate: typeof r[2] === "number" ? isoFromSerial(r[2]) : String(r[2] || ""), actionType: String(r[3] || ""), customer: String(r[4] || ""), docId: String(r[5] || ""), bookingRowNumber: Number(r[6] || 0), lot: String(r[7] || ""), slot: String(r[8] || ""), number: String(r[9] || ""), startTime: typeof r[10] === "number" ? minutesToTimeStr(serialToMinutes(r[10])) : String(r[10] || ""), ticketCount: Number(r[11] || 1), reason: String(r[12] || ""), note: String(r[13] || ""), createdByEmployeeId: String(r[14] || ""), createdByName: String(r[15] || "") }));
}

export async function appendUrgentAccessLogs({ customer, accessDate, entries, reason = "", note = "", actionType = "ตีตั๋วเพิ่มตามการจองเดิม", actor }) {
  if (!customer || !accessDate || !Array.isArray(entries) || entries.length === 0) throw new Error("กรอกข้อมูลสิทธิ์ระหว่างวันไม่ครบถ้วน");
  if (entries.some((entry) => !isBeforeOperationalBlockStart(accessDate, entry.startTime))) {
    throw new Error("บันทึกสิทธิ์ระหว่างวันได้เฉพาะก่อนเวลาเริ่มรอบที่เลือก");
  }
  await ensureUrgentAccessLogSheet();
  const docId = await lookupDocId(customer);
  const rows = entries.map((entry) => [new Date().toISOString(), getBangkokCalendarDateIso(), accessDate, actionType, customer, docId, entry.rowNumber || "", entry.lot || "", entry.slot, entry.number || "", entry.startTime, 1, reason, note, actor?.employeeId || "", actor?.name || ""]);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Urgent_Access_Log!A:P", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } });
  return { ok: true, count: rows.length };
}

// ---------- Booking_Input ----------

export function parseBookingRow(r, idx, masterMap) {
  const rawStart = r[4];
  const rawEnd = r[5];
  const rawEndEff = r[6];
  const rawStartTime = r[7];
  const rawEndTime = r[8];

  const startSerial = typeof rawStart === "number" ? serialToDateOnly(rawStart) : (rawStart ? isoDateToSerial(rawStart) : null);
  const endSerial = typeof rawEnd === "number" ? serialToDateOnly(rawEnd) : (rawEnd ? isoDateToSerial(rawEnd) : null);
  const endEffectiveSerial = typeof rawEndEff === "number" ? serialToDateOnly(rawEndEff) : (rawEndEff ? isoDateToSerial(rawEndEff) : (endSerial || FAR_FUTURE_SERIAL));

  const startStr = typeof rawStart === "number" ? isoFromSerial(rawStart) : (rawStart ? String(rawStart).trim() : "");
  const endStr = typeof rawEnd === "number" ? isoFromSerial(rawEnd) : (rawEnd ? String(rawEnd).trim() : "");
  const endEffectiveStr = typeof rawEndEff === "number" ? isoFromSerial(rawEndEff) : (rawEndEff ? String(rawEndEff).trim() : (endStr || ""));

  const rawStartMinutes = rawStartTime !== undefined && rawStartTime !== null && rawStartTime !== "" ? serialToMinutes(rawStartTime) : null;
  // Operational day runs from 07:00 to 07:00 next calendar day. 00:00–06:59 belong at its end.
  const startMinutes = rawStartMinutes !== null ? toOperationalMinutes(rawStartMinutes) : null;
  const endMinutes = startMinutes !== null ? startMinutes + 240 : null;

  const startTimeStr = startMinutes !== null ? minutesToTimeStr(startMinutes) : (rawStartTime ? String(rawStartTime).trim() : "");
  const endTimeStr = endMinutes !== null ? minutesToTimeStr(endMinutes) : (rawEndTime ? String(rawEndTime).trim() : "");

  const customer = r[0] ? String(r[0]).trim() : "";
  const rawDocId = r[1] !== undefined && r[1] !== null ? String(r[1]).trim() : "";
  const docId = rawDocId || (masterMap && customer ? (masterMap.get(customer) || "") : "");

  return {
    rowNumber: BOOKING_FIRST_ROW + idx,
    customer,
    docId,
    lot: r[2] ? String(r[2]).trim() : "",
    slot: r[3] ? String(r[3]).trim() : "",
    startDate: startStr,
    endDate: endStr,
    endDateEffective: endEffectiveStr,
    startTime: startTimeStr,
    endTime: endTimeStr,
    reason: r[9] ? String(r[9]).trim() : "",
    bookingType: r[12] ? String(r[12]).trim() : "Normal",
    startSerial,
    endSerial,
    endEffectiveSerial,
    startMinutes,
    endMinutes,
  };
}

export async function getAllBookingRows() {
  const sheets = getSheetsClient();
  const res = await executeWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Booking_Input!A${BOOKING_FIRST_ROW}:M`,
    valueRenderOption: "UNFORMATTED_VALUE",
  }));
  const rows = res.data.values || [];

  let masterMap = null;
  const hasEmptyDocId = rows.some((r) => r[0] && (!r[1] || !String(r[1]).trim()));
  if (hasEmptyDocId) {
    const masterList = await getMasterList();
    masterMap = new Map();
    masterList.forEach((m) => {
      masterMap.set(m.name, m.docId);
    });
  }

  return rows.map((r, idx) => parseBookingRow(r, idx, masterMap));
}

export async function getBookingRow(rowNumber) {
  const all = await getAllBookingRows();
  return all.find((r) => r.rowNumber === Number(rowNumber)) || null;
}

// รายการจองที่ยัง Active ของลูกค้าคนหนึ่ง — ใช้ในหน้า "ปรับ/ยกเลิกการจอง"
// ซ่อนเฉพาะรายการที่มี closing reason (เช่น ยกเลิก, ย้ายออก, ปิดช่อง) เท่านั้น
export async function getActiveBookingsForCustomer(customerName) {
  const [all, adjustments] = await Promise.all([getAllBookingRows(), getBookingAdjustments()]);
  const today = getTodaySerial();
  return all
    .filter((r) => {
      if (r.customer !== customerName) return false;
      const endEff = r.endEffectiveSerial !== null && r.endEffectiveSerial !== undefined ? r.endEffectiveSerial : FAR_FUTURE_SERIAL;
      if (endEff < today) return false;
      if (isClosingReason(r.reason)) return false;
      return true;
    })
    .map((booking) => ({
      ...booking,
      pausePeriods: adjustments
        .filter((adjustment) => adjustment.rowNumber === booking.rowNumber && adjustment.action.includes("พัก") && isoDateToSerial(adjustment.endDate) >= today)
        .map((adjustment) => ({ startDate: adjustment.startDate, endDate: adjustment.endDate })),
    }))
    .sort((a, b) => (a.startSerial || 0) - (b.startSerial || 0));
}

// รายการจองที่ Active ของช่องหนึ่ง — ใช้เตือนตอน CS จะกดปิดช่อง
// ซ่อนเฉพาะรายการที่มี closing reason
export async function getActiveBookingsForSlot(slotCode) {
  const all = await getAllBookingRows();
  const today = getTodaySerial();
  return all.filter((r) => {
    if (String(r.slot) !== String(slotCode)) return false;
    const endEff = r.endEffectiveSerial !== null && r.endEffectiveSerial !== undefined ? r.endEffectiveSerial : FAR_FUTURE_SERIAL;
    if (endEff < today) return false;
    if (isClosingReason(r.reason)) return false;
    return true;
  });
}

// ตรวจสอบการชนกันของเวลา (Conflict Check)
// กฎ: ตัดสินจากช่วงวันและเวลาทับกันเท่านั้น ไม่นำคอลัมน์เหตุผลมาตัดสินหรือข้ามแถว
export async function findConflict({ slot, startDate, endDate, startTime, excludeRowNumber }) {
  const [all, adjustments] = await Promise.all([getAllBookingRows(), getBookingAdjustments()]);
  const newStart = typeof startDate === "number" ? serialToDateOnly(startDate) : isoDateToSerial(startDate);
  const newEnd = endDate ? (typeof endDate === "number" ? serialToDateOnly(endDate) : isoDateToSerial(endDate)) : FAR_FUTURE_SERIAL;
  const rawNewStartMin = typeof startTime === "number" ? serialToMinutes(startTime) : (typeof startTime === "string" ? serialToMinutes(startTime) : 0);
  const newStartMin = toOperationalMinutes(rawNewStartMin);
  const newEndMin = newStartMin + 240;

  for (const r of all) {
    if (r.rowNumber === excludeRowNumber) continue;
    if (String(r.slot) !== String(slot)) continue;
    if (!r.startSerial) continue;
    // รายการที่ถูกยกเลิก/ปิดแล้ว ไม่นำมาตัดสิน conflict เพื่อให้สามารถจัดสรรช่องเดิมใหม่ได้
    if (isClosingReason(r.reason)) continue;

    const rStart = r.startSerial;
    const rEnd = r.endEffectiveSerial !== null && r.endEffectiveSerial !== undefined ? r.endEffectiveSerial : FAR_FUTURE_SERIAL;
    const dateOverlap = rStart <= newEnd && rEnd >= newStart;
    if (!dateOverlap) continue;

    const rStartMin = r.startMinutes !== null ? r.startMinutes : 0;
    const rEndMin = r.endMinutes !== null ? r.endMinutes : (rStartMin + 240);
    const timeOverlap = rStartMin < newEndMin && newStartMin < rEndMin;
    if (timeOverlap) {
      // A paused booking deliberately releases its slot.  It still conflicts on
      // every date outside that pause interval, so check the actual overlap.
      const pauses = adjustments.filter((item) => item.rowNumber === r.rowNumber && (item.action.includes("ลด") || item.action.includes("พัก")));
      let hasActiveDate = false;
      for (let day = Math.max(rStart, newStart); day <= Math.min(rEnd, newEnd); day += 1) {
        if (!pauses.some((pause) => isoDateToSerial(pause.startDate) <= day && day <= isoDateToSerial(pause.endDate))) { hasActiveDate = true; break; }
      }
      if (!hasActiveDate) continue;
      return { conflict: true, withCustomer: r.customer, withSlot: r.slot };
    }
  }
  return { conflict: false };
}

// จองใหม่แบบหลายช่องพร้อมกัน (Multi-Slot Batch Booking)
// ตรวจสอบสถานะและ Time Conflict ทุกช่องล่วงหน้าก่อนบันทึก
// ช่องที่ baseStatus เป็นปิด หรือ status เป็นปิด ต้องห้ามจอง แม้ยังไม่มี Slot_Status_Log
// ใช้ append ต่อท้ายตาม Apps Script production
export async function createBookingBatch({ customer, lot, slots, startDate, endDate, startTime, startTimes, reason = "จองใหม่", actor, bookingType = "Normal" }) {
  const slotList = Array.isArray(slots) ? slots : [slots];
  const timeList = Array.isArray(startTimes) && startTimes.length > 0 ? startTimes : [startTime];
  if (!customer || !lot || slotList.length === 0 || !startDate || !endDate || timeList.some((time) => !time)) {
    throw new Error("กรอกข้อมูลไม่ครบถ้วน (ลูกค้า, ลาน, ช่อง, วันเริ่ม, วันสิ้นสุด, รอบเวลา)");
  }
  if (isoDateToSerial(endDate) < isoDateToSerial(startDate)) {
    throw new Error("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");
  }
  if (bookingType === "Normal" && isoDateToSerial(startDate) < isoDateToSerial(addDaysIso(getBangkokCalendarDateIso(), 1))) {
    throw new Error("การจองใหม่เริ่มใช้ได้เร็วสุดวันถัดไปของวันปฏิทินปัจจุบัน");
  }
  if (timeList.some((time) => !isOperationalTimeBlock(time))) {
    throw new Error("รอบเวลาต้องเป็นหนึ่งใน 6 รอบของ operational day (เริ่ม 07:00)");
  }

  // 1. ตรวจสอบช่องซ้ำในชุดที่ส่งมา
  const uniqueSlots = Array.from(new Set(slotList));
  if (uniqueSlots.length !== slotList.length) {
    throw new Error("มีช่องจอดซ้ำกันในรายการที่เลือก");
  }
  const uniqueTimes = Array.from(new Set(timeList));
  if (uniqueTimes.length !== timeList.length) throw new Error("มีรอบเวลาซ้ำกันในรายการที่เลือก");

  // 2. ดึงสถานะรวม (baseStatus + Slot_Status_Log) และตรวจสอบล่วงหน้าทุกช่อง
  const slotsWithStatus = await getSlotsWithStatus();
  const statusMap = {};
  slotsWithStatus.forEach((s) => {
    statusMap[s.slotCode] = s;
  });

  // ช่องใน booking เดียวกันต้องมีลำดับคงที่ตามหมายเลขช่อง ไม่ขึ้นกับลำดับที่ CS คลิก
  const orderedSlotList = [...slotList].sort((left, right) => String(statusMap[left]?.number || left).localeCompare(String(statusMap[right]?.number || right), "th", { numeric: true }));
  const orderedTimeList = [...timeList].sort((left, right) => toOperationalMinutes(serialToMinutes(left)) - toOperationalMinutes(serialToMinutes(right)));

  // สิทธิ์ระหว่างวันไม่ใช้ conflict ของรายการจองปกติโดยตรง เพราะรายการ
  // ที่ยังไม่ชำระสำหรับวันปฏิบัติการนี้ต้องปล่อยช่องว่างให้จองรายวันได้
  let urgentOccupiedKeys = null;
  if (bookingType === "Urgent") {
    if (startDate !== endDate || orderedTimeList.length !== 1) {
      throw new Error("จองรายวันบันทึกได้ครั้งละ 1 รอบของวันปฏิบัติการปัจจุบัน");
    }
    const dashboard = await getDashboardData(startDate);
    if (dashboard.paymentStatus !== "READY") {
      throw new Error("ข้อมูลสถานะการชำระเงินยังไม่พร้อม กรุณารอหรืออัปเดตข้อมูลใหม่");
    }
    urgentOccupiedKeys = new Set((dashboard.bookings || []).map((booking) => `${booking.slot}::${booking.startTime}`));
  }

  for (const slot of orderedSlotList) {
    const slotInfo = statusMap[slot];
    if (!slotInfo || slotInfo.status === "ปิด" || slotInfo.isRoad) {
      throw new Error(`ช่อง ${slot} ถูกปิดใช้งานอยู่ (${slotInfo?.reason || "สถานะพื้นฐานปิดใช้งาน"}) ไม่สามารถจองได้`);
    }
    for (const time of orderedTimeList) {
      if (urgentOccupiedKeys?.has(`${slot}::${time}`)) {
        throw new Error(`ช่อง ${slot} รอบ ${time} มีการจองแล้ว`);
      }
      if (bookingType === "Urgent") continue;
      const conflict = await findConflict({ slot, startDate, endDate, startTime: time });
      if (conflict.conflict) {
        throw new Error(`ช่อง ${slot} ช่วงเวลา ${time} ชนกับการจองของ "${conflict.withCustomer}" แล้ว`);
      }
    }
  }

  // 3. เตรียมข้อมูลและบันทึกแบบ Batch Append ต่อท้ายชีตตาม Production
  const docId = await lookupDocId(customer);
  const endEff = endDate;
  const rowsToAppend = orderedSlotList.flatMap((slot) => orderedTimeList.map((time) => {
    const startMin = toOperationalMinutes(serialToMinutes(time));
    return [customer, docId, lot, slot, startDate, endDate, endEff, time, minutesToTimeStr(startMin + 240), reason, actor?.employeeId || "", actor?.name || "", bookingType];
  }));

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Booking_Input!K1:M1", valueInputOption: "USER_ENTERED", requestBody: { values: [["Created_By_Employee_Id", "Created_By_Name", "Booking_Type"]] } });
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Booking_Input!A:M",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rowsToAppend,
    },
  });

  return { ok: true, count: rowsToAppend.length, updatedRange: res.data.updates?.updatedRange };
}

export async function createBooking(params) {
  return createBookingBatch({
    ...params,
    slots: [params.slot],
  });
}

// ปิดแถวเดิม (ยกเลิก / ลดจำนวนช่อง) พร้อมบันทึก Booking_Change_Log
export async function closeBookingRow({ rowNumber, endDate, reason, actor }) {
  const sheets = getSheetsClient();
  const oldRow = await getBookingRow(rowNumber);
  const isVoid = String(reason || "").includes("คีย์ผิด");
  // กำหนดวันสิ้นสุดล่วงหน้าและย้ายช่องต้องยังคงสิทธิ์เดิมไว้จนถึงวันสิ้นสุดจริง
  // จึงไม่ใช้ closing reason ที่ทำให้ Dashboard ซ่อนรายการทันที
  // ส่วนกรณี "ยกเลิก (คีย์ผิด)" ให้ใช้เป็น closing reason เพื่อให้ซ่อนทันที
  const bookingReason = isVoid
    ? "ยกเลิก (คีย์ผิด)"
    : String(reason || "").includes("ยกเลิก")
      ? "กำหนดวันสิ้นสุดสิทธิ์"
      : String(reason || "").includes("ย้ายออก")
        ? "สิทธิ์สิ้นสุดเนื่องจากย้ายช่อง"
        : reason;

  const targetEndDate = isVoid
    ? (endDate || addDaysIso(getBangkokCalendarDateIso(), -1))
    : endDate;

  await appendBookingChangeLog({
    action: isVoid ? "ยกเลิก (คีย์ผิด)" : (reason || "ปิด/ยกเลิก"),
    customer: oldRow?.customer || "",
    lot: oldRow?.lot || "",
    slot: oldRow?.slot || "",
    rowNumber,
    oldStartDate: oldRow?.startDate || "",
    oldEndDate: oldRow?.endDate || "",
    oldStartTime: oldRow?.startTime || "",
    newStartDate: oldRow?.startDate || "",
    newEndDate: targetEndDate,
    newStartTime: oldRow?.startTime || "",
    actor,
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `Booking_Input!F${rowNumber}:G${rowNumber}`, values: [[targetEndDate, targetEndDate]] },
        { range: `Booking_Input!J${rowNumber}`, values: [[bookingReason]] },
      ],
    },
  });
  return { ok: true };
}

export async function closeMultipleBookingRows(rowNumbers, endDate, reason, actor) {
  const outcomes = [];
  for (const rn of rowNumbers) {
    try {
      await closeBookingRow({ rowNumber: rn, endDate, reason, actor });
      outcomes.push({ rowNumber: rn, ok: true });
    } catch (err) {
      outcomes.push({ rowNumber: rn, ok: false, error: err.message });
    }
  }
  return outcomes;
}

// ปรับวัน-เวลาจอง (Extend booking) ช่องเดิมตรงๆ
export async function extendBooking({ rowNumber, lot, slot, startDate, endDate, startTime }) {
  const oldRow = await getBookingRow(rowNumber);
  if (!oldRow) throw new Error(`ไม่พบรายการจองแถวที่ ${rowNumber}`);
  startDate = oldRow.startDate;
  startTime = oldRow.startTime;
  slot = oldRow.slot;
  lot = oldRow.lot;
  if (!endDate) throw new Error("ต้องระบุวันสิ้นสุด");
  if (!isOperationalTimeBlock(startTime)) {
    throw new Error("รอบเวลาต้องเป็นหนึ่งใน 6 รอบของ operational day (เริ่ม 07:00)");
  }
  if (endDate && isoDateToSerial(endDate) < isoDateToSerial(startDate)) {
    throw new Error("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");
  }

  // 1. เช็คสถานะช่องจาก getSlotsWithStatus
  const slotsWithStatus = await getSlotsWithStatus();
  const slotInfo = slotsWithStatus.find((s) => s.slotCode === slot);
  if (!slotInfo || slotInfo.status === "ปิด" || slotInfo.isRoad) {
    throw new Error(`ช่อง ${slot} ถูกปิดใช้งานอยู่ (${slotInfo?.reason || "สถานะพื้นฐานปิดใช้งาน"}) ไม่สามารถแก้ไขได้`);
  }

  // 2. เช็คเวลาชนกัน โดยไม่นับแถวตัวเอง
  const conflict = await findConflict({
    slot,
    startDate,
    endDate,
    startTime,
    excludeRowNumber: Number(rowNumber),
  });
  if (conflict.conflict) {
    throw new Error(`ช่วงเวลานี้ชนกับการจองของ "${conflict.withCustomer}" แล้ว`);
  }

  // 3. บันทึก log ก่อนเขียนทับ
  await appendBookingChangeLog({
    action: "ปรับวันสิ้นสุด",
    customer: oldRow.customer,
    lot: lot || oldRow.lot,
    slot: slot || oldRow.slot,
    rowNumber,
    oldStartDate: oldRow.startDate,
    oldEndDate: oldRow.endDate,
    oldStartTime: oldRow.startTime,
    newStartDate: startDate,
    newEndDate: endDate || "",
    newStartTime: startTime,
  });

  // 4. แก้ไขแถวเดิมตรงๆ
  const startMin = serialToMinutes(startTime);
  const endMin = startMin + 240;
  const endTimeStr = minutesToTimeStr(endMin);
  const endEff = endDate || "2099-12-31";

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Booking_Input!E${rowNumber}:J${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[startDate, endDate, endEff, startTime, endTimeStr, "ปรับวันสิ้นสุด"]],
    },
  });

  return { ok: true };
}

// ย้ายช่องจอดอย่างปลอดภัย: ตรวจสอบความพร้อมของช่องใหม่ก่อนเสมอ
export async function changeSlot({
  oldRowNumber,
  oldEndDate,
  customer,
  newLot,
  newSlot,
  newStartDate,
  newEndDate,
  newStartTime,
  actor,
}) {
  const oldRow = await getBookingRow(oldRowNumber);
  if (!oldRow) throw new Error(`ไม่พบรายการจองเดิมแถวที่ ${oldRowNumber}`);
  const nextOperationalDate = addDaysIso(getCurrentOperationalDateIso(), 1);
  // A future booking must never be moved to a date before its original start.
  // This keeps the normal 07:00 next-day rule while preserving a future plan.
  const requestedStart = String(newStartDate || "");
  const earliestStart = oldRow.startDate > nextOperationalDate ? oldRow.startDate : nextOperationalDate;
  const effectiveNewStartDate = requestedStart > earliestStart ? requestedStart : earliestStart;
  const effectiveOldEndDate = addDaysIso(effectiveNewStartDate, -1);
  const effectiveNewEndDate = newEndDate || oldRow.endDate;
  const effectiveNewStartTime = oldRow.startTime;
  if (!effectiveNewEndDate) throw new Error("รายการเดิมไม่มีวันสิ้นสุด จึงยังย้ายช่องตามกติกาใหม่ไม่ได้");
  if (effectiveNewStartDate > effectiveNewEndDate) throw new Error("สิทธิ์เดิมสิ้นสุดก่อนวันที่ย้ายช่อง จึงไม่สามารถย้ายได้");

  // 1. เช็คสถานะช่องใหม่จาก getSlotsWithStatus
  const slotsWithStatus = await getSlotsWithStatus();
  const slotInfo = slotsWithStatus.find((s) => s.slotCode === newSlot);
  if (!slotInfo || slotInfo.status === "ปิด" || slotInfo.isRoad) {
    throw new Error(`ช่อง ${slotInfo?.number || "-"} ถูกปิดใช้งานอยู่ (${slotInfo?.reason || "สถานะพื้นฐานปิดใช้งาน"}) ไม่สามารถย้ายไปได้`);
  }

  // 2. เช็คเวลาชนกันของช่องใหม่ก่อนเสมอ
  const conflict = await findConflict({
    slot: newSlot,
    startDate: effectiveNewStartDate,
    endDate: effectiveNewEndDate,
    startTime: effectiveNewStartTime,
  });
  if (conflict.conflict) {
    throw new Error(`ช่อง ${slotInfo.number || "-"} ช่วงเวลานี้ชนกับการจองของ "${conflict.withCustomer}" แล้ว กรุณาเลือกช่องอื่น`);
  }

  // 3. ปิดแถวเดิม
  await closeBookingRow({
    rowNumber: oldRowNumber,
    endDate: effectiveOldEndDate,
    reason: "ย้ายออก (เปลี่ยนช่องจอด)",
    actor,
  });

  // 4. สร้างการจองช่องใหม่
  const createResult = await createBookingBatch({
    customer,
    lot: newLot,
    slots: [newSlot],
    startDate: effectiveNewStartDate,
    endDate: effectiveNewEndDate,
    startTime: effectiveNewStartTime,
    reason: "ย้ายเข้า (เปลี่ยนช่องจอด)",
    actor,
  });

  return { ok: true, createResult };
}

// ปิดช่องจอด + ปิดการจองที่ค้างอยู่ไปพร้อมกัน
export async function closeSlotWithBookings({ slotCode, reason, bookingRowNumbersToClose, actor }) {
  await appendSlotStatusLog({ slotCode, action: "ปิด", reason, actor });
  const today = isoFromSerial(getTodaySerial());
  const bookingResults = [];
  for (const rn of bookingRowNumbersToClose || []) {
    try {
      await closeBookingRow({ rowNumber: rn, endDate: today, reason: `ปิดช่อง: ${reason}`, actor });
      bookingResults.push({ rowNumber: rn, ok: true });
    } catch (err) {
      bookingResults.push({ rowNumber: rn, ok: false, error: err.message });
    }
  }
  return { ok: true, bookingResults };
}

// เปิดช่องจอดกลับมาใช้งาน
export async function openSlot(slotCode, actor) {
  await appendSlotStatusLog({ slotCode, action: "เปิด", reason: "", actor });
  return { ok: true };
}

// ---------- Required_Summary (คำนวณสด In-Memory เทียบ Apps Script Production) ----------
// กฎ Production: เมื่อเลือกวันที่ X ให้นับ booking ที่ active ในวัน X + 1 (เตรียมตั๋วล่วงหน้า 1 วัน)
// Active วัน X+1: startDate <= (X+1) && (X+1) <= endDateEffective
// รวมตาม docId/ชื่อลูกค้า และห้ามเขียนค่าลง Required_Summary!F1
export async function getRequiredSummary(dateStr) {
  const report = await getTicketReport(dateStr);
  return {
    selectedDate: report.selectedDate,
    targetDate: report.nextOperationalDate,
    date: report.nextOperationalDate,
    rows: report.rows.map((row) => ({ ...row, required: row.longTickets })),
  };
}

// รายงานตั๋วที่ CS ต้องจัดเตรียมใน "วันนี้" แยกชัดระหว่าง
// 1) ตั๋วจองระยะยาว: ตีวันนี้ เพื่อใช้สิทธิ์ในวันปฏิบัติการถัดไป
// 2) ตั๋วจองรายวัน: ตีและใช้สิทธิ์ในวันปฏิบัติการวันนี้
// ข้อมูลเป็นการคำนวณสดเท่านั้น ไม่มีการเขียนกลับลง Sheet
export async function getTicketReport(dateStr, customerName = "") {
  const selectedDate = dateStr || getBangkokCalendarDateIso();
  const selectedSerial = isoDateToSerial(selectedDate);
  if (!selectedSerial) throw new Error("วันที่ออกรายงานไม่ถูกต้อง");
  const nextOperationalDate = isoFromSerial(selectedSerial + 1);
  const [allBookings, adjustments, urgentLogs, slots] = await Promise.all([
    getAllBookingRows(),
    getBookingAdjustments(),
    getUrgentAccessLogs(),
    getSlotsWithStatus(),
  ]);
  const adjustedNextDayRows = new Set(
    adjustments
      .filter((row) => (row.action.includes("ลด") || row.action.includes("พัก")) && isoDateToSerial(row.startDate) <= selectedSerial + 1 && selectedSerial + 1 <= isoDateToSerial(row.endDate))
      .map((row) => row.rowNumber)
  );
  const slotNumberByCode = new Map(slots.map((slot) => [slot.slotCode, slot.number]));
  const normalBookings = allBookings.filter((booking) => booking.bookingType !== "Urgent" && booking.startSerial && !isClosingReason(booking.reason));
  const longTickets = normalBookings.filter((booking) => {
    const endEffective = booking.endEffectiveSerial ?? FAR_FUTURE_SERIAL;
    return !adjustedNextDayRows.has(booking.rowNumber) && booking.startSerial <= selectedSerial + 1 && selectedSerial + 1 <= endEffective;
  });
  const dailyTickets = urgentLogs.filter((log) => isoFromSerial(isoDateToSerial(log.ticketIssuedDate)) === selectedDate);
  const byCustomer = new Map();
  const ensureCustomer = (customer, docId) => {
    const key = docId || customer;
    if (!byCustomer.has(key)) byCustomer.set(key, { docId: docId || "", name: customer, customer, longTickets: 0, dailyTickets: 0, totalTickets: 0 });
    return byCustomer.get(key);
  };
  longTickets.forEach((booking) => { ensureCustomer(booking.customer, booking.docId).longTickets += 1; });
  dailyTickets.forEach((log) => { ensureCustomer(log.customer, log.docId).dailyTickets += Number(log.ticketCount || 1); });
  const withAmounts = (row) => {
    const totalTickets = row.longTickets + row.dailyTickets;
    return {
      ...row,
      totalTickets,
      longAmount: calculateTicketAmount(row.longTickets),
      dailyAmount: calculateTicketAmount(row.dailyTickets),
      totalAmount: calculateTicketAmount(totalTickets),
    };
  };
  const rows = [...byCustomer.values()].map(withAmounts)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));

  let customerReport = null;
  if (customerName) {
    const totals = rows.find((row) => row.customer === customerName) || withAmounts({ docId: "", name: customerName, customer: customerName, longTickets: 0, dailyTickets: 0 });
    const activeLongBookings = normalBookings
      .filter((booking) => booking.customer === customerName && (booking.endEffectiveSerial ?? FAR_FUTURE_SERIAL) >= selectedSerial)
      .map((booking) => ({
        ...booking,
        slotNumber: slotNumberByCode.get(booking.slot) || "-",
        pausePeriods: adjustments
          .filter((adjustment) => adjustment.rowNumber === booking.rowNumber && adjustment.action.includes("พัก") && isoDateToSerial(adjustment.endDate) >= selectedSerial)
          .map((adjustment) => ({ startDate: adjustment.startDate, endDate: adjustment.endDate })),
      }))
      .sort((a, b) => (a.startSerial || 0) - (b.startSerial || 0) || String(a.startTime).localeCompare(String(b.startTime)));
    const customerDailyTickets = dailyTickets
      .filter((log) => log.customer === customerName)
      .map((log) => ({ ...log, slotNumber: log.number || slotNumberByCode.get(log.slot) || "-" }));
    const formatSlotNumbers = (items) => {
      const values = [...new Set(items.map((item) => Number(item.slotNumber)).filter(Number.isFinite))].sort((a, b) => a - b);
      const parts = [];
      for (let index = 0; index < values.length; index += 1) {
        let end = index;
        while (end + 1 < values.length && values[end + 1] === values[end] + 1) end += 1;
        parts.push(end > index ? `${values[index]}–${values[end]}` : String(values[index]));
        index = end;
      }
      return parts.join(", ");
    };
    const groupItems = (items, kind) => {
      const groups = new Map();
      items.forEach((item) => {
        const pauseNote = kind === "long" ? (item.pausePeriods || []).map((period) => `${period.startDate}:${period.endDate}`).join("|") : "";
        const key = kind === "long"
          ? [item.lot, item.startTime, item.startDate, item.endDateEffective || item.endDate, pauseNote].join("::")
          : [item.lot, item.startTime, selectedDate].join("::");
        if (!groups.has(key)) groups.set(key, { lot: item.lot, startTime: item.startTime, startDate: item.startDate, endDate: item.endDateEffective || item.endDate, accessDate: selectedDate, pausePeriods: item.pausePeriods || [], items: [], ticketCount: 0 });
        const group = groups.get(key); group.items.push(item); group.ticketCount += Number(item.ticketCount || 1);
      });
      return [...groups.values()].map((group) => ({ ...group, slots: formatSlotNumbers(group.items) })).sort((a, b) => String(a.lot).localeCompare(String(b.lot), "th") || String(a.startTime).localeCompare(String(b.startTime)));
    };
    customerReport = { ...totals, longBookings: activeLongBookings, dailyBookings: customerDailyTickets, longGroups: groupItems(activeLongBookings, "long"), dailyGroups: groupItems(customerDailyTickets, "daily") };
  }

  return { selectedDate, nextOperationalDate, ticketPrice: TICKET_PRICE_PER_UNIT, rows, customerReport };
}

// ---------- tbt_DailyFee (รายการตั๋วจาก MIS) ----------
// อ่านตามชื่อหัวคอลัมน์ BoothCode, CreateDate, Quantity และ Docdate โดยไม่สนตัวพิมพ์เล็ก/ใหญ่
// กฎธุรกิจ:
// 1. วันที่ยึดตาม CreateDate (เวลาชำระเงินจริง 00:00:00 - 23:59:59 ของวันก่อนหน้าวันปฏิบัติการ)
//    หาก CreateDate ว่าง ให้ fallback เป็น Docdate
// 2. จำนวนสิทธิ์นับตาม Quantity หากไม่มีหรือระบุผิด ให้ fallback เป็น 1 สิทธิ์
// ต้อง throw error เมื่อ header หายหรือ API fail ห้ามคืน []
export async function getTransectionRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "tbt_DailyFee!A1:Z",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  if (rows.length < 2) throw new Error("ข้อมูลตั๋วจาก MIS กำลังอัปเดต จึงยังไม่สร้างสถานะชำระเงินใหม่");
  const headers = rows[0].map((h) => String(h || "").trim().toLowerCase());
  const boothCodeIdx = headers.indexOf("boothcode");
  const docDateIdx = headers.indexOf("docdate");
  const quantityIdx = headers.indexOf("quantity") !== -1 ? headers.indexOf("quantity") : headers.indexOf("qty");
  const createDateIdx = headers.indexOf("createdate") !== -1 ? headers.indexOf("createdate") : headers.indexOf("timestamp");

  if (boothCodeIdx === -1 || (docDateIdx === -1 && createDateIdx === -1)) {
    throw new Error('ไม่พบคอลัมน์ "BoothCode" หรือ "Docdate" / "CreateDate" ในหัวตารางแท็บ tbt_DailyFee กรุณาตรวจสอบชื่อหัวตาราง');
  }

  return rows
    .slice(1)
    .map((r, idx) => {
      const rawCreateDate = createDateIdx !== -1 ? r[createDateIdx] : null;
      const rawDocDate = docDateIdx !== -1 ? r[docDateIdx] : null;

      // ลำดับการเลือกวันที่: CreateDate ก่อน -> Fallback เป็น Docdate
      let dateSerial = parseTransactionDateSerial(rawCreateDate);
      if (dateSerial === null) {
        dateSerial = parseTransactionDateSerial(rawDocDate);
      }

      const quantity = parseTransactionQuantity(quantityIdx !== -1 ? r[quantityIdx] : null);

      return {
        sheetRow: idx + 2,
        boothCode: String(r[boothCodeIdx] || "").trim(),
        dateSerial,
        dateStr: isoFromSerial(dateSerial),
        quantity,
        createDate: String(rawCreateDate || ""),
        docDate: String(rawDocDate || ""),
      };
    })
    .filter((t) => t.boothCode && (t.createDate || t.docDate));
}

// ---------- CS Overview ----------
// CS grid: เลือก operational date แล้วหาการจองที่ active ในวันนั้น โดยไม่เช็คการจ่ายเงิน
export async function getCsOverviewData(dateStr) {
  const targetDateStr = dateStr || isoFromSerial(getTodaySerial());
  const targetSerial = isoDateToSerial(targetDateStr);
  const [allBookings, slotsWithStatus, adjustedRows] = await Promise.all([
    getAllBookingRows(),
    getSlotsWithStatus(),
    getAdjustedBookingRows(targetDateStr),
  ]);

  const assignments = [];
  for (const b of allBookings) {
    const endEff = b.endEffectiveSerial !== null && b.endEffectiveSerial !== undefined ? b.endEffectiveSerial : FAR_FUTURE_SERIAL;
    // รายการที่ถูกปิดด้วย ยกเลิก / ย้ายออก / ปิดช่อง เป็นประวัติเท่านั้น
    // ห้ามนำไปแสดงทั้งตารางหลักและรายการจองล่วงหน้าของ CS Overview
    if (!b.startSerial || endEff < targetSerial || adjustedRows.has(b.rowNumber) || isClosingReason(b.reason)) continue;
    const assignment = {
      slot: b.slot,
      customer: b.customer,
      docId: b.docId,
      lot: b.lot,
      startDate: b.startDate,
      endDate: b.endDate,
      startTime: b.startTime,
      startMin: b.startMinutes !== null ? b.startMinutes : 420,
      endMin: b.endMinutes !== null ? b.endMinutes : 660,
    };
    if (b.startSerial <= targetSerial) assignments.push(assignment);
  }

  return {
    slots: slotsWithStatus.map((s) => ({
      code: s.slotCode,
      lot: s.lot,
      number: s.number,
      position: s.position,
      baseStatus: s.baseStatus,
      status: s.status,
      isClosed: s.status === "ปิด",
      isRoad: s.isRoad,
      closedReason: s.reason,
    })),
    date: targetDateStr,
    assignments,
  };
}

// ---------- Dashboard & Mobile View Data ----------
const PAYMENT_SNAPSHOT_HEADERS = ["Operational_Date", "Payment_Source_Date", "Booking_Row_Number", "Doc_Id", "Slot_Code", "Start_Time", "Is_Paid", "Snapshot_Updated_At"];
const PAYMENT_SNAPSHOT_RUN_HEADERS = ["Operational_Date", "Payment_Source_Date", "Snapshot_Updated_At", "Status"];
const PAYMENT_REFRESH_HEADERS = ["Operational_Date", "Attempted_At", "Source", "Status", "Message"];

async function ensurePaymentSnapshotSheets() {
  await ensureSheet("Payment_Snapshot", PAYMENT_SNAPSHOT_HEADERS, 2);
  await ensureSheet("Payment_Snapshot_Run", PAYMENT_SNAPSHOT_RUN_HEADERS, 2);
  await ensureSheet("Payment_Refresh_Log", PAYMENT_REFRESH_HEADERS, 2);
}

export async function getSlotAvailability({ lot, startDate, endDate, startTimes = [], purpose = "normal" }) {
  if (purpose === "urgent") {
    if (startDate !== endDate || startTimes.length !== 1) throw new Error("จองรายวันเลือกได้ครั้งละ 1 รอบ");
    const dashboard = await getDashboardData(startDate);
    if (dashboard.paymentStatus !== "READY") throw new Error("ข้อมูลสถานะการชำระเงินยังไม่พร้อม กรุณารอหรืออัปเดตข้อมูลใหม่");
    const occupied = new Set((dashboard.bookings || []).filter((booking) => booking.lot === lot).map((booking) => `${booking.slot}::${booking.startTime}`));
    const startTime = startTimes[0];
    return (dashboard.slots || []).filter((slot) => !lot || slot.lot === lot).map((slot) => {
      if (slot.status === "ปิด" || slot.isRoad) return { slotCode: slot.code, blocked: true, reason: "ปิดใช้งาน" };
      return occupied.has(`${slot.code}::${startTime}`)
        ? { slotCode: slot.code, blocked: true, reason: "มีการจองแล้ว" }
        : { slotCode: slot.code, blocked: false, reason: "" };
    });
  }
  // Read each Sheet range once.  The booking screen may show dozens of slots;
  // calling findConflict for every slot would quickly exhaust Google quota.
  const [slots, all, adjustments] = await Promise.all([getSlotsWithStatus(), getAllBookingRows(), getBookingAdjustments()]);
  const inLot = slots.filter((slot) => !lot || slot.lot === lot);
  const requestedStart = isoDateToSerial(startDate);
  const requestedEnd = isoDateToSerial(endDate) || FAR_FUTURE_SERIAL;
  const activeOutsidePause = (booking, overlapStart, overlapEnd) => {
    const pauses = adjustments.filter((item) => item.rowNumber === booking.rowNumber && (item.action.includes("ลด") || item.action.includes("พัก")));
    for (let day = overlapStart; day <= overlapEnd; day += 1) {
      if (!pauses.some((pause) => isoDateToSerial(pause.startDate) <= day && day <= isoDateToSerial(pause.endDate))) return true;
    }
    return false;
  };
  return inLot.map((slot) => {
    if (slot.status === "ปิด" || slot.isRoad) return { slotCode: slot.slotCode, blocked: true, reason: "ปิดใช้งาน" };
    for (const startTime of startTimes) {
      const startMin = toOperationalMinutes(serialToMinutes(startTime));
      const conflict = all.find((booking) => {
        if (String(booking.slot) !== String(slot.slotCode) || !booking.startSerial) return false;
        if (isClosingReason(booking.reason)) return false;
        const bookingEnd = booking.endEffectiveSerial ?? FAR_FUTURE_SERIAL;
        const datesOverlap = booking.startSerial <= requestedEnd && bookingEnd >= requestedStart;
        const timesOverlap = (booking.startMinutes ?? 0) < startMin + 240 && startMin < (booking.endMinutes ?? ((booking.startMinutes ?? 0) + 240));
        return datesOverlap && timesOverlap && activeOutsidePause(booking, Math.max(booking.startSerial, requestedStart), Math.min(bookingEnd, requestedEnd));
      });
      if (conflict) return { slotCode: slot.slotCode, blocked: true, reason: "มีการจองแล้ว" };
    }
    return { slotCode: slot.slotCode, blocked: false, reason: "" };
  });
}

function snapshotKey(rowNumber) { return String(rowNumber || ""); }

export async function getPaymentSnapshot(operationalDate) {
  await ensurePaymentSnapshotSheets();
  const sheets = getSheetsClient();
  const [runsRes, rowsRes] = await Promise.all([
    executeWithRetry(() => sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Payment_Snapshot_Run!A2:D", valueRenderOption: "UNFORMATTED_VALUE" })),
    executeWithRetry(() => sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Payment_Snapshot!A2:H", valueRenderOption: "UNFORMATTED_VALUE" })),
  ]);
  const matchingRuns = (runsRes.data.values || []).filter((row) => String(row[0] || "") === operationalDate && String(row[3] || "") === "READY");
  const run = matchingRuns.sort((a, b) => String(b[2] || "").localeCompare(String(a[2] || "")))[0];
  if (!run) return null;
  const updatedAt = String(run[2] || "");
  const byBookingRow = new Map();
  (rowsRes.data.values || []).filter((row) => String(row[0] || "") === operationalDate && String(row[7] || "") === updatedAt).forEach((row) => {
    byBookingRow.set(snapshotKey(row[2]), String(row[6] || "").toLowerCase() === "true");
  });
  return { operationalDate, sourceDate: String(run[1] || ""), updatedAt, byBookingRow };
}

export async function getPaymentRefreshState(operationalDate) {
  await ensurePaymentSnapshotSheets();
  const sheets = getSheetsClient();
  const res = await executeWithRetry(() => sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Payment_Refresh_Log!A2:E", valueRenderOption: "UNFORMATTED_VALUE" }));
  const latest = (res.data.values || []).filter((row) => String(row[0] || "") === operationalDate).sort((a, b) => String(b[1] || "").localeCompare(String(a[1] || "")))[0];
  return latest ? { attemptedAt: String(latest[1] || ""), source: String(latest[2] || ""), status: String(latest[3] || ""), message: String(latest[4] || "") } : null;
}

export async function appendPaymentRefreshState({ operationalDate, source, status, message = "" }) {
  await ensurePaymentSnapshotSheets();
  const sheets = getSheetsClient();
  const attemptedAt = new Date().toISOString();
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Payment_Refresh_Log!A2:E", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[operationalDate, attemptedAt, source, status, message]] } });
  return { attemptedAt, source, status, message };
}

// ---------- Customer Summary (สรุปพฤติกรรมลูกค้าอัตโนมัติ) ----------
export const CUSTOMER_SUMMARY_HEADERS = [
  "วันที่",
  "เดือน",
  "สัปดาห์",
  "รหัสสัญญา",
  "ชื่อลูกค้า",
  "จองตามสัญญา",
  "จ่ายจริง",
  "ขาด",
  "ขอด่วน",
  "% การจ่ายจริง",
  "เวลาที่บันทึก",
];

export async function ensureCustomerSummarySheet() {
  await ensureSheet("Customer_Summary", CUSTOMER_SUMMARY_HEADERS, 2);
}

function getWeekNumberString(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const oneJan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numberOfDays = Math.floor((d - oneJan) / 86400000);
  const weekNum = Math.ceil((d.getUTCDay() + 1 + numberOfDays) / 7);
  return `สัปดาห์ที่ ${weekNum}`;
}

export async function recordCustomerDailySummary({
  operationalDate,
  sourceDate,
  activeByDoc,
  isPaidByBookingRow,
  ticketCountByDocId = null,
  masterMap = null,
  urgentLogs = [],
  cancelledUrgentKeys = new Set(),
}) {
  await ensureCustomerSummarySheet();
  const sheets = getSheetsClient();
  const month = String(operationalDate || "").slice(0, 7);
  const week = getWeekNumberString(operationalDate);
  const recordedAt = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const urgentCountByDoc = new Map();
  const urgentCustomerNameByDoc = new Map();
  (urgentLogs || [])
    .filter((log) => log.ticketIssuedDate === sourceDate && log.docId && !cancelledUrgentKeys.has(`${log.slot}::${log.startTime}`))
    .forEach((log) => {
      const doc = String(log.docId).trim();
      urgentCountByDoc.set(doc, (urgentCountByDoc.get(doc) || 0) + (Number(log.ticketCount) || 1));
      if (log.customer) urgentCustomerNameByDoc.set(doc, String(log.customer).trim());
    });

  const ticketDocKeys = ticketCountByDocId
    ? Array.from(ticketCountByDocId.keys()).filter((k) => (ticketCountByDocId.get(k) || 0) > 0)
    : [];
  const allDocKeys = new Set([...activeByDoc.keys(), ...urgentCountByDoc.keys(), ...ticketDocKeys]);
  const summaryRows = [];

  allDocKeys.forEach((key) => {
    const bookings = activeByDoc.get(key) || [];
    const docId = String(bookings[0]?.docId || key).trim();
    const customerName = String(
      bookings[0]?.customer ||
      urgentCustomerNameByDoc.get(docId) ||
      (masterMap && masterMap.get(docId)) ||
      key
    ).trim();
    const booked = bookings.length;
    const matchedPaid = bookings.filter((b) => isPaidByBookingRow.get(b.rowNumber)).length;
    // บันทึกจำนวนตั๋วจ่ายจริงทั้งหมด (รวมตั๋วส่วนเกิน/ตีเบิ้ล) ไม่เพดานกั้นไว้แค่จำนวนจอง
    const paid = ticketCountByDocId && ticketCountByDocId.has(docId)
      ? Math.max(matchedPaid, Number(ticketCountByDocId.get(docId)) || 0)
      : matchedPaid;
    const shortfall = Math.max(0, booked - paid);
    const urgent = urgentCountByDoc.get(docId) || 0;
    const pct = booked > 0 ? Math.round((paid / booked) * 1000) / 1000 : ((paid > 0 || urgent > 0) ? 1 : 0);

    summaryRows.push([
      operationalDate,
      month,
      week,
      docId,
      customerName,
      booked,
      paid,
      shortfall,
      urgent,
      pct,
      recordedAt,
    ]);
  });

  if (summaryRows.length === 0) return { count: 0 };

  // เรียงลำดับตามรหัสสัญญา
  summaryRows.sort((a, b) => String(a[3]).localeCompare(String(b[3]), "th", { numeric: true }));

  // Idempotency Guard: ตรวจสอบแถวเดิมใน Customer_Summary เพื่อป้องกันข้อมูลซ้ำ
  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Customer_Summary!A2:K",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const existingRows = existingRes.data.values || [];
  const filteredRows = existingRows.filter((row) => {
    const rowDate = isoFromSerial(row[0]);
    return rowDate && rowDate !== operationalDate;
  });
  const newCombined = [...filteredRows, ...summaryRows];

  if (newCombined.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Customer_Summary!A2:K",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: newCombined },
    });
    if (newCombined.length < existingRows.length) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `Customer_Summary!A${newCombined.length + 2}:K${existingRows.length + 1}`,
      });
    }
  }

  return { count: summaryRows.length };
}

export async function createPaymentSnapshot(operationalDate) {
  if (!operationalDate || !isoDateToSerial(operationalDate)) throw new Error("วันที่สร้างสิทธิ์ไม่ถูกต้อง");
  await ensurePaymentSnapshotSheets();
  const targetSerial = isoDateToSerial(operationalDate);
  const sourceSerial = targetSerial - 1;
  const sourceDate = isoFromSerial(sourceSerial);
  const [allBookings, slotsWithStatus, transectionRows, urgentLogs, adjustedRows, masterList] = await Promise.all([
    getAllBookingRows(), getSlotsWithStatus(), getTransectionRows(), getUrgentAccessLogs(), getAdjustedBookingRows(operationalDate), getMasterList(),
  ]);
  const masterNameByDocId = new Map();
  (masterList || []).forEach((m) => {
    if (m.docId) masterNameByDocId.set(String(m.docId).trim(), String(m.name || "").trim());
  });
  allBookings.forEach((b) => {
    if (b.docId && b.customer && !masterNameByDocId.has(String(b.docId).trim())) {
      masterNameByDocId.set(String(b.docId).trim(), String(b.customer).trim());
    }
  });
  const activeBookings = allBookings.filter((booking) => {
    const endEff = booking.endEffectiveSerial ?? FAR_FUTURE_SERIAL;
    return booking.bookingType !== "Urgent" && booking.startSerial && !isClosingReason(booking.reason) && !adjustedRows.has(booking.rowNumber) && booking.startSerial <= targetSerial && targetSerial <= endEff;
  });
  const ticketCountByDocId = new Map();
  transectionRows.filter((ticket) => ticket.dateSerial === sourceSerial && ticket.boothCode).forEach((ticket) => {
    ticketCountByDocId.set(ticket.boothCode, (ticketCountByDocId.get(ticket.boothCode) || 0) + (Number(ticket.quantity) || 1));
  });
  const cancelledUrgentKeys = new Set(
    allBookings
      .filter((b) => b.bookingType === "Urgent" && isClosingReason(b.reason))
      .map((b) => `${b.slot}::${b.startTime}`)
  );
  urgentLogs.filter((log) => log.ticketIssuedDate === sourceDate && log.docId && !cancelledUrgentKeys.has(`${log.slot}::${log.startTime}`)).forEach((log) => {
    ticketCountByDocId.set(log.docId, Math.max(0, (ticketCountByDocId.get(log.docId) || 0) - log.ticketCount));
  });
  const slotNumberByCode = new Map(slotsWithStatus.map((slot) => [slot.slotCode, slot.number]));
  const activeByDoc = new Map();
  activeBookings.forEach((booking) => { const key = booking.docId || booking.customer; if (!activeByDoc.has(key)) activeByDoc.set(key, []); activeByDoc.get(key).push(booking); });
  const isPaidByBookingRow = new Map();
  activeByDoc.forEach((bookings, key) => {
    let remaining = ticketCountByDocId.get(key) || 0;
    bookings.sort((left, right) => {
      const bySlot = String(slotNumberByCode.get(left.slot) || left.slot).localeCompare(String(slotNumberByCode.get(right.slot) || right.slot), "th", { numeric: true });
      if (bySlot !== 0) return bySlot;
      return toOperationalMinutes(left.startMinutes ?? serialToMinutes(left.startTime)) - toOperationalMinutes(right.startMinutes ?? serialToMinutes(right.startTime));
    });
    bookings.forEach((booking) => { const isPaid = remaining > 0; if (isPaid) remaining -= 1; isPaidByBookingRow.set(booking.rowNumber, isPaid); });
  });
  const updatedAt = new Date().toISOString();
  const snapshotRows = activeBookings.map((booking) => [operationalDate, sourceDate, booking.rowNumber, booking.docId, booking.slot, booking.startTime, isPaidByBookingRow.get(booking.rowNumber) ? "true" : "false", updatedAt]);
  const sheets = getSheetsClient();
  if (snapshotRows.length > 0) await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Payment_Snapshot!A2:H", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: snapshotRows } });
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Payment_Snapshot_Run!A2:D", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [[operationalDate, sourceDate, updatedAt, "READY"]] } });

  // Safe Isolation Wrapper: บันทึกสรุปพฤติกรรมลูกค้า (ไม่ขัดขวางระบบหลัก)
  try {
    await recordCustomerDailySummary({
      operationalDate,
      sourceDate,
      activeByDoc,
      isPaidByBookingRow,
      ticketCountByDocId,
      masterMap: masterNameByDocId,
      urgentLogs,
      cancelledUrgentKeys,
    });
  } catch (summaryErr) {
    console.error("Non-critical customer summary record error:", summaryErr);
  }

  return { operationalDate, sourceDate, updatedAt, count: snapshotRows.length };
}

// Logic Production เดิม:
// 1. หา booking ที่ active ในวัน targetDate (startDate <= targetDate && targetDate <= endDateEffective)
// 2. ตรวจสอบการชำระเงินจาก Transection: นับว่าจ่ายเมื่อมีรายการของ Doc_Id ในวันก่อนหน้า target date 1 วัน (dayBefore)
// 3. ห้ามแสดง unpaid booking เป็น occupied: ช่องที่ unpaid ต้องเป็นสถานะว่าง (green) เพื่อให้ทีมสนามตรวจแอบจอด
export async function getDashboardData(dateStr) {
  const targetDateStr = dateStr || getCurrentOperationalDateIso();
  const currentOperationalDate = getCurrentOperationalDateIso();
  const targetSerial = isoDateToSerial(targetDateStr);
  const dayBeforeSerial = targetSerial - 1;
  const dayBeforeStr = isoFromSerial(dayBeforeSerial);

  const sheets = getSheetsClient();
  const batchRes = await executeWithRetry(() => sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: [
      `Booking_Input!A${BOOKING_FIRST_ROW}:M`,
      `Slot_Master!A${SLOT_FIRST_ROW}:E`,
      `Slot_Status_Log!A${SLOT_LOG_FIRST_ROW}:D`,
      "Urgent_Access_Log!A2:P",
      "Booking_Adjustment_Log!A2:H",
      "Payment_Snapshot_Run!A2:D",
      "Payment_Snapshot!A2:H",
    ],
    valueRenderOption: "UNFORMATTED_VALUE",
  }));

  const valueRanges = batchRes.data.valueRanges || [];
  const rawBookings = valueRanges[0]?.values || [];
  const rawSlots = valueRanges[1]?.values || [];
  const rawStatusLogs = valueRanges[2]?.values || [];
  const rawUrgentLogs = valueRanges[3]?.values || [];
  const rawAdjustments = valueRanges[4]?.values || [];
  const rawRuns = valueRanges[5]?.values || [];
  const rawSnapshots = valueRanges[6]?.values || [];

  let masterMap = null;
  const hasEmptyDocId = rawBookings.some((r) => r[0] && (!r[1] || !String(r[1]).trim()));
  if (hasEmptyDocId) {
    const masterList = await getMasterList();
    masterMap = new Map();
    masterList.forEach((m) => masterMap.set(m.name, m.docId));
  }
  const allBookings = rawBookings.map((r, idx) => parseBookingRow(r, idx, masterMap));

  const statusMap = {};
  for (const r of rawStatusLogs) {
    const [slotCodeRaw, actionRaw, reasonRaw, tsRaw] = r;
    const slotCode = slotCodeRaw ? String(slotCodeRaw).trim() : "";
    if (!slotCode) continue;
    const action = actionRaw ? String(actionRaw).trim() : "";
    const reason = reasonRaw ? String(reasonRaw).trim() : "";
    let tsNum = 0;
    if (typeof tsRaw === "number") tsNum = tsRaw;
    else if (typeof tsRaw === "string" && tsRaw) {
      const parsed = Date.parse(tsRaw);
      tsNum = isNaN(parsed) ? 0 : parsed;
    }
    if (!statusMap[slotCode] || tsNum > statusMap[slotCode].timestamp) {
      statusMap[slotCode] = { action, reason, timestamp: tsNum };
    }
  }

  const slotsWithStatus = rawSlots.filter((r) => r[0]).map((s) => {
    const slotCode = String(s[0]).trim();
    const lot = String(s[1] || "").trim();
    const number = String(s[2] || "").trim();
    const position = String(s[3] || "").trim();
    const baseStatus = String(s[4] || "เปิด").trim();
    const st = statusMap[slotCode];
    let currentStatus = baseStatus;
    let currentReason = "";
    if (st) {
      currentStatus = st.action;
      currentReason = st.reason;
    }
    const isRoad = baseStatus === "ปิด" && (!st || st.action !== "เปิด");
    return { slotCode, lot, number, position, baseStatus, status: currentStatus, reason: currentReason, isRoad };
  });

  const urgentLogs = rawUrgentLogs.map((r) => ({
    createdAt: String(r[0] || ""),
    ticketIssuedDate: typeof r[1] === "number" ? isoFromSerial(r[1]) : String(r[1] || ""),
    accessDate: typeof r[2] === "number" ? isoFromSerial(r[2]) : String(r[2] || ""),
    actionType: String(r[3] || ""),
    customer: String(r[4] || ""),
    docId: String(r[5] || ""),
    bookingRowNumber: Number(r[6] || 0),
    lot: String(r[7] || ""),
    slot: String(r[8] || ""),
    number: String(r[9] || ""),
    startTime: typeof r[10] === "number" ? minutesToTimeStr(serialToMinutes(r[10])) : String(r[10] || ""),
    ticketCount: Number(r[11] || 1),
    reason: String(r[12] || ""),
    note: String(r[13] || ""),
    createdByEmployeeId: String(r[14] || ""),
    createdByName: String(r[15] || ""),
  }));

  const adjustments = rawAdjustments.map((row) => ({
    startDate: isoFromSerial(row[1]) || String(row[1] || ""),
    endDate: isoFromSerial(row[7]) || String(row[7] || "") || isoFromSerial(row[1]) || String(row[1] || ""),
    action: String(row[2] || ""),
    rowNumber: Number(row[3] || 0),
  })).filter((row) => row.rowNumber && row.startDate);
  const adjustedRows = new Set(
    adjustments
      .filter((row) => (row.action.includes("ลด") || row.action.includes("พัก")) && isoDateToSerial(row.startDate) <= targetSerial && targetSerial <= isoDateToSerial(row.endDate))
      .map((row) => row.rowNumber)
  );

  const matchingRuns = rawRuns.filter((row) => String(row[0] || "") === targetDateStr && String(row[3] || "") === "READY");
  const run = matchingRuns.sort((a, b) => String(b[2] || "").localeCompare(String(a[2] || "")))[0];
  let paymentSnapshot = null;
  if (run) {
    const updatedAt = String(run[2] || "");
    const byBookingRow = new Map();
    rawSnapshots.filter((row) => String(row[0] || "") === targetDateStr && String(row[7] || "") === updatedAt).forEach((row) => {
      byBookingRow.set(snapshotKey(row[2]), String(row[6] || "").toLowerCase() === "true");
    });
    paymentSnapshot = { operationalDate: targetDateStr, sourceDate: String(run[1] || ""), updatedAt, byBookingRow };
  }

  // หา bookings ที่ active ในวันเป้าหมาย
  const activeBookings = allBookings.filter((b) => {
    if (!b.startSerial) return false;
    // รายการที่ถูกยกเลิกหรือปิดแล้ว ไม่นำมาแสดงบน Dashboard
    if (isClosingReason(b.reason)) return false;
    const endEff = b.endEffectiveSerial !== null && b.endEffectiveSerial !== undefined ? b.endEffectiveSerial : FAR_FUTURE_SERIAL;
    return !adjustedRows.has(b.rowNumber) && b.startSerial <= targetSerial && targetSerial <= endEff;
  });

  const paidBookings = [];
  const unpaidBookings = [];
  activeBookings.filter((booking) => booking.bookingType !== "Urgent").forEach((b) => {
    const isPaid = paymentSnapshot?.byBookingRow.get(snapshotKey(b.rowNumber)) === true;
    const bookingInfo = {
      slot: b.slot,
      lot: b.lot,
      customer: b.customer,
      docId: b.docId,
      startDate: b.startDate,
      endDate: b.endDate,
      startTime: b.startTime,
      endTime: b.endTime,
      startMin: b.startMinutes !== null ? b.startMinutes : 420,
      endMin: b.endMinutes !== null ? b.endMinutes : 660,
      isPaid,
    };
      if (isPaid) {
      paidBookings.push(bookingInfo);
    } else {
      unpaidBookings.push(bookingInfo);
    }
  });

  // สิทธิ์ด่วนมีผลทันทีใน operational day ที่ CS ระบุ (เก็บประวัติตลอดทั้งวันเพื่อใช้ตรวจการหมดเวลาจอดในรอบถัดไป)
  urgentLogs.filter((log) => log.accessDate === targetDateStr).forEach((log) => {
    const booking = activeBookings.find((b) => b.slot === log.slot && b.startTime === log.startTime && (log.bookingRowNumber ? b.rowNumber === log.bookingRowNumber : true));
    if (!booking || isClosingReason(booking.reason)) return;
    const key = `${booking.slot}::${booking.startTime}`;
    const paidIndex = paidBookings.findIndex((item) => `${item.slot}::${item.startTime}` === key);
    if (paidIndex >= 0) paidBookings.splice(paidIndex, 1);
    const unpaidIndex = unpaidBookings.findIndex((item) => `${item.slot}::${item.startTime}` === key);
    if (unpaidIndex >= 0) unpaidBookings.splice(unpaidIndex, 1);
    if (!paidBookings.some((item) => `${item.slot}::${item.startTime}` === key)) paidBookings.push({ slot: booking.slot, lot: booking.lot, customer: booking.customer, docId: booking.docId, startDate: booking.startDate, endDate: booking.endDate, startTime: booking.startTime, endTime: booking.endTime, startMin: booking.startMinutes, endMin: booking.endMinutes, isPaid: true, isUrgent: true, createdAt: log.createdAt, actionType: log.actionType, note: log.note });
  });

  const slots = slotsWithStatus.map((s) => ({
    code: s.slotCode,
    lot: s.lot,
    number: s.number,
    position: s.position,
    baseStatus: s.baseStatus,
    status: s.status,
    isClosed: s.status === "ปิด",
    isRoad: s.isRoad,
    closedReason: s.reason,
  }));

  return {
    date: targetDateStr,
    dayBefore: dayBeforeStr,
    paymentStatus: paymentSnapshot ? "READY" : "UPDATING",
    paymentSnapshotUpdatedAt: paymentSnapshot?.updatedAt || "",
    paymentSourceDate: paymentSnapshot?.sourceDate || dayBeforeStr,
    isLiveOperationalDate: targetDateStr === currentOperationalDate,
    currentBlock: getCurrentOperationalBlock(),
    slots,
    bookings: paidBookings, // เฉพาะที่ชำระเงินแล้วเท่านั้นที่เป็น occupied
    unpaidBookings,        // ส่งไปเพื่อข้อมูลอ้างอิง แต่ไม่นับเป็น occupied
  };
}

export async function getCustomerSummaryData({ date, startDate, endDate, mode = "day" } = {}) {
  await Promise.all([ensureCustomerSummarySheet(), ensureAccountingArchiveSheets()]);
  const sheets = getSheetsClient();
  const batchRes = await executeWithRetry(() =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: ["Customer_Summary!A2:K", "Accounting_Daily_Summary!A2:Q"],
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  );
  const valueRanges = batchRes.data.valueRanges || [];
  const rows = valueRanges[0]?.values || [];
  const accountingRows = valueRanges[1]?.values || [];

  const rowMapByOpDateAndDoc = new Map();
  const latestRecordedByOpDate = new Map();

  rows.forEach((r) => {
    const rowDate = isoFromSerial(r[0]) || String(r[0] || "").trim();
    const docId = String(r[3] || "").trim();
    const customerName = String(r[4] || "").trim();
    if (!rowDate || (!docId && !customerName)) return;
    const booked = Number(r[5]) || 0;
    const paid = Number(r[6]) || 0;
    const shortfall = Math.max(0, booked - paid);
    const surplus = Math.max(0, paid - booked);
    const urgent = Number(r[8]) || 0;
    const pct = booked > 0 ? Math.round((paid / booked) * 1000) / 1000 : ((paid > 0 || urgent > 0) ? 1 : 0);
    const recordedAt = String(r[10] || "").trim();
    if (recordedAt) latestRecordedByOpDate.set(rowDate, recordedAt);

    const key = `${rowDate}::${docId || customerName}`;
    rowMapByOpDateAndDoc.set(key, {
      date: rowDate,
      month: String(r[1] || "").trim() || rowDate.slice(0, 7),
      week: String(r[2] || "").trim() || getWeekNumberString(rowDate),
      docId,
      customerName,
      booked,
      paid,
      shortfall,
      surplus,
      urgent,
      pct,
      recordedAt,
    });
  });

  // เชื่อมข้อมูลจาก Accounting_Daily_Summary (วันที่จ่ายตั๋ว sourceDate -> วันปฏิบัติการ sourceDate + 1)
  // เพื่อให้แท็บ "สรุปพฤติกรรมลูกค้า" และ "สรุปการชำระเงิน" เห็นยอดจ่ายจริงและตั๋วส่วนเกิน (ตีเบิ้ล) ตรงกัน 100%
  accountingRows.forEach((r) => {
    const sourceSerial = typeof r[0] === "number" ? r[0] : isoDateToSerial(String(r[0] || "").trim());
    if (!sourceSerial) return;
    const opDate = isoFromSerial(sourceSerial + 1);
    const docId = String(r[1] || "").trim();
    const customerName = String(r[2] || "").trim();
    if (!opDate || (!docId && !customerName)) return;

    const totalBookedInAcc = Number(r[3]) || 0;
    const totalPaidInAcc = Number(r[4]) || 0;
    const urgentInAcc = Number(r[12]) || 0;
    const advanceBookedInAcc = r[13] !== undefined && r[13] !== "" ? Number(r[13]) || 0 : Math.max(0, totalBookedInAcc - urgentInAcc);
    const advancePaidInAcc = Math.max(0, totalPaidInAcc - urgentInAcc);
    const recordedAt = String(r[16] || "").trim();

    const key = `${opDate}::${docId || customerName}`;
    const existing = rowMapByOpDateAndDoc.get(key);
    if (existing) {
      if (advancePaidInAcc > existing.paid) {
        existing.paid = advancePaidInAcc;
        existing.shortfall = Math.max(0, existing.booked - existing.paid);
        existing.surplus = Math.max(0, existing.paid - existing.booked);
        existing.pct = existing.booked > 0 ? Math.round((existing.paid / existing.booked) * 1000) / 1000 : 1;
      }
      if (urgentInAcc > existing.urgent) {
        existing.urgent = urgentInAcc;
      }
    } else if (advancePaidInAcc > 0 || advanceBookedInAcc > 0 || urgentInAcc > 0) {
      const booked = advanceBookedInAcc;
      const paid = advancePaidInAcc;
      const shortfall = Math.max(0, booked - paid);
      const surplus = Math.max(0, paid - booked);
      const pct = booked > 0 ? Math.round((paid / booked) * 1000) / 1000 : ((paid > 0 || urgentInAcc > 0) ? 1 : 0);
      rowMapByOpDateAndDoc.set(key, {
        date: opDate,
        month: opDate.slice(0, 7),
        week: getWeekNumberString(opDate),
        docId,
        customerName,
        booked,
        paid,
        shortfall,
        surplus,
        urgent: urgentInAcc,
        pct,
        recordedAt: latestRecordedByOpDate.get(opDate) || recordedAt,
      });
    }
  });

  const getStatusObj = (shortfall, surplus) => {
    if ((surplus || 0) > 0) return { status: "เงินรับส่วนเกิน", statusKey: "surplus" };
    if ((shortfall || 0) > 0) return { status: "รอตรวจยอดชำระ", statusKey: "shortfall" };
    return { status: "กระทบยอดลงตัว", statusKey: "balanced" };
  };

  const parsedRows = Array.from(rowMapByOpDateAndDoc.values()).map((r) => ({
    ...r,
    ...getStatusObj(r.shortfall, r.surplus),
  }));

  if (mode === "range") {
    const from = startDate || "0000-00-00";
    const to = endDate || "9999-99-99";
    const matchingRows = parsedRows.filter((r) => r.date >= from && r.date <= to);

    const customerMap = new Map();
    matchingRows.forEach((r) => {
      const key = r.docId || r.customerName;
      if (!customerMap.has(key)) {
        customerMap.set(key, {
          docId: r.docId,
          customerName: r.customerName,
          booked: 0,
          paid: 0,
          shortfall: 0,
          surplus: 0,
          urgent: 0,
          daysCount: 0,
        });
      }
      const entry = customerMap.get(key);
      if (!entry.customerName && r.customerName) entry.customerName = r.customerName;
      entry.booked += r.booked;
      entry.paid += r.paid;
      entry.shortfall += r.shortfall;
      entry.surplus += r.surplus || 0;
      entry.urgent += r.urgent;
      entry.daysCount += 1;
    });

    const summaryRows = Array.from(customerMap.values()).map((c) => ({
      ...c,
      pct: c.booked > 0 ? Math.round((c.paid / c.booked) * 1000) / 1000 : ((c.paid > 0 || c.urgent > 0) ? 1 : 0),
      ...getStatusObj(c.shortfall, c.surplus),
    }));
    summaryRows.sort((a, b) => a.docId.localeCompare(b.docId, "th", { numeric: true }));

    const totals = {
      totalBooked: summaryRows.reduce((acc, c) => acc + c.booked, 0),
      totalPaid: summaryRows.reduce((acc, c) => acc + c.paid, 0),
      totalShortfall: summaryRows.reduce((acc, c) => acc + c.shortfall, 0),
      totalSurplus: summaryRows.reduce((acc, c) => acc + (c.surplus || 0), 0),
      totalUrgent: summaryRows.reduce((acc, c) => acc + c.urgent, 0),
      customerCount: summaryRows.length,
      daysInRange: new Set(matchingRows.map((r) => r.date)).size,
    };
    totals.overallPct = totals.totalBooked > 0 ? Math.round((totals.totalPaid / totals.totalBooked) * 1000) / 1000 : 0;

    const dailyBreakdown = [...matchingRows].sort(
      (a, b) => a.date.localeCompare(b.date) || a.docId.localeCompare(b.docId, "th", { numeric: true })
    );

    return {
      mode: "range",
      startDate: from,
      endDate: to,
      totals,
      summaryRows,
      dailyBreakdown,
      latestRecordedAt: matchingRows[matchingRows.length - 1]?.recordedAt || "",
    };
  }

  const targetDate = date || getBangkokCalendarDateIso();
  const matchingRows = parsedRows.filter((r) => r.date === targetDate);
  matchingRows.sort((a, b) => a.docId.localeCompare(b.docId, "th", { numeric: true }));

  const totals = {
    totalBooked: matchingRows.reduce((acc, c) => acc + c.booked, 0),
    totalPaid: matchingRows.reduce((acc, c) => acc + c.paid, 0),
    totalShortfall: matchingRows.reduce((acc, c) => acc + c.shortfall, 0),
    totalSurplus: matchingRows.reduce((acc, c) => acc + (c.surplus || 0), 0),
    totalUrgent: matchingRows.reduce((acc, c) => acc + c.urgent, 0),
    customerCount: matchingRows.length,
  };
  totals.overallPct = totals.totalBooked > 0 ? Math.round((totals.totalPaid / totals.totalBooked) * 1000) / 1000 : 0;

  const targetSerial = isoDateToSerial(targetDate);
  const sourceDate = targetSerial ? isoFromSerial(targetSerial - 1) : "";

  return {
    mode: "day",
    date: targetDate,
    sourceDate,
    totals,
    summaryRows: matchingRows,
    dailyBreakdown: matchingRows,
    latestRecordedAt: matchingRows[0]?.recordedAt || "",
  };
}

// ---------- Accounting Reconciliation Archive (จัดเก็บประวัติการกระทบยอดรายวันถาวร) ----------
const ACCOUNTING_DAILY_SUMMARY_HEADERS = [
  "Date",
  "BoothCode",
  "Customer_Name",
  "Booked_Tickets",
  "Paid_Tickets",
  "Total_Paid",
  "Earned_Today",
  "Advance_Tomorrow",
  "Surplus",
  "Shortfall",
  "Status",
  "Status_Key",
  "Urgent_Count",
  "Advance_Count",
  "Surplus_Tickets",
  "Shortfall_Tickets",
  "Recorded_At",
];

const ACCOUNTING_TICKET_ARCHIVE_HEADERS = [
  "Ticket_Date",
  "Sheet_Row",
  "Create_Date",
  "BoothCode",
  "Customer_Name",
  "Quantity",
  "Amount",
  "Attribution",
  "Service_Date",
  "Slot_Info",
  "Recorded_At",
];

export async function ensureAccountingArchiveSheets() {
  await Promise.all([
    ensureSheet("Accounting_Daily_Summary", ACCOUNTING_DAILY_SUMMARY_HEADERS, 2),
    ensureSheet("Accounting_Ticket_Archive", ACCOUNTING_TICKET_ARCHIVE_HEADERS, 2),
  ]);
}

let archiveSaveQueue = Promise.resolve();

export async function saveAccountingArchive(items) {
  const runSave = async () => {
    const entries = Array.isArray(items) ? items : [items];
    const validEntries = entries.filter((e) => e?.date && (e.customerSummary?.length || e.rawTransactions?.length));
    if (validEntries.length === 0) return;
    await ensureAccountingArchiveSheets();
    const sheets = getSheetsClient();
    const recordedAt = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
      timeZone: "Asia/Bangkok",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());

    const targetDates = new Set(validEntries.map((e) => e.date));

    // 1. บันทึก Accounting_Daily_Summary
    const allNewSummaryRows = [];
    validEntries.forEach((entry) => {
      (entry.customerSummary || []).forEach((c) => {
        allNewSummaryRows.push([
          String(c.date || entry.date || "").trim(),
          String(c.boothCode || "").trim(),
          String(c.customerName || "").trim(),
          c.bookedTickets ?? 0,
          c.paidTickets ?? 0,
          c.totalPaid ?? 0,
          c.earnedToday ?? 0,
          c.advanceTomorrow ?? 0,
          c.surplus ?? 0,
          c.shortfall ?? 0,
          c.status,
          c.statusKey,
          c.urgentCount ?? 0,
          c.advanceCount ?? 0,
          c.surplusTickets ?? 0,
          c.shortfallTickets ?? 0,
          recordedAt,
        ]);
      });
    });

    if (allNewSummaryRows.length > 0) {
      const existingSummaryRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "Accounting_Daily_Summary!A2:Q",
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      const existingRows = existingSummaryRes.data.values || [];

      // Failsafe Guard: เช็คไม่ให้บันทึกทับข้อมูลเดิม ถ้าข้อมูลใหม่มียอดตั๋วจ่ายเป็น 0 หรือน้อยกว่าเดิมที่เคยบันทึกไว้
      const protectedDates = new Set();
      targetDates.forEach((tDate) => {
        const existingDateRows = existingRows.filter((r) => {
          const rDate = typeof r[0] === "number" ? isoFromSerial(r[0]) : String(r[0] || "").trim();
          return rDate === tDate;
        });
        const existingTotalPaid = existingDateRows.reduce((sum, r) => sum + (Number(r[4]) || 0), 0);
        const newTotalPaid = allNewSummaryRows
          .filter((r) => r[0] === tDate)
          .reduce((sum, r) => sum + (Number(r[4]) || 0), 0);

        if (existingTotalPaid > 0 && newTotalPaid < existingTotalPaid) {
          console.warn(`[saveAccountingArchive] Protected date ${tDate} from ticket loss! Existing paid: ${existingTotalPaid}, new: ${newTotalPaid}`);
          protectedDates.add(tDate);
        }
      });

      const safeNewSummaryRows = allNewSummaryRows.filter((r) => !protectedDates.has(r[0]));
      const datesToReplace = new Set([...targetDates].filter((d) => !protectedDates.has(d)));

      const filteredRows = existingRows
        .map((r) => {
          const rDate = typeof r[0] === "number" ? isoFromSerial(r[0]) : String(r[0] || "").trim();
          return [rDate, ...r.slice(1)];
        })
        .filter((r) => r[0] && !datesToReplace.has(r[0]));

      const combinedSummary = [...filteredRows, ...safeNewSummaryRows];
      combinedSummary.sort((a, b) => {
        const dateCmp = String(a[0]).localeCompare(String(b[0]));
        if (dateCmp !== 0) return dateCmp;
        return String(a[1]).localeCompare(String(b[1]), "th", { numeric: true });
      });

      if (combinedSummary.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: "Accounting_Daily_Summary!A2:Q",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: combinedSummary },
        });
        const existingDates = new Set(existingRows.map((r) => (typeof r[0] === "number" ? isoFromSerial(r[0]) : String(r[0] || "").trim())));
        const combinedDates = new Set(combinedSummary.map((r) => r[0]));
        const isEveryExistingDateKept = Array.from(existingDates).every((d) => !d || combinedDates.has(d));
        if (isEveryExistingDateKept && combinedSummary.length < existingRows.length) {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: SHEET_ID,
            range: `Accounting_Daily_Summary!A${combinedSummary.length + 2}:Q${existingRows.length + 1}`,
          });
        }
      }
    }

    // 2. บันทึก Accounting_Ticket_Archive
    const allNewTicketRows = [];
    validEntries.forEach((entry) => {
      (entry.rawTransactions || []).forEach((tx) => {
        allNewTicketRows.push([
          String(tx.posDate || entry.date || "").trim(),
          tx.sheetRow || "",
          tx.createDate || "",
          String(tx.boothCode || "").trim(),
          String(tx.customerName || "").trim(),
          tx.quantity || 1,
          tx.amount || 0,
          tx.attribution || "",
          tx.serviceDate || "",
          tx.slotInfo || "",
          recordedAt,
        ]);
      });
    });

    if (allNewTicketRows.length > 0) {
      const existingTicketRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: "Accounting_Ticket_Archive!A2:K",
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      const existingTx = existingTicketRes.data.values || [];

      // Failsafe Guard: ป้องกันไม่ให้ลบตั๋วเดิมของวันที่มีตั๋วอยู่แล้ว หากข้อมูลใหม่ส่งมาว่าง
      const protectedTxDates = new Set();
      targetDates.forEach((tDate) => {
        const existingCount = existingTx.filter((r) => {
          const rDate = typeof r[0] === "number" ? isoFromSerial(r[0]) : String(r[0] || "").trim();
          return rDate === tDate;
        }).length;
        const newCount = allNewTicketRows.filter((r) => r[0] === tDate).length;
        if (existingCount > 0 && newCount === 0) {
          console.warn(`[saveAccountingArchive] Protected ticket transactions for date ${tDate}!`);
          protectedTxDates.add(tDate);
        }
      });

      const safeNewTicketRows = allNewTicketRows.filter((r) => !protectedTxDates.has(r[0]));
      const datesToReplaceTx = new Set([...targetDates].filter((d) => !protectedTxDates.has(d)));

      const filteredTx = existingTx
        .map((r) => {
          const rDate = typeof r[0] === "number" ? isoFromSerial(r[0]) : String(r[0] || "").trim();
          return [rDate, ...r.slice(1)];
        })
        .filter((r) => r[0] && !datesToReplaceTx.has(r[0]));

      const combinedTx = [...filteredTx, ...safeNewTicketRows];
      combinedTx.sort((a, b) => {
        const dateCmp = String(a[0]).localeCompare(String(b[0]));
        if (dateCmp !== 0) return dateCmp;
        return (Number(a[1]) || 0) - (Number(b[1]) || 0);
      });

      if (combinedTx.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: "Accounting_Ticket_Archive!A2:K",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: combinedTx },
        });
        const existingTxDates = new Set(existingTx.map((r) => (typeof r[0] === "number" ? isoFromSerial(r[0]) : String(r[0] || "").trim())));
        const combinedTxDates = new Set(combinedTx.map((r) => r[0]));
        const isEveryTxDateKept = Array.from(existingTxDates).every((d) => !d || combinedTxDates.has(d));
        if (isEveryTxDateKept && combinedTx.length < existingTx.length) {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: SHEET_ID,
            range: `Accounting_Ticket_Archive!A${combinedTx.length + 2}:K${existingTx.length + 1}`,
          });
        }
      }
    }
  };

  archiveSaveQueue = archiveSaveQueue.then(runSave, runSave);
  return archiveSaveQueue;
}

export async function getAccountingArchive({ startDate, endDate } = {}) {
  await ensureAccountingArchiveSheets();
  const sheets = getSheetsClient();
  const [summaryRes, ticketRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Accounting_Daily_Summary!A2:Q",
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Accounting_Ticket_Archive!A2:K",
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
  ]);

  const summaryValues = summaryRes.data.values || [];
  const ticketValues = ticketRes.data.values || [];

  const startSerial = startDate ? isoDateToSerial(startDate) : 0;
  const endSerial = endDate ? isoDateToSerial(endDate) : FAR_FUTURE_SERIAL;

  const filteredSummary = summaryValues
    .map((r) => {
      const dateSerial = typeof r[0] === "number" ? r[0] : isoDateToSerial(String(r[0] || ""));
      const dateIso = isoFromSerial(dateSerial) || String(r[0] || "");
      return {
        date: dateIso,
        dateSerial,
        boothCode: String(r[1] || "").trim(),
        customerName: String(r[2] || "").trim(),
        bookedTickets: Number(r[3]) || 0,
        paidTickets: Number(r[4]) || 0,
        totalPaid: Number(r[5]) || 0,
        earnedToday: Number(r[6]) || 0,
        advanceTomorrow: Number(r[7]) || 0,
        surplus: Number(r[8]) || 0,
        shortfall: Number(r[9]) || 0,
        status: String(r[10] || ""),
        statusKey: String(r[11] || ""),
        urgentCount: Number(r[12]) || 0,
        advanceCount: Number(r[13]) || 0,
        surplusTickets: Number(r[14]) || 0,
        shortfallTickets: Number(r[15]) || 0,
        recordedAt: String(r[16] || ""),
      };
    })
    .filter((r) => r.dateSerial >= startSerial && r.dateSerial <= endSerial);

  const filteredTickets = ticketValues
    .map((r) => {
      const dateSerial = typeof r[0] === "number" ? r[0] : isoDateToSerial(String(r[0] || ""));
      const dateIso = isoFromSerial(dateSerial) || String(r[0] || "");
      return {
        posDate: dateIso,
        dateSerial,
        sheetRow: r[1] !== "" && r[1] !== undefined ? Number(r[1]) || r[1] : "-",
        createDate: String(r[2] || "-"),
        boothCode: String(r[3] || "").trim(),
        customerName: String(r[4] || "").trim(),
        quantity: Number(r[5]) || 1,
        amount: Number(r[6]) || 0,
        attribution: String(r[7] || ""),
        serviceDate: String(r[8] || "-"),
        slotInfo: String(r[9] || "-"),
        recordedAt: String(r[10] || ""),
      };
    })
    .filter((r) => r.dateSerial >= startSerial && r.dateSerial <= endSerial);

  const archivedDates = new Set(filteredSummary.map((r) => r.date));

  return {
    customerSummary: filteredSummary,
    rawTransactions: filteredTickets,
    archivedDates,
  };
}

