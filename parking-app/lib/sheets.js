// lib/sheets.js
// จุดเดียวที่คุยกับ Google Sheet ทั้งหมด — หน้าอื่นๆ ไม่ต้องรู้เรื่อง Google API เลย
//
// โครงสร้างชีตที่โค้ดนี้อ้างอิง (ต้องตรงกับไฟล์ Parking_Database.xlsx ที่ Import เข้า Google Sheet):
//   Master            : Header แถว 5, ข้อมูลแถว 6+   [Doc_Id, ชื่อลูกค้า, สถานะ, Last_Synced]
//   Slot_Master       : Header แถว 6, ข้อมูลแถว 7+   [Slot_Code, ลาน, หมายเลขช่อง, ตำแหน่งบนผัง]
//   Booking_Input     : Header แถว 6, ข้อมูลแถว 7+   [ลูกค้า, Doc_Id(สูตร), ลาน, ช่อง, วันเริ่ม, วันสิ้นสุด,
//                                                     วันสิ้นสุด effective(สูตร), เวลาเริ่ม, เวลาสิ้นสุด(สูตร), เหตุผล]
//   Slot_Status_Log   : Header แถว 5, ข้อมูลแถว 6+   [ลาน+ช่อง, การกระทำ, เหตุผล, Timestamp]

import { google } from "googleapis";

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const BOOKING_FIRST_ROW = 2;
const BOOKING_LAST_ROW = 400;
const MASTER_FIRST_ROW = 2;
const SLOT_FIRST_ROW = 2;
const SLOT_LOG_FIRST_ROW = 2;

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

// ---------- Master (รายชื่อลูกค้า) ----------

export async function getMasterList() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Master!A${MASTER_FIRST_ROW}:C`,
  });
  const rows = res.data.values || [];
  return rows
    .filter((r) => r[0] && r[1])
    .map((r) => ({ docId: String(r[0]).trim(), name: r[1], status: r[2] || "" }))
    .filter((c) => c.status === "Normal" || c.status === "");
}

// ---------- Slot_Master (ลาน + ช่องจอด) ----------

export async function getSlotList() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Master!A${SLOT_FIRST_ROW}:C`,
  });
  const rows = res.data.values || [];
  return rows
    .filter((r) => r[0])
    .map((r) => ({ slotCode: r[0], lot: r[1], number: r[2] }));
}

// ---------- Slot_Status_Log (ปิด/เปิดช่อง) ----------

export async function getSlotStatusMap() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `Slot_Status_Log!A${SLOT_LOG_FIRST_ROW}:D`,
  });
  const rows = res.data.values || [];
  // สถานะปัจจุบันของช่อง = แถวล่าสุด (Timestamp ล่าสุด) ของช่องนั้น
  const latestByslot = {};
  for (const r of rows) {
    const [slotCode, action, reason, ts] = r;
    if (!slotCode) continue;
    const existing = latestByslot[slotCode];
    if (!existing || new Date(ts) >= new Date(existing.ts)) {
      latestByslot[slotCode] = { action, reason, ts };
    }
  }
  return latestByslot; // { A05: { action: 'ปิด', reason: '...', ts: '...' }, ... }
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
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = res.data.values || [];
  return rows.map((r, idx) => ({
    rowNumber: BOOKING_FIRST_ROW + idx,
    customer: r[0] || "",
    docId: r[1] || "",
    lot: r[2] || "",
    slot: r[3] || "",
    startDate: r[4] || "",
    endDate: r[5] || "",
    endDateEffective: r[6] || "",
    startTime: r[7] || "",
    endTime: r[8] || "",
    reason: r[9] || "",
  }));
}

function toDateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function isActiveToday(row) {
  const today = toDateOnly(new Date());
  const start = toDateOnly(row.startDate);
  const endEff = row.endDateEffective ? toDateOnly(row.endDateEffective) : new Date(2099, 11, 31);
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


// duration คงที่ 4 ชั่วโมงเสมอ ตามกติการะบบ
function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}

export async function findConflict({ slot, startDate, endDate, startTime, excludeRowNumber }) {
  const all = await getAllBookingRows();
  const newStart = toDateOnly(startDate);
  const newEnd = endDate ? toDateOnly(endDate) : new Date(2099, 11, 31);
  const newStartMin = timeToMinutes(startTime);
  const newEndMin = newStartMin + 4 * 60;

  for (const r of all) {
    if (r.rowNumber === excludeRowNumber) continue;
    if (r.slot !== slot) continue;
    if (r.reason) continue; // แถวที่ปิดไปแล้วไม่ต้องเช็คชน
    const rStart = toDateOnly(r.startDate);
    const rEnd = r.endDateEffective ? toDateOnly(r.endDateEffective) : new Date(2099, 11, 31);
    if (!rStart) continue;
    const dateOverlap = rStart <= newEnd && rEnd >= newStart;
    if (!dateOverlap) continue;
    const rStartMin = timeToMinutes(r.startTime);
    const rEndMin = rStartMin + 4 * 60;
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
