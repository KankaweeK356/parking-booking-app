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
//   Transection       : Header แถว 1, ข้อมูลแถว 2+   [BoothCode, DocDate]

import { google } from "googleapis";
import { getBangkokCalendarDateIso, getCurrentOperationalBlock, getCurrentOperationalDateIso, getUrgentAccessDefaultDateIso, isBeforeOperationalBlockStart, isOperationalTimeBlock } from "./operational-day";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const BOOKING_FIRST_ROW = 2;
const MASTER_FIRST_ROW = 2;
const SLOT_FIRST_ROW = 2;
const SLOT_LOG_FIRST_ROW = 2;
let knownSheetNames = null;
let loadingSheetNames = null;
let adjustmentLogHeadersReady = false;
let urgentLogHeadersReady = false;

const GOOGLE_SHEETS_EPOCH = Date.UTC(1899, 11, 30); // 1899-12-30
const MS_PER_DAY = 86400000;
const FAR_FUTURE_SERIAL = 73050; // 2099-12-31
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

// ตรวจสอบว่าข้อความในคอลัมน์เหตุผลถือเป็น Closing reason (ปิด/ยกเลิก/ย้ายออกไปแล้ว) หรือไม่
// ใช้เฉพาะในหน้า Edit Booking และ Slot Status (linked bookings) เท่านั้น
export function isClosingReason(reason) {
  const r = String(reason || "");
  return r.includes("ยกเลิก") || r.includes("ย้ายออก") || r.includes("ปิดช่อง");
}

// ---------- Tbt_ServiceCharge (รายชื่อลูกค้าที่ MIS อนุญาตให้จอง) ----------

export async function getMasterList() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Tbt_ServiceCharge!A1:Z",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
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
  const sheets = getSheetsClient();
  await getKnownSheetNames(sheets);
  if (!knownSheetNames.has(title)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${title}!A1`, valueInputOption: "USER_ENTERED", requestBody: { values: [headers] } });
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
  return (res.data.values || []).filter((row) => row[0]).map((row, index) => ({ rowNumber: index + 2, employeeId: String(row[0]).trim(), name: String(row[1] || "").trim(), department: String(row[2] || "").trim(), role: String(row[3] || "Field").trim(), active: ["ใช้งาน", "active", "true", "1"].includes(String(row[4] || "").trim().toLowerCase()) }));
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
  if (!existing || !existing.active) throw new Error("ไม่พบรหัสพนักงานที่เปิดใช้งาน กรุณาติดต่อ Admin");
  if (existing.account) throw new Error("รหัสพนักงานนี้สมัครใช้งานแล้ว");
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
export async function getSlotList() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Master!A${SLOT_FIRST_ROW}:E`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      slotCode: String(r[0]).trim(),
      lot: String(r[1] || "").trim(),
      number: String(r[2] || "").trim(),
      position: String(r[3] || "").trim(),
      baseStatus: String(r[4] || "เปิด").trim(),
    }));
}

export async function getLots() {
  const slots = await getSlotList();
  return Array.from(new Set(slots.map((s) => s.lot).filter(Boolean))).sort();
}

export async function getSlotStatusMap() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Status_Log!A${SLOT_LOG_FIRST_ROW}:D`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
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
  const sheetNames = (meta.data.sheets || []).map((s) => s.properties?.title);
  if (!sheetNames.includes("Booking_Change_Log")) {
    await sheets.spreadsheets.batchUpdate({
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
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Booking_Change_Log!A:N",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        timestamp, action, customer, lot, slot, rowNumber,
        oldStartDate, oldEndDate, oldStartTime,
        newStartDate, newEndDate, newStartTime, actor?.employeeId || "", actor?.name || "",
      ]],
    },
  });
}

// ---------- Booking_Adjustment_Log (ลดเฉพาะวัน) ----------
export async function ensureAdjustmentLogSheet() {
  await ensureSheet("Booking_Adjustment_Log", ["Created_At", "Effective_Date", "Action", "Booking_Row_Number", "Reason"], 2);
  if (!adjustmentLogHeadersReady) {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Booking_Adjustment_Log!F1:G1", valueInputOption: "USER_ENTERED", requestBody: { values: [["Created_By_Employee_Id", "Created_By_Name"]] } });
    adjustmentLogHeadersReady = true;
  }
}

export async function appendDailyAdjustments({ rowNumbers, effectiveDate, reason = "ลดสิทธิ์เฉพาะวัน", actor }) {
  await ensureAdjustmentLogSheet();
  const sheets = getSheetsClient();
  const rows = rowNumbers.map((rowNumber) => [new Date().toISOString(), effectiveDate, "ลดเฉพาะวัน", rowNumber, reason, actor?.employeeId || "", actor?.name || ""]);
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Booking_Adjustment_Log!A2:G", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } });
}

export async function getAdjustedBookingRows(dateStr) {
  await ensureAdjustmentLogSheet();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Booking_Adjustment_Log!A2:E", valueRenderOption: "UNFORMATTED_VALUE" });
  return new Set((res.data.values || []).filter((row) => isoFromSerial(row[1]) === dateStr || String(row[1] || "") === dateStr).filter((row) => String(row[2] || "").includes("ลด")).map((row) => Number(row[3])).filter(Boolean));
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

export async function getAllBookingRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Booking_Input!A${BOOKING_FIRST_ROW}:M`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
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

  return rows.map((r, idx) => {
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
  });
}

export async function getBookingRow(rowNumber) {
  const all = await getAllBookingRows();
  return all.find((r) => r.rowNumber === Number(rowNumber)) || null;
}

// รายการจองที่ยัง Active ของลูกค้าคนหนึ่ง — ใช้ในหน้า "ปรับ/ยกเลิกการจอง"
// ซ่อนเฉพาะรายการที่มี closing reason (เช่น ยกเลิก, ย้ายออก, ปิดช่อง) เท่านั้น
export async function getActiveBookingsForCustomer(customerName) {
  const all = await getAllBookingRows();
  const today = getTodaySerial();
  return all
    .filter((r) => {
      if (r.customer !== customerName) return false;
      const endEff = r.endEffectiveSerial !== null && r.endEffectiveSerial !== undefined ? r.endEffectiveSerial : FAR_FUTURE_SERIAL;
      if (endEff < today) return false;
      if (isClosingReason(r.reason)) return false;
      return true;
    })
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
  const all = await getAllBookingRows();
  const newStart = typeof startDate === "number" ? serialToDateOnly(startDate) : isoDateToSerial(startDate);
  const newEnd = endDate ? (typeof endDate === "number" ? serialToDateOnly(endDate) : isoDateToSerial(endDate)) : FAR_FUTURE_SERIAL;
  const rawNewStartMin = typeof startTime === "number" ? serialToMinutes(startTime) : (typeof startTime === "string" ? serialToMinutes(startTime) : 0);
  const newStartMin = toOperationalMinutes(rawNewStartMin);
  const newEndMin = newStartMin + 240;

  for (const r of all) {
    if (r.rowNumber === excludeRowNumber) continue;
    if (String(r.slot) !== String(slot)) continue;
    if (!r.startSerial) continue;

    const rStart = r.startSerial;
    const rEnd = r.endEffectiveSerial !== null && r.endEffectiveSerial !== undefined ? r.endEffectiveSerial : FAR_FUTURE_SERIAL;
    const dateOverlap = rStart <= newEnd && rEnd >= newStart;
    if (!dateOverlap) continue;

    const rStartMin = r.startMinutes !== null ? r.startMinutes : 0;
    const rEndMin = r.endMinutes !== null ? r.endMinutes : (rStartMin + 240);
    const timeOverlap = rStartMin < newEndMin && newStartMin < rEndMin;
    if (timeOverlap) {
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

  for (const slot of orderedSlotList) {
    const slotInfo = statusMap[slot];
    if (!slotInfo || slotInfo.status === "ปิด" || slotInfo.isRoad) {
      throw new Error(`ช่อง ${slot} ถูกปิดใช้งานอยู่ (${slotInfo?.reason || "สถานะพื้นฐานปิดใช้งาน"}) ไม่สามารถจองได้`);
    }
    for (const time of orderedTimeList) {
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

  await appendBookingChangeLog({
    action: reason || "ปิด/ยกเลิก",
    customer: oldRow?.customer || "",
    lot: oldRow?.lot || "",
    slot: oldRow?.slot || "",
    rowNumber,
    oldStartDate: oldRow?.startDate || "",
    oldEndDate: oldRow?.endDate || "",
    oldStartTime: oldRow?.startTime || "",
    newStartDate: oldRow?.startDate || "",
    newEndDate: endDate,
    newStartTime: oldRow?.startTime || "",
    actor,
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `Booking_Input!F${rowNumber}:G${rowNumber}`, values: [[endDate, endDate]] },
        { range: `Booking_Input!J${rowNumber}`, values: [[reason]] },
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
  const effectiveOldEndDate = getCurrentOperationalDateIso();
  const effectiveNewStartDate = addDaysIso(effectiveOldEndDate, 1);
  const effectiveNewEndDate = oldRow.endDate;
  const effectiveNewStartTime = oldRow.startTime;
  if (!effectiveNewEndDate) throw new Error("รายการเดิมไม่มีวันสิ้นสุด จึงยังย้ายช่องตามกติกาใหม่ไม่ได้");

  // 1. เช็คสถานะช่องใหม่จาก getSlotsWithStatus
  const slotsWithStatus = await getSlotsWithStatus();
  const slotInfo = slotsWithStatus.find((s) => s.slotCode === newSlot);
  if (!slotInfo || slotInfo.status === "ปิด" || slotInfo.isRoad) {
    throw new Error(`ช่อง ${newSlot} ถูกปิดใช้งานอยู่ (${slotInfo?.reason || "สถานะพื้นฐานปิดใช้งาน"}) ไม่สามารถย้ายไปได้`);
  }

  // 2. เช็คเวลาชนกันของช่องใหม่ก่อนเสมอ
  const conflict = await findConflict({
    slot: newSlot,
    startDate: effectiveNewStartDate,
    endDate: effectiveNewEndDate,
    startTime: effectiveNewStartTime,
  });
  if (conflict.conflict) {
    throw new Error(`ช่อง ${newSlot} ช่วงเวลานี้ชนกับการจองของ "${conflict.withCustomer}" แล้ว กรุณาเลือกช่องอื่น`);
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
  const selectedDateStr = dateStr || isoFromSerial(getTodaySerial());
  const selectedSerial = isoDateToSerial(selectedDateStr);
  const targetSerial = selectedSerial + 1; // วันที่ X + 1
  const targetDateStr = isoFromSerial(targetSerial);

  const [allBookings, adjustedRows] = await Promise.all([getAllBookingRows(), getAdjustedBookingRows(targetDateStr)]);

  const countMap = {}; // key: docId (หรือชื่อลูกค้าถ้าไม่มี docId)
  for (const b of allBookings) {
    if (!b.startSerial) continue;
    const endEff = b.endEffectiveSerial !== null && b.endEffectiveSerial !== undefined ? b.endEffectiveSerial : FAR_FUTURE_SERIAL;
    if (!adjustedRows.has(b.rowNumber) && b.startSerial <= targetSerial && targetSerial <= endEff) {
      const key = b.docId || b.customer;
      if (!countMap[key]) {
        countMap[key] = {
          docId: b.docId || "",
          name: b.customer,
          customer: b.customer,
          required: 0,
        };
      }
      countMap[key].required += 1;
    }
  }

  const rows = Object.values(countMap);
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));

  return {
    selectedDate: selectedDateStr,
    targetDate: targetDateStr,
    date: targetDateStr,
    rows,
  };
}

// ---------- tbt_DailyFee (รายการตั๋วจาก MIS) ----------
// อ่านตามชื่อหัวคอลัมน์ BoothCode และ Docdate โดยไม่สนตัวพิมพ์เล็ก/ใหญ่
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
  if (boothCodeIdx === -1 || docDateIdx === -1) {
    throw new Error('ไม่พบคอลัมน์ "BoothCode" หรือ "Docdate" ในหัวตารางแท็บ tbt_DailyFee กรุณาตรวจสอบชื่อหัวตาราง');
  }

  return rows.slice(1).filter((r) => r[boothCodeIdx] && r[docDateIdx]).map((r) => {
    const rawDate = r[docDateIdx];
    const dateSerial = typeof rawDate === "number" ? serialToDateOnly(rawDate) : (rawDate ? isoDateToSerial(rawDate) : null);
    return {
      boothCode: String(r[boothCodeIdx]).trim(),
      dateSerial,
      dateStr: isoFromSerial(dateSerial),
    };
  });
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
  const futureAssignments = [];
  for (const b of allBookings) {
    const endEff = b.endEffectiveSerial !== null && b.endEffectiveSerial !== undefined ? b.endEffectiveSerial : FAR_FUTURE_SERIAL;
    if (!b.startSerial || endEff < targetSerial || adjustedRows.has(b.rowNumber)) continue;
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
    if (b.startSerial > targetSerial) {
      futureAssignments.push(assignment);
    } else {
      assignments.push(assignment);
    }
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
    futureAssignments,
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

function snapshotKey(rowNumber) { return String(rowNumber || ""); }

export async function getPaymentSnapshot(operationalDate) {
  await ensurePaymentSnapshotSheets();
  const sheets = getSheetsClient();
  const [runsRes, rowsRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Payment_Snapshot_Run!A2:D", valueRenderOption: "UNFORMATTED_VALUE" }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Payment_Snapshot!A2:H", valueRenderOption: "UNFORMATTED_VALUE" }),
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
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Payment_Refresh_Log!A2:E", valueRenderOption: "UNFORMATTED_VALUE" });
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

export async function createPaymentSnapshot(operationalDate) {
  if (!operationalDate || !isoDateToSerial(operationalDate)) throw new Error("วันที่สร้างสิทธิ์ไม่ถูกต้อง");
  await ensurePaymentSnapshotSheets();
  const targetSerial = isoDateToSerial(operationalDate);
  const sourceSerial = targetSerial - 1;
  const sourceDate = isoFromSerial(sourceSerial);
  const [allBookings, slotsWithStatus, transectionRows, urgentLogs, adjustedRows] = await Promise.all([
    getAllBookingRows(), getSlotsWithStatus(), getTransectionRows(), getUrgentAccessLogs(), getAdjustedBookingRows(operationalDate),
  ]);
  const activeBookings = allBookings.filter((booking) => {
    const endEff = booking.endEffectiveSerial ?? FAR_FUTURE_SERIAL;
    return booking.bookingType !== "Urgent" && booking.startSerial && !adjustedRows.has(booking.rowNumber) && booking.startSerial <= targetSerial && targetSerial <= endEff;
  });
  const ticketCountByDocId = new Map();
  transectionRows.filter((ticket) => ticket.dateSerial === sourceSerial && ticket.boothCode).forEach((ticket) => {
    ticketCountByDocId.set(ticket.boothCode, (ticketCountByDocId.get(ticket.boothCode) || 0) + 1);
  });
  urgentLogs.filter((log) => log.ticketIssuedDate === sourceDate && log.docId).forEach((log) => {
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

  const [allBookings, slotsWithStatus, urgentLogs, adjustedRows, paymentSnapshot] = await Promise.all([
    getAllBookingRows(),
    getSlotsWithStatus(),
    getUrgentAccessLogs(),
    getAdjustedBookingRows(targetDateStr),
    getPaymentSnapshot(targetDateStr),
  ]);

  // หา bookings ที่ active ในวันเป้าหมาย
  const activeBookings = allBookings.filter((b) => {
    if (!b.startSerial) return false;
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

  // สิทธิ์ด่วนมีผลทันทีใน operational day ที่ CS ระบุ
  const currentBlockStart = getCurrentOperationalBlock().startTime;
  urgentLogs.filter((log) => log.accessDate === targetDateStr && !(targetDateStr === currentOperationalDate && toOperationalMinutes(log.startTime ? serialToMinutes(log.startTime) : 0) < toOperationalMinutes(serialToMinutes(currentBlockStart)))).forEach((log) => {
    const booking = activeBookings.find((b) => b.slot === log.slot && b.startTime === log.startTime && (log.bookingRowNumber ? b.rowNumber === log.bookingRowNumber : true));
    if (!booking) return;
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
