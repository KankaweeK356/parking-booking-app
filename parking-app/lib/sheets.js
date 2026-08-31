// lib/sheets.js
// จุดเดียวที่คุยกับ Google Sheet ทั้งหมด — หน้าอื่นๆ ไม่ต้องรู้เรื่อง Google API เลย
//
// โครงสร้างชีตที่โค้ดนี้อ้างอิง:
//   Master            : Header แถว 1, ข้อมูลแถว 2+   [Doc_Id, ชื่อลูกค้า, สถานะ]
//   Slot_Master       : Header แถว 1, ข้อมูลแถว 2+   [Slot_Code, ลาน, หมายเลขช่อง]
//   Booking_Input     : Header แถว 1, ข้อมูลแถว 2+   [ลูกค้า, Doc_Id(สูตร), ลาน, ช่อง, วันเริ่ม, วันสิ้นสุด,
//                                                     วันสิ้นสุด effective(สูตร), เวลาเริ่ม, เวลาสิ้นสุด(สูตร), เหตุผล]
//   Slot_Status_Log   : Header แถว 1, ข้อมูลแถว 2+   [ลาน+ช่อง, การกระทำ, เหตุผล, Timestamp]
//   Required_Summary  : ข้อมูลแถว 2+                 [Doc_Id, ชื่อลูกค้า, Required], F1 = วันที่ตรวจ

import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const BOOKING_FIRST_ROW = 2;
const BOOKING_LAST_ROW = 400;
const MASTER_FIRST_ROW = 2;
const SLOT_FIRST_ROW = 2;
const SLOT_LOG_FIRST_ROW = 2;

const GOOGLE_SHEETS_EPOCH = Date.UTC(1899, 11, 30); // 1899-12-30
const MS_PER_DAY = 86400000;

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

// serialToDateOnly(serial) แปลง Serial เป็นวันที่ (ตัดเวลาออก) แบบ UTC
export function serialToDateOnly(serial) {
  if (serial === null || serial === undefined || serial === "") return null;
  const num = typeof serial === "number" ? serial : Number(serial);
  if (isNaN(num)) return null;
  return Math.floor(num);
}

// serialToMinutes(serial) แปลงเวลา (เศษส่วนของวัน) เป็นนาที
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

// isoDateToSerial(isoStr) แปลง "YYYY-MM-DD" (จาก <input type="date">) เป็น Serial ให้เทียบกับข้อมูลจาก Sheet ได้ตรงกัน
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

// isoFromSerial(serial) แปลง Serial กลับเป็น "YYYY-MM-DD" ไว้โชว์หน้าจอ
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

// ---------- Slot_Master (ลาน + ช่องจอด) ----------

export async function getSlotList() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Master!A${SLOT_FIRST_ROW}:C`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  return rows
    .filter((r) => r[0])
    .map((r) => ({ slotCode: String(r[0]).trim(), lot: String(r[1]).trim(), number: String(r[2]).trim() }));
}

// ---------- Slot_Status_Log (ปิด/เปิดช่อง) ----------

export async function getSlotStatusMap() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Status_Log!A${SLOT_LOG_FIRST_ROW}:D`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  // สถานะปัจจุบันของช่อง = แถวล่าสุด (Timestamp ล่าสุด) ของช่องนั้น เทียบด้วยตัวเลขตรงๆ
  const latestByslot = {};
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

    const existing = latestByslot[slotCode];
    if (!existing || tsNum >= existing.tsNum) {
      latestByslot[slotCode] = {
        action,
        reason,
        ts: tsNum,
        tsNum,
        tsStr: typeof tsRaw === "number" ? isoFromSerial(tsRaw) : String(tsRaw || ""),
      };
    }
  }
  return latestByslot; // { A05: { action: 'ปิด', reason: '...', ts: 45535.5, tsNum: 45535.5, tsStr: '...' }, ... }
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

// ---------- Booking_Input ----------

// อ่านทุกแถวที่มีข้อมูลจริง พร้อมเลขแถวจริงใน Sheet (ใช้ตอนจะ Update แถวนั้นทีหลัง)
async function getAllBookingRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Booking_Input!A${BOOKING_FIRST_ROW}:J${BOOKING_LAST_ROW}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values || [];
  return rows.map((r, idx) => {
    const rawStart = r[4];
    const rawEnd = r[5];
    const rawEndEff = r[6];
    const rawStartTime = r[7];
    const rawEndTime = r[8];

    const startSerial = typeof rawStart === "number" ? serialToDateOnly(rawStart) : (rawStart ? isoDateToSerial(rawStart) : null);
    const endSerial = typeof rawEnd === "number" ? serialToDateOnly(rawEnd) : (rawEnd ? isoDateToSerial(rawEnd) : null);
    const endEffectiveSerial = typeof rawEndEff === "number" ? serialToDateOnly(rawEndEff) : (rawEndEff ? isoDateToSerial(rawEndEff) : endSerial);

    const startStr = typeof rawStart === "number" ? isoFromSerial(rawStart) : (rawStart ? String(rawStart).trim() : "");
    const endStr = typeof rawEnd === "number" ? isoFromSerial(rawEnd) : (rawEnd ? String(rawEnd).trim() : "");
    const endEffectiveStr = typeof rawEndEff === "number" ? isoFromSerial(rawEndEff) : (rawEndEff ? String(rawEndEff).trim() : (endStr || ""));

    const startMinutes = rawStartTime !== undefined && rawStartTime !== null && rawStartTime !== "" ? serialToMinutes(rawStartTime) : null;
    const endMinutes = rawEndTime !== undefined && rawEndTime !== null && rawEndTime !== "" ? serialToMinutes(rawEndTime) : (startMinutes !== null ? startMinutes + 240 : null);

    const startTimeStr = startMinutes !== null ? minutesToTimeStr(startMinutes) : (rawStartTime ? String(rawStartTime).trim() : "");
    const endTimeStr = endMinutes !== null ? minutesToTimeStr(endMinutes) : (rawEndTime ? String(rawEndTime).trim() : "");

    return {
      rowNumber: BOOKING_FIRST_ROW + idx,
      customer: r[0] ? String(r[0]).trim() : "",
      docId: r[1] !== undefined && r[1] !== null ? String(r[1]).trim() : "",
      lot: r[2] ? String(r[2]).trim() : "",
      slot: r[3] ? String(r[3]).trim() : "",
      // ข้อมูล String สำหรับแสดงผลหน้าบ้าน
      startDate: startStr,
      endDate: endStr,
      endDateEffective: endEffectiveStr,
      startTime: startTimeStr,
      endTime: endTimeStr,
      reason: r[9] ? String(r[9]).trim() : "",
      // ข้อมูล Serial และตัวเลข สำหรับใช้เปรียบเทียบตรรกะ
      startSerial,
      endSerial,
      endEffectiveSerial,
      startMinutes,
      endMinutes,
    };
  });
}

function isActiveToday(row) {
  const today = getTodaySerial();
  const start = row.startSerial;
  const endEff = row.endEffectiveSerial !== null && row.endEffectiveSerial !== undefined ? row.endEffectiveSerial : 999999;
  if (!start) return false;
  return start <= today && today <= endEff;
}

// รายการจองที่ Active วันนี้ ของลูกค้าคนหนึ่ง — ใช้ในหน้า "แก้ไข/ยกเลิก"
export async function getActiveBookingsForCustomer(customerName) {
  const all = await getAllBookingRows();
  return all.filter((r) => r.customer === customerName && !r.reason && isActiveToday(r));
  // !r.reason กันไม่ให้แถวที่ถูกปิดไปแล้ว (มีเหตุผลติดอยู่) โผล่มาให้เลือกปิดซ้ำอีก
}

// รายการจองที่ Active วันนี้ ของช่องหนึ่ง — ใช้เตือนตอน CS จะกดปิดช่องที่มีคนจองอยู่
export async function getActiveBookingsForSlot(slotCode) {
  const all = await getAllBookingRows();
  return all.filter((r) => r.slot === slotCode && !r.reason && isActiveToday(r));
}

export async function findConflict({ slot, startDate, endDate, startTime, excludeRowNumber }) {
  const all = await getAllBookingRows();
  const newStart = typeof startDate === "number" ? serialToDateOnly(startDate) : isoDateToSerial(startDate);
  const newEnd = endDate ? (typeof endDate === "number" ? serialToDateOnly(endDate) : isoDateToSerial(endDate)) : 999999;
  const newStartMin = typeof startTime === "number" ? serialToMinutes(startTime) : (typeof startTime === "string" ? serialToMinutes(startTime) : 0);
  const newEndMin = newStartMin + 4 * 60;

  for (const r of all) {
    if (r.rowNumber === excludeRowNumber) continue;
    if (r.slot !== slot) continue;
    if (r.reason) continue; // แถวที่ปิดไปแล้วไม่ต้องเช็คชน
    const rStart = r.startSerial;
    const rEnd = r.endEffectiveSerial !== null && r.endEffectiveSerial !== undefined ? r.endEffectiveSerial : 999999;
    if (!rStart) continue;
    const dateOverlap = rStart <= newEnd && rEnd >= newStart;
    if (!dateOverlap) continue;
    const rStartMin = r.startMinutes !== null ? r.startMinutes : 0;
    const rEndMin = r.endMinutes !== null ? r.endMinutes : (rStartMin + 4 * 60);
    const timeOverlap = rStartMin < newEndMin && newStartMin < rEndMin;
    if (timeOverlap) {
      return { conflict: true, withCustomer: r.customer, withSlot: r.slot };
    }
  }
  return { conflict: false };
}

// หาแถวว่างแถวแรก (คอลัมน์ A ว่าง) เพื่อเขียนการจองใหม่ โดยไม่ไปแตะแถวที่มีสูตรของแถวอื่นอยู่แล้ว
async function findNextEmptyRow() {
  const all = await getAllBookingRows();
  for (const r of all) {
    if (!r.customer) return r.rowNumber;
  }
  return BOOKING_FIRST_ROW + all.length; // เผื่อกรณีทุกแถวเต็มพอดี ต่อท้ายเลย
}

// เขียนการจองใหม่ — เขียนเฉพาะคอลัมน์ A,C,D,E,F,H เท่านั้น ไม่แตะ B,G,I เพราะเป็นสูตรที่ตั้งไว้ล่วงหน้าในชีต
export async function createBooking({ customer, lot, slot, startDate, endDate, startTime }) {
  const sheets = getSheetsClient();
  const rowNumber = await findNextEmptyRow();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `Booking_Input!A${rowNumber}`, values: [[customer]] },
        { range: `Booking_Input!C${rowNumber}:F${rowNumber}`, values: [[lot, slot, startDate, endDate || ""]] },
        { range: `Booking_Input!H${rowNumber}`, values: [[startTime]] },
      ],
    },
  });
  return { rowNumber };
}

// ปิดแถวเดิม (แก้ไข/ยกเลิก) — เขียนแค่ F (วันสิ้นสุด) กับ J (เหตุผล) ของแถวที่ระบุ ห้ามแตะคอลัมน์อื่นเด็ดขาด
export async function closeBookingRow({ rowNumber, endDate, reason }) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `Booking_Input!F${rowNumber}`, values: [[endDate]] },
        { range: `Booking_Input!J${rowNumber}`, values: [[reason]] },
      ],
    },
  });
}

// ---------- Required_Summary (จำนวนตั๋วที่ต้องตีต่อวัน) ----------

export async function getRequiredSummary() {
  const sheets = getSheetsClient();
  const [dateRes, rowsRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Required_Summary!F1",
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Required_Summary!A2:C",
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
  ]);

  const rawDate = dateRes.data.values?.[0]?.[0];
  let dateStr = "";
  if (typeof rawDate === "number") {
    dateStr = isoFromSerial(rawDate);
  } else if (rawDate) {
    dateStr = String(rawDate).trim();
  }
  if (!dateStr) {
    dateStr = isoFromSerial(getTodaySerial());
  }

  const rawRows = rowsRes.data.values || [];
  const rows = rawRows
    .filter((r) => r[1] && Number(r[2]) > 0)
    .map((r) => ({
      docId: r[0] ? String(r[0]).trim() : "",
      customer: String(r[1]).trim(),
      required: Number(r[2]),
    }));

  return { date: dateStr, rows };
}

export async function updateRequiredSummaryDate(dateStr) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Required_Summary!F1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[dateStr]] },
  });
  return getRequiredSummary();
}

