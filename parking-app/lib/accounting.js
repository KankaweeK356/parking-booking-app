// lib/accounting.js
// ระบบกระทบยอดรายได้และการเงินสำหรับฝ่ายบัญชี (Revenue & Payment Reconciliation)

import {
  getTransectionRows,
  getUrgentAccessLogs,
  getAllBookingRows,
  getMasterList,
  getBookingAdjustments,
  isoFromSerial,
  isoDateToSerial,
  getTodaySerial,
  isClosingReason,
  FAR_FUTURE_SERIAL,
} from "./sheets";
import { TICKET_PRICE_PER_UNIT } from "./ticket-pricing";

export const RECON_STATUS = {
  BALANCED: "กระทบยอดลงตัว",
  SURPLUS: "เงินรับส่วนเกิน",
  UNDERFUNDED: "รอตรวจยอดชำระ",
};

export const RECON_STATUS_KEY = {
  BALANCED: "balanced",
  SURPLUS: "surplus",
  UNDERFUNDED: "shortfall",
};

/**
 * คำนวณข้อมูลกระทบยอดรายได้ตามช่วงวันที่
 * @param {Object} options
 * @param {string} options.startDate - YYYY-MM-DD
 * @param {string} options.endDate - YYYY-MM-DD
 */
export async function getRevenueReconciliationData({ startDate, endDate } = {}) {
  const todaySerial = getTodaySerial();
  // ค่าเริ่มต้น: เมื่อวาน (D-1) ซึ่งเป็นกะที่ปิดยอดแล้ว
  const defaultDate = isoFromSerial(todaySerial - 1);
  const sDate = startDate || defaultDate;
  const eDate = endDate || sDate;

  let startSerial = isoDateToSerial(sDate);
  let endSerial = isoDateToSerial(eDate);

  if (startSerial > endSerial) {
    const temp = startSerial;
    startSerial = endSerial;
    endSerial = temp;
  }

  // ดึงข้อมูลทั้งหมดในครั้งเดียว
  const [
    allTransactions,
    urgentLogs,
    allBookings,
    masterList,
    allAdjustments,
  ] = await Promise.all([
    getTransectionRows(),
    getUrgentAccessLogs(),
    getAllBookingRows(),
    getMasterList(),
    getBookingAdjustments(),
  ]);

  // สร้างแผนผังชื่อลูกค้า
  const masterMap = new Map();
  masterList.forEach((m) => {
    if (m.docId) masterMap.set(String(m.docId).trim(), String(m.name).trim());
  });

  const docIdToCustomerName = new Map();
  allBookings.forEach((b) => {
    if (b.docId && b.customer && !docIdToCustomerName.has(b.docId)) {
      docIdToCustomerName.set(String(b.docId).trim(), String(b.customer).trim());
    }
  });

  function getCustomerName(docId) {
    const key = String(docId || "").trim();
    return masterMap.get(key) || docIdToCustomerName.get(key) || key;
  }

  // ค้นหารายการด่วนที่ถูกยกเลิก
  const cancelledUrgentKeys = new Set(
    allBookings
      .filter((b) => b.bookingType === "Urgent" && isClosingReason(b.reason))
      .map((b) => `${b.slot}::${b.startTime}`)
  );

  // ผลลัพธ์รวม
  const customerSummary = [];
  const rawTransactions = [];

  let grandTotalCash = 0;
  let grandEarnedToday = 0;
  let grandAdvanceTomorrow = 0;
  let grandSurplus = 0;
  let grandShortfall = 0;
  let grandPaidTickets = 0;
  const uniqueCustomers = new Set();

  // วนลูปแต่ละวันใน Date Range
  for (let currentSerial = startSerial; currentSerial <= endSerial; currentSerial++) {
    const dIso = isoFromSerial(currentSerial);
    const tomorrowSerial = currentSerial + 1;
    const tomorrowIso = isoFromSerial(tomorrowSerial);

    // Pause / Daily adjustments สำหรับวันพรุ่งนี้
    const adjustmentsTomorrow = new Set(
      allAdjustments
        .filter(
          (row) =>
            (row.action.includes("ลด") || row.action.includes("พัก")) &&
            isoDateToSerial(row.startDate) <= tomorrowSerial &&
            tomorrowSerial <= isoDateToSerial(row.endDate)
        )
        .map((row) => row.rowNumber)
    );

    // ตั๋ว POS ในวัน dIso
    const dayTransactions = allTransactions.filter(
      (t) => t.dateSerial === currentSerial || t.dateStr === dIso
    );

    // รวบรวม docId ทั้งหมดที่เกี่ยวข้องในวัน dIso
    const dayDocIds = new Set();
    dayTransactions.forEach((t) => {
      if (t.boothCode) dayDocIds.add(String(t.boothCode).trim());
    });

    // เพิ่มลูกค้าที่มี Urgent Log วันนี้
    urgentLogs.forEach((log) => {
      if (
        (log.accessDate === dIso || log.ticketIssuedDate === dIso) &&
        log.docId &&
        !cancelledUrgentKeys.has(`${log.slot}::${log.startTime}`)
      ) {
        dayDocIds.add(String(log.docId).trim());
      }
    });

    // เพิ่มลูกค้าที่มี Advance Booking วันพรุ่งนี้
    allBookings.forEach((b) => {
      const endEff = b.endEffectiveSerial ?? FAR_FUTURE_SERIAL;
      if (
        b.bookingType !== "Urgent" &&
        b.docId &&
        b.startSerial &&
        !isClosingReason(b.reason) &&
        !adjustmentsTomorrow.has(b.rowNumber) &&
        b.startSerial <= tomorrowSerial &&
        tomorrowSerial <= endEff
      ) {
        dayDocIds.add(String(b.docId).trim());
      }
    });

    // ประมวลผลลูกค้ารายตัวสำหรับวัน dIso
    const sortedDocIds = Array.from(dayDocIds).sort((a, b) => a.localeCompare(b, "th", { numeric: true }));

    for (const docId of sortedDocIds) {
      uniqueCustomers.add(docId);
      const custName = getCustomerName(docId);

      // 1. ตั๋ว POS ที่จ่ายจริงในวัน dIso
      const custTxList = dayTransactions
        .filter((t) => String(t.boothCode).trim() === docId)
        .sort((a, b) => (a.sheetRow || 0) - (b.sheetRow || 0));

      const totalPaidTickets = custTxList.reduce(
        (sum, t) => sum + (Number(t.quantity) || 1),
        0
      );
      const totalPaidAmount = totalPaidTickets * TICKET_PRICE_PER_UNIT;

      // 2. สิทธิ์ด่วนวันนี้ (Operational Date dIso)
      const custUrgentItems = urgentLogs.filter(
        (log) =>
          (log.accessDate === dIso || log.ticketIssuedDate === dIso) &&
          String(log.docId).trim() === docId &&
          !cancelledUrgentKeys.has(`${log.slot}::${log.startTime}`)
      );
      const urgentSlotsCount = custUrgentItems.reduce(
        (sum, l) => sum + (Number(l.ticketCount) || 1),
        0
      );

      // 3. สิทธิ์จองล่วงหน้าวันพรุ่งนี้ (Operational Date tomorrowIso)
      const custAdvanceItems = allBookings.filter((b) => {
        const endEff = b.endEffectiveSerial ?? FAR_FUTURE_SERIAL;
        return (
          b.bookingType !== "Urgent" &&
          String(b.docId).trim() === docId &&
          b.startSerial &&
          !isClosingReason(b.reason) &&
          !adjustmentsTomorrow.has(b.rowNumber) &&
          b.startSerial <= tomorrowSerial &&
          tomorrowSerial <= endEff
        );
      });
      const advanceSlotsCount = custAdvanceItems.length;

      // 4. การกระจายตัดยอดทางบัญชี
      const earnedTodaySlots = Math.min(totalPaidTickets, urgentSlotsCount);
      const remainingAfterUrgent = totalPaidTickets - earnedTodaySlots;
      const advanceTomorrowSlots = Math.min(remainingAfterUrgent, advanceSlotsCount);
      const surplusSlots = Math.max(0, remainingAfterUrgent - advanceTomorrowSlots);

      const shortfallTodaySlots = Math.max(0, urgentSlotsCount - earnedTodaySlots);
      const shortfallTomorrowSlots = Math.max(0, advanceSlotsCount - advanceTomorrowSlots);
      const totalShortfallSlots = shortfallTodaySlots + shortfallTomorrowSlots;

      const earnedTodayAmount = earnedTodaySlots * TICKET_PRICE_PER_UNIT;
      const advanceTomorrowAmount = advanceTomorrowSlots * TICKET_PRICE_PER_UNIT;
      const surplusAmount = surplusSlots * TICKET_PRICE_PER_UNIT;
      const shortfallAmount = totalShortfallSlots * TICKET_PRICE_PER_UNIT;

      // กำหนดสถานะ
      let status = RECON_STATUS.BALANCED;
      let statusKey = RECON_STATUS_KEY.BALANCED;
      if (totalShortfallSlots > 0) {
        status = RECON_STATUS.UNDERFUNDED;
        statusKey = RECON_STATUS_KEY.UNDERFUNDED;
      } else if (surplusSlots > 0) {
        status = RECON_STATUS.SURPLUS;
        statusKey = RECON_STATUS_KEY.SURPLUS;
      }

      // บันทึกลง customerSummary
      customerSummary.push({
        date: dIso,
        boothCode: docId,
        customerName: custName,
        totalPaid: totalPaidAmount,
        earnedToday: earnedTodayAmount,
        advanceTomorrow: advanceTomorrowAmount,
        surplus: surplusAmount,
        shortfall: shortfallAmount,
        status,
        statusKey,
        paidTickets: totalPaidTickets,
        urgentCount: urgentSlotsCount,
        advanceCount: advanceSlotsCount,
        surplusTickets: surplusSlots,
        shortfallTickets: totalShortfallSlots,
      });

      // สะสมยอดรวม KPI
      grandTotalCash += totalPaidAmount;
      grandEarnedToday += earnedTodayAmount;
      grandAdvanceTomorrow += advanceTomorrowAmount;
      grandSurplus += surplusAmount;
      grandShortfall += shortfallAmount;
      grandPaidTickets += totalPaidTickets;

      // 5. บันทึกลง rawTransactions (Sheet 2) แยกตามแถวตั๋ว POS
      let remUrgentToAssign = earnedTodaySlots;
      let remAdvanceToAssign = advanceTomorrowSlots;
      const urgentQueue = [...custUrgentItems];
      const advanceQueue = [...custAdvanceItems];

      custTxList.forEach((tx) => {
        const qty = Number(tx.quantity) || 1;
        for (let q = 0; q < qty; q++) {
          let attribution = "";
          let serviceDate = "-";
          let slotInfo = "-";

          if (remUrgentToAssign > 0) {
            remUrgentToAssign--;
            attribution = "รายได้ค่าบริการรอบวัน (จอดวันนั้น)";
            serviceDate = dIso;
            const uItem = urgentQueue.shift();
            if (uItem) {
              slotInfo = `${uItem.slot || "-"} (${uItem.startTime || "-"})`;
            }
          } else if (remAdvanceToAssign > 0) {
            remAdvanceToAssign--;
            attribution = "เงินรับล่วงหน้า (จอดพรุ่งนี้)";
            serviceDate = tomorrowIso;
            const aItem = advanceQueue.shift();
            if (aItem) {
              slotInfo = `${aItem.slot || "-"} (${aItem.startTime || "-"})`;
            }
          } else {
            attribution = "เงินรับส่วนเกิน (ตั๋วเกิน/แมนนวล)";
            serviceDate = "-";
            slotInfo = "-";
          }

          rawTransactions.push({
            sheetRow: tx.sheetRow,
            posDate: dIso,
            createDate: tx.createDate || tx.docDate || "-",
            boothCode: docId,
            customerName: custName,
            quantity: 1,
            amount: TICKET_PRICE_PER_UNIT,
            attribution,
            serviceDate,
            slotInfo,
          });
        }
      });
    }
  }

  return {
    dateRange: {
      startDate: sDate,
      endDate: eDate,
      days: endSerial - startSerial + 1,
    },
    totals: {
      totalCash: grandTotalCash,
      earnedToday: grandEarnedToday,
      advanceTomorrow: grandAdvanceTomorrow,
      surplus: grandSurplus,
      shortfall: grandShortfall,
      totalTickets: grandPaidTickets,
      customerCount: uniqueCustomers.size,
      transactionCount: rawTransactions.length,
    },
    customerSummary,
    rawTransactions,
  };
}
