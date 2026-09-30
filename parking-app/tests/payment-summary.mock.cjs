const assert = require("assert");

function calculateSummary({ rows, mode, date, startDate, endDate }) {
  const parsedRows = rows
    .map((r) => ({
      date: r[0],
      month: r[1],
      week: r[2],
      docId: String(r[3] || "").trim(),
      customerName: String(r[4] || "").trim(),
      booked: Number(r[5]) || 0,
      paid: Number(r[6]) || 0,
      shortfall: Number(r[7]) || 0,
      urgent: Number(r[8]) || 0,
      pct: Number(r[9]) || 0,
      recordedAt: String(r[10] || "").trim(),
    }))
    .filter((r) => Boolean(r.date && (r.docId || r.customerName)));

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
          urgent: 0,
          daysCount: 0,
        });
      }
      const entry = customerMap.get(key);
      if (!entry.customerName && r.customerName) entry.customerName = r.customerName;
      entry.booked += r.booked;
      entry.paid += r.paid;
      entry.shortfall += r.shortfall;
      entry.urgent += r.urgent;
      entry.daysCount += 1;
    });

    const summaryRows = Array.from(customerMap.values()).map((c) => ({
      ...c,
      pct: c.booked > 0 ? Math.round((c.paid / c.booked) * 1000) / 1000 : (c.urgent > 0 ? 1 : 0),
    }));
    summaryRows.sort((a, b) => a.docId.localeCompare(b.docId, "th", { numeric: true }));

    const totals = {
      totalBooked: summaryRows.reduce((acc, c) => acc + c.booked, 0),
      totalPaid: summaryRows.reduce((acc, c) => acc + c.paid, 0),
      totalShortfall: summaryRows.reduce((acc, c) => acc + c.shortfall, 0),
      totalUrgent: summaryRows.reduce((acc, c) => acc + c.urgent, 0),
      customerCount: summaryRows.length,
      daysInRange: new Set(matchingRows.map((r) => r.date)).size,
    };
    totals.overallPct = totals.totalBooked > 0 ? Math.round((totals.totalPaid / totals.totalBooked) * 1000) / 1000 : 0;

    return { mode: "range", totals, summaryRows, dailyBreakdown: matchingRows };
  }

  const targetDate = date;
  const matchingRows = parsedRows.filter((r) => r.date === targetDate);
  matchingRows.sort((a, b) => a.docId.localeCompare(b.docId, "th", { numeric: true }));

  const totals = {
    totalBooked: matchingRows.reduce((acc, c) => acc + c.booked, 0),
    totalPaid: matchingRows.reduce((acc, c) => acc + c.paid, 0),
    totalShortfall: matchingRows.reduce((acc, c) => acc + c.shortfall, 0),
    totalUrgent: matchingRows.reduce((acc, c) => acc + c.urgent, 0),
    customerCount: matchingRows.length,
  };
  totals.overallPct = totals.totalBooked > 0 ? Math.round((totals.totalPaid / totals.totalBooked) * 1000) / 1000 : 0;

  return { mode: "day", date: targetDate, totals, summaryRows: matchingRows };
}

// Sample Test Data
const sampleRows = [
  ["2026-09-28", "2026-09", "สัปดาห์ที่ 39", "01", "คุณรุ่งเพชร", 10, 8, 2, 0, 0.8, "28/09/2026 07:05"],
  ["2026-09-28", "2026-09", "สัปดาห์ที่ 39", "02", "คุณอภิสิทธิ์", 15, 15, 0, 0, 1.0, "28/09/2026 07:05"],
  ["2026-09-29", "2026-09", "สัปดาห์ที่ 39", "01", "คุณรุ่งเพชร", 10, 10, 0, 1, 1.0, "29/09/2026 07:05"],
  ["2026-09-29", "2026-09", "สัปดาห์ที่ 39", "02", "คุณอภิสิทธิ์", 15, 12, 3, 0, 0.8, "29/09/2026 07:05"],
  ["2026-09-29", "2026-09", "สัปดาห์ที่ 39", "03", "Mr.John", 5, 3, 2, 0, 0.6, "29/09/2026 07:05"],
];

function runTests() {
  console.log("Running Payment Summary Mock Tests...");

  // Test 1: Single Day mode (2026-09-28)
  const day1 = calculateSummary({ rows: sampleRows, mode: "day", date: "2026-09-28" });
  assert.strictEqual(day1.summaryRows.length, 2, "2026-09-28 must have 2 customers");
  assert.strictEqual(day1.totals.totalBooked, 25, "Booked should be 10 + 15 = 25");
  assert.strictEqual(day1.totals.totalPaid, 23, "Paid should be 8 + 15 = 23");
  assert.strictEqual(day1.totals.totalShortfall, 2, "Shortfall should be 2");
  assert.strictEqual(day1.totals.overallPct, 0.92, "Overall Pct: 23 / 25 = 0.92");
  console.log("PASS: Day Mode summary calculation for 2026-09-28");

  // Test 2: Single Day mode (2026-09-29)
  const day2 = calculateSummary({ rows: sampleRows, mode: "day", date: "2026-09-29" });
  assert.strictEqual(day2.summaryRows.length, 3, "2026-09-29 must have 3 customers");
  assert.strictEqual(day2.totals.totalBooked, 30, "Booked should be 10 + 15 + 5 = 30");
  assert.strictEqual(day2.totals.totalPaid, 25, "Paid should be 10 + 12 + 3 = 25");
  assert.strictEqual(day2.totals.totalShortfall, 5, "Shortfall should be 0 + 3 + 2 = 5");
  assert.strictEqual(day2.totals.totalUrgent, 1, "Urgent should be 1");
  console.log("PASS: Day Mode summary calculation for 2026-09-29");

  // Test 3: Date Range Aggregation (2026-09-28 to 2026-09-29)
  const range = calculateSummary({
    rows: sampleRows,
    mode: "range",
    startDate: "2026-09-28",
    endDate: "2026-09-29",
  });
  assert.strictEqual(range.summaryRows.length, 3, "Range should aggregate into 3 distinct customers");
  assert.strictEqual(range.totals.daysInRange, 2, "Should cover 2 days");
  assert.strictEqual(range.totals.totalBooked, 55, "Total booked: 25 + 30 = 55");
  assert.strictEqual(range.totals.totalPaid, 48, "Total paid: 23 + 25 = 48");
  assert.strictEqual(range.totals.totalShortfall, 7, "Total shortfall: 2 + 5 = 7");

  // Check customer 01 across 2 days
  const cust01 = range.summaryRows.find((c) => c.docId === "01");
  assert.strictEqual(cust01.daysCount, 2, "Cust 01 booked 2 days");
  assert.strictEqual(cust01.booked, 20, "Cust 01 booked 10 + 10 = 20");
  assert.strictEqual(cust01.paid, 18, "Cust 01 paid 8 + 10 = 18");
  assert.strictEqual(cust01.shortfall, 2, "Cust 01 shortfall 2 + 0 = 2");
  assert.strictEqual(cust01.pct, 0.9, "Cust 01 weighted average pct: 18 / 20 = 0.9");
  console.log("PASS: Range Mode customer aggregation & weighted math");

  // Test 4: Empty data handling
  const empty = calculateSummary({ rows: [], mode: "day", date: "2026-09-30" });
  assert.strictEqual(empty.summaryRows.length, 0);
  assert.strictEqual(empty.totals.totalBooked, 0);
  assert.strictEqual(empty.totals.overallPct, 0);
  console.log("PASS: Empty data handling without error or zero-division");

  console.log("\nAll Payment Summary mock tests passed: 4/4");
}

runTests();
