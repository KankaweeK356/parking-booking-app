// lib/excel-export.js
// ตัวช่วยสร้างไฟล์ Excel สรุปการชำระเงินและกระทบยอดรายได้แบบ 2 แท็บ (Sheet 1: สรุปภาพรวม, Sheet 2: รายละเอียดตั๋วรายวัน)

export async function exportRevenueReconciliationExcel(data) {
  const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default || (await import("exceljs/dist/exceljs.min.js"));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Parking Management System";
  workbook.lastModifiedBy = "Accounting Department";
  workbook.created = new Date();
  workbook.modified = new Date();

  const { dateRange, totals, customerSummary, rawTransactions } = data;

  // ----------------------------------------------------
  // สไตล์ที่ใช้ซ้ำ (Enterprise Accounting Theme)
  // ----------------------------------------------------
  const navyHeaderFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }, // #1e293b
  };

  const kpiBoxFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF8FAFC" }, // #f8fafc
  };

  const totalRowFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1F5F9" }, // #f1f5f9
  };

  const headerFont = {
    name: "Sarabun",
    family: 2,
    size: 11,
    bold: true,
    color: { argb: "FFFFFFFF" },
  };

  const regularFont = {
    name: "Sarabun",
    family: 2,
    size: 10,
    color: { argb: "FF1E293B" },
  };

  const boldFont = {
    name: "Sarabun",
    family: 2,
    size: 10,
    bold: true,
    color: { argb: "FF0F172A" },
  };

  const thinBorder = {
    top: { style: "thin", color: { argb: "FFE2E8F0" } },
    left: { style: "thin", color: { argb: "FFE2E8F0" } },
    bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
    right: { style: "thin", color: { argb: "FFE2E8F0" } },
  };

  const totalBorder = {
    top: { style: "thin", color: { argb: "FF0F172A" } },
    bottom: { style: "double", color: { argb: "FF0F172A" } },
    left: { style: "thin", color: { argb: "FFE2E8F0" } },
    right: { style: "thin", color: { argb: "FFE2E8F0" } },
  };

  // ----------------------------------------------------
  // SHEET 1: สรุปภาพรวม (Summary)
  // ----------------------------------------------------
  const ws1 = workbook.addWorksheet("สรุปภาพรวม", {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: "landscape", paperSize: 9 }, // A4 Landscape
  });

  // หัวรายงาน
  ws1.addRow(["รายงานสรุปการชำระเงินและกระทบยอดรายได้ (Revenue & Payment Reconciliation)"]);
  ws1.getRow(1).font = { name: "Sarabun", size: 16, bold: true, color: { argb: "FF0F172A" } };

  ws1.addRow([`ช่วงวันที่ในตั๋ว: ${dateRange.startDate} ถึง ${dateRange.endDate} (รวม ${dateRange.days} วัน)`]);
  ws1.getRow(2).font = { name: "Sarabun", size: 11, color: { argb: "FF475569" } };

  const printedAtStr = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

  ws1.addRow([`พิมพ์รายงานเมื่อ: ${printedAtStr} | จำนวนลูกค้า: ${totals.customerCount} ราย | รวมตั๋ว: ${totals.totalTickets} ใบ`]);
  ws1.getRow(3).font = { name: "Sarabun", size: 9, color: { argb: "FF64748B" } };
  ws1.addRow([]); // Blank row 4

  // บล็อกสรุปยอด KPI 5 รายการ (แถว 5-9)
  const kpiData = [
    ["1. ยอดเงินสดรับจริงจากตั๋วรายวัน (Total Ticket Cash)", totals.totalCash, "บาท"],
    ["2. รับรู้เป็นรายได้ค่าบริการรอบวัน (จอดวันนั้น) (Earned Revenue)", totals.earnedToday, "บาท"],
    ["3. บันทึกเป็นเงินรับล่วงหน้า - จอดพรุ่งนี้ (Unearned Revenue / Advance)", totals.advanceTomorrow, "บาท"],
    ["4. เงินรับส่วนเกิน - ตั๋วเกิน/ตีตั๋วแมนนวล (Surplus Cash)", totals.surplus, "บาท"],
    ["5. ยอดรอตรวจชำระ - CS ทำรายการแต่ตั๋วไม่พอ (Underfunded / Shortfall)", totals.shortfall, "บาท"],
  ];

  kpiData.forEach((item, idx) => {
    const row = ws1.addRow([item[0], item[1], item[2]]);
    row.font = { name: "Sarabun", size: 10, bold: idx === 0 || idx === 4 };
    row.getCell(1).fill = kpiBoxFill;
    row.getCell(2).fill = kpiBoxFill;
    row.getCell(3).fill = kpiBoxFill;
    row.getCell(2).numFmt = "#,##0.00";
    row.getCell(2).alignment = { horizontal: "right" };
    row.getCell(3).alignment = { horizontal: "left" };
    row.eachCell((cell) => (cell.border = thinBorder));
  });

  ws1.addRow([]); // Blank row 10

  // หัวตารางรายละเอียดรายลูกค้า (แถว 11)
  const tableHeaders1 = [
    "ลำดับ",
    "วันที่ในตั๋ว",
    "รหัสลูกค้า",
    "ชื่อลูกค้า",
    "สิทธิ์ที่ชำระ (ใบ)",
    "ยอดเงินสดรับจริง (บาท)",
    "รายได้รอบวัน-จอดวันนั้น (บาท)",
    "เงินรับล่วงหน้า-พรุ่งนี้ (บาท)",
    "เงินรับส่วนเกิน (บาท)",
    "รอตรวจยอดชำระ (บาท)",
    "สถานะกระทบยอด",
  ];

  const headerRow1 = ws1.addRow(tableHeaders1);
  headerRow1.height = 28;
  headerRow1.font = headerFont;
  headerRow1.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow1.eachCell((cell) => {
    cell.fill = navyHeaderFill;
    cell.border = thinBorder;
  });

  // ข้อมูลลูกค้า
  customerSummary.forEach((c, idx) => {
    const isEven = idx % 2 === 0;
    const rowFill = isEven ? undefined : { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };

    const r = ws1.addRow([
      idx + 1,
      c.date,
      c.boothCode,
      c.customerName,
      c.paidTickets,
      c.totalPaid,
      c.earnedToday,
      c.advanceTomorrow,
      c.surplus,
      c.shortfall,
      c.status,
    ]);

    r.font = regularFont;
    r.height = 20;

    // การจัดตำแหน่ง
    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(4).alignment = { horizontal: "left", vertical: "middle" };
    r.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(6).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(8).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(9).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(10).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(11).alignment = { horizontal: "center", vertical: "middle" };

    // Format ตัวเลข
    r.getCell(5).numFmt = "#,##0";
    r.getCell(6).numFmt = "#,##0.00";
    r.getCell(7).numFmt = "#,##0.00";
    r.getCell(8).numFmt = "#,##0.00";
    r.getCell(9).numFmt = "#,##0.00";
    r.getCell(10).numFmt = "#,##0.00";

    // สีข้อความสถานะ
    if (c.statusKey === "shortfall") {
      r.getCell(10).font = { ...boldFont, color: { argb: "FFDC2626" } };
      r.getCell(11).font = { ...boldFont, color: { argb: "FFDC2626" } };
    } else if (c.statusKey === "surplus") {
      r.getCell(9).font = { ...boldFont, color: { argb: "FF0284C7" } };
      r.getCell(11).font = { ...boldFont, color: { argb: "FF0284C7" } };
    } else {
      r.getCell(11).font = { ...boldFont, color: { argb: "FF059669" } };
    }

    r.eachCell((cell) => {
      cell.border = thinBorder;
      if (rowFill && cell.col !== 11) cell.fill = rowFill;
    });
  });

  // แถวสรุปรวมทั้งสิ้น (Total Row)
  const totalRow1 = ws1.addRow([
    "รวมทั้งสิ้น",
    "",
    "",
    `${customerSummary.length} รายการ`,
    totals.totalTickets,
    totals.totalCash,
    totals.earnedToday,
    totals.advanceTomorrow,
    totals.surplus,
    totals.shortfall,
    "",
  ]);

  totalRow1.height = 24;
  totalRow1.font = boldFont;
  totalRow1.alignment = { vertical: "middle" };
  totalRow1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  totalRow1.getCell(4).alignment = { horizontal: "left", vertical: "middle" };
  totalRow1.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
  totalRow1.getCell(6).alignment = { horizontal: "right", vertical: "middle" };
  totalRow1.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
  totalRow1.getCell(8).alignment = { horizontal: "right", vertical: "middle" };
  totalRow1.getCell(9).alignment = { horizontal: "right", vertical: "middle" };
  totalRow1.getCell(10).alignment = { horizontal: "right", vertical: "middle" };

  totalRow1.getCell(5).numFmt = "#,##0";
  totalRow1.getCell(6).numFmt = "#,##0.00";
  totalRow1.getCell(7).numFmt = "#,##0.00";
  totalRow1.getCell(8).numFmt = "#,##0.00";
  totalRow1.getCell(9).numFmt = "#,##0.00";
  totalRow1.getCell(10).numFmt = "#,##0.00";

  totalRow1.eachCell((cell) => {
    cell.fill = totalRowFill;
    cell.border = totalBorder;
  });

  // ปรับความกว้างคอลัมน์ Sheet 1 อัตโนมัติ
  ws1.columns.forEach((column) => {
    let maxLen = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value ? String(cell.value) : "";
      if (v.length > maxLen && cell.row > 4) {
        maxLen = v.length;
      }
    });
    column.width = Math.min(Math.max(maxLen + 4, 12), 40);
  });
  ws1.getColumn(1).width = 8;
  ws1.getColumn(2).width = 14;
  ws1.getColumn(3).width = 14;
  ws1.getColumn(4).width = 28;

  // ----------------------------------------------------
  // SHEET 2: รายละเอียดตั๋วรายวัน (Transaction-level Audit Trail)
  // ----------------------------------------------------
  const ws2 = workbook.addWorksheet("รายละเอียดตั๋วรายวัน", {
    views: [{ showGridLines: true }],
    pageSetup: { orientation: "landscape", paperSize: 9 },
  });

  // หัวรายงาน Sheet 2
  ws2.addRow(["รายละเอียดตั๋วรายวัน (Transaction-level Audit Trail)"]);
  ws2.getRow(1).font = { name: "Sarabun", size: 16, bold: true, color: { argb: "FF0F172A" } };

  ws2.addRow([`ช่วงวันที่ในตั๋ว: ${dateRange.startDate} ถึง ${dateRange.endDate} | อ้างอิงแท็บ tbt_DailyFee ใน Google Sheets`]);
  ws2.getRow(2).font = { name: "Sarabun", size: 11, color: { argb: "FF475569" } };
  ws2.addRow([]); // Blank row 3

  const tableHeaders2 = [
    "ลำดับ",
    "แถวใน Google Sheet",
    "วันที่ในตั๋ว",
    "เวลาที่บันทึก",
    "รหัสลูกค้า (BoothCode)",
    "ชื่อลูกค้า",
    "จำนวนตั๋ว (ใบ)",
    "ยอดเงิน (บาท)",
    "การจัดสรรทางบัญชี",
    "วันที่เข้าจอดจริง",
    "ช่องจอด / รอบเวลา",
  ];

  const headerRow2 = ws2.addRow(tableHeaders2);
  headerRow2.height = 28;
  headerRow2.font = headerFont;
  headerRow2.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow2.eachCell((cell) => {
    cell.fill = navyHeaderFill;
    cell.border = thinBorder;
  });

  rawTransactions.forEach((tx, idx) => {
    const isEven = idx % 2 === 0;
    const rowFill = isEven ? undefined : { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };

    const r = ws2.addRow([
      idx + 1,
      tx.sheetRow ? `แถว ${tx.sheetRow}` : "-",
      tx.posDate,
      tx.createDate,
      tx.boothCode,
      tx.customerName,
      tx.quantity,
      tx.amount,
      tx.attribution,
      tx.serviceDate,
      tx.slotInfo,
    ]);

    r.font = regularFont;
    r.height = 20;

    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(6).alignment = { horizontal: "left", vertical: "middle" };
    r.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(8).alignment = { horizontal: "right", vertical: "middle" };
    r.getCell(9).alignment = { horizontal: "left", vertical: "middle" };
    r.getCell(10).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(11).alignment = { horizontal: "left", vertical: "middle" };

    r.getCell(7).numFmt = "#,##0";
    r.getCell(8).numFmt = "#,##0.00";

    // ไฮไลต์สีข้อความตามการจัดสรร
    if (tx.attribution.includes("จอดวันนั้น") || tx.attribution.includes("ด่วน")) {
      r.getCell(9).font = { ...boldFont, color: { argb: "FF059669" } };
    } else if (tx.attribution.includes("ล่วงหน้า")) {
      r.getCell(9).font = { ...boldFont, color: { argb: "FF2563EB" } };
    } else if (tx.attribution.includes("ส่วนเกิน")) {
      r.getCell(9).font = { ...boldFont, color: { argb: "FF0284C7" } };
    }

    r.eachCell((cell) => {
      cell.border = thinBorder;
      if (rowFill) cell.fill = rowFill;
    });
  });

  // รวมท้ายตาราง Sheet 2
  const totalRow2 = ws2.addRow([
    "รวมทั้งสิ้น",
    "",
    "",
    "",
    "",
    `${rawTransactions.length} รายการ`,
    totals.totalTickets,
    totals.totalCash,
    "",
    "",
    "",
  ]);

  totalRow2.height = 24;
  totalRow2.font = boldFont;
  totalRow2.alignment = { vertical: "middle" };
  totalRow2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  totalRow2.getCell(6).alignment = { horizontal: "left", vertical: "middle" };
  totalRow2.getCell(7).alignment = { horizontal: "right", vertical: "middle" };
  totalRow2.getCell(8).alignment = { horizontal: "right", vertical: "middle" };

  totalRow2.getCell(7).numFmt = "#,##0";
  totalRow2.getCell(8).numFmt = "#,##0.00";

  totalRow2.eachCell((cell) => {
    cell.fill = totalRowFill;
    cell.border = totalBorder;
  });

  // ปรับความกว้างคอลัมน์ Sheet 2
  ws2.columns.forEach((column) => {
    let maxLen = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value ? String(cell.value) : "";
      if (v.length > maxLen && cell.row > 3) {
        maxLen = v.length;
      }
    });
    column.width = Math.min(Math.max(maxLen + 4, 12), 40);
  });
  ws2.getColumn(1).width = 8;
  ws2.getColumn(2).width = 16;
  ws2.getColumn(3).width = 14;
  ws2.getColumn(4).width = 20;
  ws2.getColumn(5).width = 16;
  ws2.getColumn(6).width = 26;
  ws2.getColumn(9).width = 30;

  // ----------------------------------------------------
  // ดาวน์โหลดไฟล์ .xlsx สู่เครื่องผู้ใช้
  // ----------------------------------------------------
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const fileName = `Payment_Reconciliation_${dateRange.startDate}_to_${dateRange.endDate}.xlsx`;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
