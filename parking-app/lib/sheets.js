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
import { getCurrentOperationalDateIso, isOperationalTimeBlock } from "./operational-day";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const BOOKING_FIRST_ROW = 2;
const MASTER_FIRST_ROW = 2;
const SLOT_FIRST_ROW = 2;
const SLOT_LOG_FIRST_ROW = 2;

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

// ---------- Master (รายชื่อลูกค้า) ----------

export async function getMasterList() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Master!A${MASTER_FIRST_ROW}:C`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  return rows
    .filter((r) => r[0] && r[1])
    .map((r) => ({ docId: String(r[0]).trim(), name: String(r[1]).trim(), status: r[2] ? String(r[2]).trim() : "" }))
    .filter((c) => c.status === "Normal" || c.status === "");
}

export async function lookupDocId(customerName) {
  const master = await getMasterList();
  const found = master.find((m) => m.name === customerName);
  return found ? found.docId : "";
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

export async function appendSlotStatusLog({ slotCode, action, reason }) {
  const sheets = getSheetsClient();
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `Slot_Status_Log!A${SLOT_LOG_FIRST_ROW}:D`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[slotCode, action, reason || "", timestamp]] },
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
}) {
  await ensureChangeLogSheet();
  const sheets = getSheetsClient();
  const timestamp = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Booking_Change_Log!A:L",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        timestamp, action, customer, lot, slot, rowNumber,
        oldStartDate, oldEndDate, oldStartTime,
        newStartDate, newEndDate, newStartTime,
      ]],
    },
  });
}

// ---------- Urgent_Access_Log ----------
export async function ensureUrgentAccessLogSheet() {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const names = (meta.data.sheets || []).map((sheet) => sheet.properties?.title);
  if (names.includes("Urgent_Access_Log")) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: "Urgent_Access_Log" } } }] } });
  await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: "Urgent_Access_Log!A1:N1", valueInputOption: "USER_ENTERED", requestBody: { values: [["Created_At", "Ticket_Issued_Date", "Access_Operational_Date", "Action_Type", "Customer", "Doc_Id", "Booking_Row_Number", "Lot", "Slot_Code", "Slot_Number", "Start_Time", "Ticket_Count", "Reason", "Note"]] } });
}

export async function getUrgentAccessLogs() {
  await ensureUrgentAccessLogSheet();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Urgent_Access_Log!A2:N", valueRenderOption: "UNFORMATTED_VALUE" });
  return (res.data.values || []).map((r) => ({ createdAt: String(r[0] || ""), ticketIssuedDate: typeof r[1] === "number" ? isoFromSerial(r[1]) : String(r[1] || ""), accessDate: typeof r[2] === "number" ? isoFromSerial(r[2]) : String(r[2] || ""), actionType: String(r[3] || ""), customer: String(r[4] || ""), docId: String(r[5] || ""), bookingRowNumber: Number(r[6] || 0), lot: String(r[7] || ""), slot: String(r[8] || ""), number: String(r[9] || ""), startTime: typeof r[10] === "number" ? minutesToTimeStr(serialToMinutes(r[10])) : String(r[10] || ""), ticketCount: Number(r[11] || 1), reason: String(r[12] || ""), note: String(r[13] || "") }));
}

export async function appendUrgentAccessLogs({ customer, accessDate, entries, reason, note = "", actionType = "เปิดสิทธิ์จาก booking เดิม" }) {
  if (!customer || !accessDate || !Array.isArray(entries) || entries.length === 0 || !reason) throw new Error("กรอกข้อมูลเปิดสิทธิ์ด่วนไม่ครบถ้วน");
  await ensureUrgentAccessLogSheet();
  const docId = await lookupDocId(customer);
  const rows = entries.map((entry) => [new Date().toISOString(), getCurrentOperationalDateIso(), accessDate, actionType, customer, docId, entry.rowNumber || "", entry.lot || "", entry.slot, entry.number || "", entry.startTime, 1, reason, note]);
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "Urgent_Access_Log!A:N", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } });
  return { ok: true, count: rows.length };
}

// ---------- Booking_Input ----------

export async function getAllBookingRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Booking_Input!A${BOOKING_FIRST_ROW}:J`,
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
export async function createBookingBatch({ customer, lot, slots, startDate, endDate, startTime, reason = "จองใหม่" }) {
  const slotList = Array.isArray(slots) ? slots : [slots];
  if (!customer || !lot || slotList.length === 0 || !startDate || !endDate || !startTime) {
    throw new Error("กรอกข้อมูลไม่ครบถ้วน (ลูกค้า, ลาน, ช่อง, วันเริ่ม, วันสิ้นสุด, รอบเวลา)");
  }
  if (isoDateToSerial(endDate) < isoDateToSerial(startDate)) {
    throw new Error("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");
  }
  if (!isOperationalTimeBlock(startTime)) {
    throw new Error("รอบเวลาต้องเป็นหนึ่งใน 6 รอบของ operational day (เริ่ม 07:00)");
  }

  // 1. ตรวจสอบช่องซ้ำในชุดที่ส่งมา
  const uniqueSlots = Array.from(new Set(slotList));
  if (uniqueSlots.length !== slotList.length) {
    throw new Error("มีช่องจอดซ้ำกันในรายการที่เลือก");
  }

  // 2. ดึงสถานะรวม (baseStatus + Slot_Status_Log) และตรวจสอบล่วงหน้าทุกช่อง
  const slotsWithStatus = await getSlotsWithStatus();
  const statusMap = {};
  slotsWithStatus.forEach((s) => {
    statusMap[s.slotCode] = s;
  });

  // ช่องใน booking เดียวกันต้องมีลำดับคงที่ตามหมายเลขช่อง ไม่ขึ้นกับลำดับที่ CS คลิก
  const orderedSlotList = [...slotList].sort((left, right) => String(statusMap[left]?.number || left).localeCompare(String(statusMap[right]?.number || right), "th", { numeric: true }));

  for (const slot of orderedSlotList) {
    const slotInfo = statusMap[slot];
    if (!slotInfo || slotInfo.status === "ปิด" || slotInfo.isRoad) {
      throw new Error(`ช่อง ${slot} ถูกปิดใช้งานอยู่ (${slotInfo?.reason || "สถานะพื้นฐานปิดใช้งาน"}) ไม่สามารถจองได้`);
    }
    const conflict = await findConflict({ slot, startDate, endDate, startTime });
    if (conflict.conflict) {
      throw new Error(`ช่อง ${slot} ช่วงเวลานี้ชนกับการจองของ "${conflict.withCustomer}" แล้ว`);
    }
  }

  // 3. เตรียมข้อมูลและบันทึกแบบ Batch Append ต่อท้ายชีตตาม Production
  const docId = await lookupDocId(customer);
  const endEff = endDate;
  const startMin = toOperationalMinutes(serialToMinutes(startTime));
  const endMin = startMin + 240;
  const endTimeStr = minutesToTimeStr(endMin);

  const rowsToAppend = orderedSlotList.map((slot) => [
    customer,
    docId,
    lot,
    slot,
    startDate,
    endDate,
    endEff,
    startTime,
    endTimeStr,
    reason,
  ]);

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Booking_Input!A:J",
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
export async function closeBookingRow({ rowNumber, endDate, reason }) {
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

export async function closeMultipleBookingRows(rowNumbers, endDate, reason) {
  const outcomes = [];
  for (const rn of rowNumbers) {
    try {
      await closeBookingRow({ rowNumber: rn, endDate, reason });
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
    action: "ปรับวัน-เวลาจอง",
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
      values: [[startDate, endDate || "", endEff, startTime, endTimeStr, "ปรับวัน-เวลาจอด"]],
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
}) {
  const oldRow = await getBookingRow(oldRowNumber);
  if (!oldRow) throw new Error(`ไม่พบรายการจองเดิมแถวที่ ${oldRowNumber}`);

  // 1. เช็คสถานะช่องใหม่จาก getSlotsWithStatus
  const slotsWithStatus = await getSlotsWithStatus();
  const slotInfo = slotsWithStatus.find((s) => s.slotCode === newSlot);
  if (!slotInfo || slotInfo.status === "ปิด" || slotInfo.isRoad) {
    throw new Error(`ช่อง ${newSlot} ถูกปิดใช้งานอยู่ (${slotInfo?.reason || "สถานะพื้นฐานปิดใช้งาน"}) ไม่สามารถย้ายไปได้`);
  }

  // 2. เช็คเวลาชนกันของช่องใหม่ก่อนเสมอ
  const conflict = await findConflict({
    slot: newSlot,
    startDate: newStartDate,
    endDate: newEndDate,
    startTime: newStartTime,
  });
  if (conflict.conflict) {
    throw new Error(`ช่อง ${newSlot} ช่วงเวลานี้ชนกับการจองของ "${conflict.withCustomer}" แล้ว กรุณาเลือกช่องอื่น`);
  }

  // 3. ปิดแถวเดิม
  await closeBookingRow({
    rowNumber: oldRowNumber,
    endDate: oldEndDate,
    reason: "ย้ายออก (เปลี่ยนช่องจอด)",
  });

  // 4. สร้างการจองช่องใหม่
  const createResult = await createBookingBatch({
    customer,
    lot: newLot,
    slots: [newSlot],
    startDate: newStartDate,
    endDate: newEndDate,
    startTime: newStartTime,
    reason: "ย้ายเข้า (เปลี่ยนช่องจอด)",
  });

  return { ok: true, createResult };
}

// ปิดช่องจอด + ปิดการจองที่ค้างอยู่ไปพร้อมกัน
export async function closeSlotWithBookings({ slotCode, reason, bookingRowNumbersToClose }) {
  await appendSlotStatusLog({ slotCode, action: "ปิด", reason });
  const today = isoFromSerial(getTodaySerial());
  const bookingResults = [];
  for (const rn of bookingRowNumbersToClose || []) {
    try {
      await closeBookingRow({ rowNumber: rn, endDate: today, reason: `ปิดช่อง: ${reason}` });
      bookingResults.push({ rowNumber: rn, ok: true });
    } catch (err) {
      bookingResults.push({ rowNumber: rn, ok: false, error: err.message });
    }
  }
  return { ok: true, bookingResults };
}

// เปิดช่องจอดกลับมาใช้งาน
export async function openSlot(slotCode) {
  await appendSlotStatusLog({ slotCode, action: "เปิด", reason: "" });
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

  const allBookings = await getAllBookingRows();

  const countMap = {}; // key: docId (หรือชื่อลูกค้าถ้าไม่มี docId)
  for (const b of allBookings) {
    if (!b.startSerial) continue;
    const endEff = b.endEffectiveSerial !== null && b.endEffectiveSerial !== undefined ? b.endEffectiveSerial : FAR_FUTURE_SERIAL;
    if (b.startSerial <= targetSerial && targetSerial <= endEff) {
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

// ---------- Transection (รายการจ่ายเงิน) ----------
// อ่านตามชื่อหัวคอลัมน์ BoothCode และ DocDate (ไม่ยึดตำแหน่งคอลัมน์ตายตัว)
// ต้อง throw error เมื่อ header หายหรือ API fail ห้ามคืน []
export async function getTransectionRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Transection!A1:Z",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || "").trim());
  const boothCodeIdx = headers.indexOf("BoothCode");
  const docDateIdx = headers.indexOf("DocDate");
  if (boothCodeIdx === -1 || docDateIdx === -1) {
    throw new Error('ไม่พบคอลัมน์ "BoothCode" หรือ "DocDate" ในหัวตารางแท็บ Transection กรุณาตรวจสอบชื่อหัวตาราง');
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
  const [allBookings, slotsWithStatus] = await Promise.all([
    getAllBookingRows(),
    getSlotsWithStatus(),
  ]);

  const assignments = [];
  const futureAssignments = [];
  for (const b of allBookings) {
    const endEff = b.endEffectiveSerial !== null && b.endEffectiveSerial !== undefined ? b.endEffectiveSerial : FAR_FUTURE_SERIAL;
    if (!b.startSerial || endEff < targetSerial) continue;
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
// Logic Production เดิม:
// 1. หา booking ที่ active ในวัน targetDate (startDate <= targetDate && targetDate <= endDateEffective)
// 2. ตรวจสอบการชำระเงินจาก Transection: นับว่าจ่ายเมื่อมีรายการของ Doc_Id ในวันก่อนหน้า target date 1 วัน (dayBefore)
// 3. ห้ามแสดง unpaid booking เป็น occupied: ช่องที่ unpaid ต้องเป็นสถานะว่าง (green) เพื่อให้ทีมสนามตรวจแอบจอด
export async function getDashboardData(dateStr) {
  const targetDateStr = dateStr || getCurrentOperationalDateIso();
  const targetSerial = isoDateToSerial(targetDateStr);
  const dayBeforeSerial = targetSerial - 1;
  const dayBeforeStr = isoFromSerial(dayBeforeSerial);

  const [allBookings, slotsWithStatus, transectionRows, urgentLogs] = await Promise.all([
    getAllBookingRows(),
    getSlotsWithStatus(),
    getTransectionRows(),
    getUrgentAccessLogs(),
  ]);

  // หา bookings ที่ active ในวันเป้าหมาย
  const activeBookings = allBookings.filter((b) => {
    if (!b.startSerial) return false;
    const endEff = b.endEffectiveSerial !== null && b.endEffectiveSerial !== undefined ? b.endEffectiveSerial : FAR_FUTURE_SERIAL;
    return b.startSerial <= targetSerial && targetSerial <= endEff;
  });

  // ตั๋ว 1 ใบ = 1 Transection row. ตั๋วด่วนของวันก่อนถูกหักออกก่อนให้สิทธิ์วันนี้
  const ticketCountByDocId = new Map();
  transectionRows.forEach((t) => {
    if (t.dateSerial === dayBeforeSerial && t.boothCode) {
      ticketCountByDocId.set(t.boothCode, (ticketCountByDocId.get(t.boothCode) || 0) + 1);
    }
  });
  urgentLogs.filter((log) => log.ticketIssuedDate === dayBeforeStr && log.docId).forEach((log) => {
    ticketCountByDocId.set(log.docId, Math.max(0, (ticketCountByDocId.get(log.docId) || 0) - log.ticketCount));
  });

  const paidBookings = [];
  const unpaidBookings = [];
  const activeByDoc = new Map();
  activeBookings.forEach((booking) => { const key = booking.docId || booking.customer; if (!activeByDoc.has(key)) activeByDoc.set(key, []); activeByDoc.get(key).push(booking); });
  activeByDoc.forEach((bookings, key) => {
    let availableTickets = ticketCountByDocId.get(key) || 0;
    bookings.sort((a, b) => a.rowNumber - b.rowNumber);
    bookings.forEach((b) => {
      const isPaid = availableTickets > 0;
      if (isPaid) availableTickets -= 1;
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
  });

  // สิทธิ์ด่วนมีผลทันทีใน operational day ที่ CS ระบุ
  const existingKeys = new Set(paidBookings.map((b) => `${b.slot}::${b.startTime}`));
  urgentLogs.filter((log) => log.accessDate === targetDateStr).forEach((log) => {
    const booking = activeBookings.find((b) => b.slot === log.slot && b.startTime === log.startTime && (log.bookingRowNumber ? b.rowNumber === log.bookingRowNumber : true));
    if (!booking) return;
    const key = `${booking.slot}::${booking.startTime}`;
    if (!existingKeys.has(key)) { paidBookings.push({ slot: booking.slot, lot: booking.lot, customer: booking.customer, docId: booking.docId, startDate: booking.startDate, endDate: booking.endDate, startTime: booking.startTime, endTime: booking.endTime, startMin: booking.startMinutes, endMin: booking.endMinutes, isPaid: true, isUrgent: true }); existingKeys.add(key); }
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
    slots,
    bookings: paidBookings, // เฉพาะที่ชำระเงินแล้วเท่านั้นที่เป็น occupied
    unpaidBookings,        // ส่งไปเพื่อข้อมูลอ้างอิง แต่ไม่นับเป็น occupied
  };
}
