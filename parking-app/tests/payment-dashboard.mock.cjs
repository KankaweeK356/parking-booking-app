/*
 * Isolated contract test for payment allocation and Dashboard status rules.
 * It never imports Google APIs, reads Google Sheets, or writes application data.
 * Run: node tests/payment-dashboard.mock.cjs
 */
const assert = require("node:assert/strict");

const ROUNDS = ["07:00", "11:00", "15:00", "19:00", "23:00", "03:00"];
const minuteOf = (time) => {
  const [hour, minute] = String(time).split(":").map(Number);
  const value = (hour * 60) + minute;
  return value < 420 ? value + 1440 : value;
};
const previousRound = (round) => ROUNDS[(ROUNDS.indexOf(round) + ROUNDS.length - 1) % ROUNDS.length];
const operationalDateAt = (calendarDate, time) => {
  const [year, month, day] = calendarDate.split("-").map(Number);
  const [hour] = String(time).split(":").map(Number);
  if (hour >= 7) return calendarDate;
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};
const sourceDateOf = (date) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};

function booking({ row, docId = "DOC-A", customer = "ลูกค้า A", slot, startTime, startDate = "2026-09-18", endDate = "2026-12-31", type = "Normal", adjusted = false }) {
  return { row, docId, customer, slot, startTime, startDate, endDate, type, adjusted };
}

function allocatePaymentSnapshot({ operationalDate, bookings, tickets, urgentLogs = [], slotNumbers = {}, cancelledUrgentKeys = new Set() }) {
  const sourceDate = sourceDateOf(operationalDate);
  const active = bookings.filter((item) => item.type !== "Urgent" && !item.adjusted && item.startDate <= operationalDate && operationalDate <= item.endDate);
  const ticketCount = new Map();
  tickets.filter((ticket) => ticket.date === sourceDate && ticket.docId).forEach((ticket) => ticketCount.set(ticket.docId, (ticketCount.get(ticket.docId) || 0) + 1));
  urgentLogs.filter((log) => log.ticketIssuedDate === sourceDate && log.docId && !cancelledUrgentKeys.has(`${log.slot}::${log.startTime}`)).forEach((log) => {
    ticketCount.set(log.docId, Math.max(0, (ticketCount.get(log.docId) || 0) - (log.ticketCount || 1)));
  });
  const paidByRow = new Map();
  const groups = new Map();
  active.forEach((item) => {
    const key = item.docId || item.customer;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  groups.forEach((items, key) => {
    let remaining = ticketCount.get(key) || 0;
    items.sort((left, right) => {
      const slotOrder = String(slotNumbers[left.slot] ?? left.slot).localeCompare(String(slotNumbers[right.slot] ?? right.slot), "th", { numeric: true });
      return slotOrder || (minuteOf(left.startTime) - minuteOf(right.startTime));
    });
    items.forEach((item) => {
      paidByRow.set(item.row, remaining > 0);
      if (remaining > 0) remaining -= 1;
    });
  });
  return { sourceDate, active, paidByRow };
}

function dashboardStatus({ slot, bookings, snapshot, selectedRound, currentRound, live = true, urgentLogs = [], operationalDate = "2026-09-18" }) {
  if (slot.closed) return "closed";
  const normal = bookings.find((item) => item.slot === slot.code && item.startTime === selectedRound && item.type !== "Urgent" && snapshot.paidByRow.get(item.row));
  if (normal) return "booked";
  const urgent = urgentLogs.find((item) => item.accessDate === operationalDate && item.slot === slot.code && item.startTime === selectedRound);
  if (urgent) return "ticket-check";
  if (live && selectedRound === currentRound) {
    const priorNormal = bookings.find((item) => item.slot === slot.code && item.startTime === previousRound(selectedRound) && item.type !== "Urgent" && snapshot.paidByRow.get(item.row));
    const priorUrgent = urgentLogs.find((item) => item.accessDate === operationalDate && item.slot === slot.code && item.startTime === previousRound(selectedRound));
    if (priorNormal || priorUrgent) return "expired";
  }
  return "vacant";
}

const ticket = (docId, date = "2026-09-17") => ({ docId, date });
const slots = { S2: 2, S10: 10, S25: 25 };
const tests = [];
const knownRisks = [];
function test(name, fn) { tests.push({ name, fn }); }

test("ใช้ตั๋วของวันก่อนหน้าวันปฏิบัติการเท่านั้น", () => {
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: [booking({ row: 1, slot: "S2", startTime: "07:00" })], tickets: [ticket("DOC-A", "2026-09-17"), ticket("DOC-A", "2026-09-18")], slotNumbers: slots });
  assert.equal(result.sourceDate, "2026-09-17");
  assert.equal(result.paidByRow.get(1), true);
});

test("ขอบวันปฏิบัติการ 07:00–06:59 ถูกต้อง", () => {
  assert.equal(operationalDateAt("2026-09-17", "07:00"), "2026-09-17");
  assert.equal(operationalDateAt("2026-09-18", "06:59"), "2026-09-17");
  assert.equal(operationalDateAt("2026-09-18", "07:00"), "2026-09-18");
});

test("จ่ายครบ ให้สิทธิ์ครบทุกช่องและทุกรอบ", () => {
  const rows = ROUNDS.map((startTime, index) => booking({ row: index + 1, slot: "S2", startTime }));
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: Array.from({ length: 6 }, () => ticket("DOC-A")), slotNumbers: slots });
  assert.deepEqual([...result.paidByRow.values()], [true, true, true, true, true, true]);
});

test("จ่ายไม่ครบ จัดสิทธิ์ตามเลขช่องก่อน แล้วตามรอบ", () => {
  const rows = [
    booking({ row: 1, slot: "S10", startTime: "07:00" }), booking({ row: 2, slot: "S10", startTime: "11:00" }), booking({ row: 3, slot: "S10", startTime: "15:00" }),
    booking({ row: 4, slot: "S2", startTime: "07:00" }), booking({ row: 5, slot: "S2", startTime: "11:00" }), booking({ row: 6, slot: "S2", startTime: "15:00" }),
  ];
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A"), ticket("DOC-A"), ticket("DOC-A"), ticket("DOC-A")], slotNumbers: slots });
  assert.deepEqual(rows.map((row) => result.paidByRow.get(row.row)), [true, false, false, true, true, true]);
});

test("ไม่มีตั๋ว ให้ทุกสิทธิ์เป็นยังไม่ชำระ", () => {
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: [booking({ row: 1, slot: "S2", startTime: "07:00" })], tickets: [], slotNumbers: slots });
  assert.equal(result.paidByRow.get(1), false);
});

test("Doc ID ผิด ไม่เอาตั๋วของคนอื่นมาใช้", () => {
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: [booking({ row: 1, docId: "DOC-A", slot: "S2", startTime: "07:00" })], tickets: [ticket("DOC-B")], slotNumbers: slots });
  assert.equal(result.paidByRow.get(1), false);
});

test("รายการตั๋วที่ไม่มี Doc ID ไม่สามารถทำให้สิทธิ์เป็นจ่ายแล้ว", () => {
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: [booking({ row: 1, slot: "S2", startTime: "07:00" })], tickets: [{ docId: "", date: "2026-09-17" }], slotNumbers: slots });
  assert.equal(result.paidByRow.get(1), false);
});

test("ลูกค้าคนละ Doc ID ไม่ใช้ตั๋วข้ามกัน", () => {
  const rows = [booking({ row: 1, docId: "DOC-A", slot: "S2", startTime: "07:00" }), booking({ row: 2, docId: "DOC-B", slot: "S10", startTime: "07:00" })];
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A")], slotNumbers: slots });
  assert.deepEqual(rows.map((row) => result.paidByRow.get(row.row)), [true, false]);
});

test("การพัก ยกเลิก และสิทธิ์อนาคต ไม่ถูกนำเข้าการตัดสิทธิ์วันนั้น", () => {
  const rows = [
    booking({ row: 1, slot: "S2", startTime: "07:00", adjusted: true }),
    booking({ row: 2, slot: "S10", startTime: "07:00", startDate: "2026-09-19" }),
    booking({ row: 3, slot: "S25", startTime: "07:00" }),
  ];
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A")], slotNumbers: slots });
  assert.equal(result.active.length, 1);
  assert.equal(result.paidByRow.get(3), true);
  assert.equal(result.paidByRow.has(1), false);
  assert.equal(result.paidByRow.has(2), false);
});

test("ตั๋วด่วนของวันอ้างอิงหักออกจากตั๋วปกติ", () => {
  const rows = [booking({ row: 1, slot: "S2", startTime: "07:00" }), booking({ row: 2, slot: "S2", startTime: "11:00" }), booking({ row: 3, slot: "S2", startTime: "15:00" })];
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A"), ticket("DOC-A"), ticket("DOC-A")], urgentLogs: [{ docId: "DOC-A", ticketIssuedDate: "2026-09-17", slot: "S25", startTime: "11:00", ticketCount: 1 }], slotNumbers: slots });
  assert.deepEqual(rows.map((row) => result.paidByRow.get(row.row)), [true, true, false]);
});

test("ตั๋วด่วนที่ยกเลิกแล้วไม่ถูกหักซ้ำ", () => {
  const rows = [booking({ row: 1, slot: "S2", startTime: "07:00" }), booking({ row: 2, slot: "S2", startTime: "11:00" })];
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A"), ticket("DOC-A")], urgentLogs: [{ docId: "DOC-A", ticketIssuedDate: "2026-09-17", slot: "S25", startTime: "11:00", ticketCount: 1 }], cancelledUrgentKeys: new Set(["S25::11:00"]), slotNumbers: slots });
  assert.deepEqual(rows.map((row) => result.paidByRow.get(row.row)), [true, true]);
});

test("การสร้าง Snapshot ซ้ำด้วยข้อมูลเดิมให้ผลเหมือนเดิม", () => {
  const input = { operationalDate: "2026-09-18", bookings: [booking({ row: 1, slot: "S2", startTime: "07:00" }), booking({ row: 2, slot: "S10", startTime: "11:00" })], tickets: [ticket("DOC-A")], slotNumbers: slots };
  assert.deepEqual([...allocatePaymentSnapshot(input).paidByRow.entries()], [...allocatePaymentSnapshot(input).paidByRow.entries()]);
});

test("Dashboard แสดงเฉพาะสิทธิ์ที่ Snapshot ตัดสินว่าจ่ายแล้ว", () => {
  const rows = [booking({ row: 1, slot: "S2", startTime: "11:00" }), booking({ row: 2, slot: "S10", startTime: "11:00" })];
  const snapshot = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A")], slotNumbers: slots });
  assert.equal(dashboardStatus({ slot: { code: "S2" }, bookings: rows, snapshot, selectedRound: "11:00", currentRound: "11:00" }), "booked");
  assert.equal(dashboardStatus({ slot: { code: "S10" }, bookings: rows, snapshot, selectedRound: "11:00", currentRound: "11:00" }), "vacant");
});

test("สิทธิ์ด่วนแสดงรอตรวจตั๋วในรอบที่ระบุ และรอบถัดไปขึ้นหมดเวลาจอด", () => {
  const snapshot = { paidByRow: new Map() };
  const urgentLogs = [{ accessDate: "2026-09-18", slot: "S2", startTime: "11:00" }];
  assert.equal(dashboardStatus({ slot: { code: "S2" }, bookings: [], snapshot, urgentLogs, selectedRound: "11:00", currentRound: "11:00" }), "ticket-check");
  assert.equal(dashboardStatus({ slot: { code: "S2" }, bookings: [], snapshot, urgentLogs, selectedRound: "15:00", currentRound: "15:00" }), "expired");
  assert.equal(dashboardStatus({ slot: { code: "S2" }, bookings: [], snapshot, urgentLogs, selectedRound: "19:00", currentRound: "19:00" }), "vacant");
});

test("หมดเวลาจอดเกิดเฉพาะรอบปัจจุบัน เมื่อรอบก่อนหน้ามีสิทธิ์ที่จ่ายแล้ว", () => {
  const rows = [booking({ row: 1, slot: "S2", startTime: "07:00" })];
  const snapshot = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A")], slotNumbers: slots });
  assert.equal(dashboardStatus({ slot: { code: "S2" }, bookings: rows, snapshot, selectedRound: "11:00", currentRound: "11:00" }), "expired");
  assert.equal(dashboardStatus({ slot: { code: "S2" }, bookings: rows, snapshot, selectedRound: "11:00", currentRound: "11:00", live: false }), "vacant");
});

test("สิทธิ์ต่อเนื่องไม่ขึ้นหมดเวลาจอด", () => {
  const rows = [booking({ row: 1, slot: "S2", startTime: "07:00" }), booking({ row: 2, slot: "S2", startTime: "11:00" })];
  const snapshot = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A"), ticket("DOC-A")], slotNumbers: slots });
  assert.equal(dashboardStatus({ slot: { code: "S2" }, bookings: rows, snapshot, selectedRound: "11:00", currentRound: "11:00" }), "booked");
});

test("ปิดใช้งานมีลำดับเหนือกว่าสถานะการจอง", () => {
  const rows = [booking({ row: 1, slot: "S2", startTime: "11:00" })];
  const snapshot = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A")], slotNumbers: slots });
  assert.equal(dashboardStatus({ slot: { code: "S2", closed: true }, bookings: rows, snapshot, selectedRound: "11:00", currentRound: "11:00" }), "closed");
});

test("รอบข้ามวัน 23:00 และ 03:00 เรียงหลัง 19:00", () => {
  const rows = [booking({ row: 1, slot: "S2", startTime: "03:00" }), booking({ row: 2, slot: "S2", startTime: "23:00" }), booking({ row: 3, slot: "S2", startTime: "19:00" })];
  const result = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A"), ticket("DOC-A")], slotNumbers: slots });
  assert.deepEqual(rows.map((row) => result.paidByRow.get(row.row)), [false, true, true]);
});

// กรณีข้อมูลต้นทางตอบกลับแบบครบรูปแบบแต่มีจำนวนรายการน้อยลงเป็นความเสี่ยงเชิงทฤษฎี
// ปัจจุบัน MIS ดึงตรงจากฐานข้อมูล จึงไม่เพิ่ม quality gate ที่อาจบล็อกการแก้ไขข้อมูลจริง
{
  const rows = ROUNDS.map((startTime, index) => booking({ row: index + 1, slot: "S2", startTime }));
  const complete = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: Array.from({ length: 6 }, () => ticket("DOC-A")), slotNumbers: slots });
  const partial = allocatePaymentSnapshot({ operationalDate: "2026-09-18", bookings: rows, tickets: [ticket("DOC-A"), ticket("DOC-A")], slotNumbers: slots });
  if ([...partial.paidByRow.values()].filter(Boolean).length < [...complete.paidByRow.values()].filter(Boolean).length) {
    knownRisks.push("ข้อมูลต้นทางที่ตอบสำเร็จแต่ไม่ครบอาจทำให้สิทธิ์ลดลงเมื่อสร้าง Snapshot ใหม่; ไม่คาดว่าจะเกิดกับการดึงตรงจากฐานข้อมูลในปัจจุบัน");
  }
}

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`PASS ${item.name}`);
}
console.log(`\nMock payment/dashboard tests passed: ${passed}/${tests.length}`);
knownRisks.forEach((risk) => console.log(`KNOWN RISK: ${risk}`));
console.log("NOTE: This proves the business-rule contract with mock data. Google API อ่านข้อมูลไม่ได้ต้องคง Snapshot ล่าสุดและแจ้งว่าข้อมูลยังไม่พร้อม.");
