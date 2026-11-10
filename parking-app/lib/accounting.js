// lib/accounting.js
// ระบบกระทบยอดรายได้และการเงินสำหรับฝ่ายบัญชี (Revenue & Payment Reconciliation)
// รองรับ Rolling 5 วันของตั๋วด่านด้วยระบบ Hybrid Smart Archive (Production Release)

import {
  getTransectionRows,
  getUrgentAccessLogs,
  getAllBookingRows,
  getMasterList,
  getBookingAdjustments,
  saveAccountingArchive,
  getAccountingArchive,
  getCustomerSummaryData,
  isoFromSerial,
  isoDateToSerial,
  getTodaySerial,
  isClosingReason,
  FAR_FUTURE_SERIAL,
} from "./sheets.js";
import { TICKET_PRICE_PER_UNIT } from "./ticket-pricing.js";

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
 * รองรับการดึงตั๋วสด 5 วันล่าสุด และดึงย้อนหลังถาวรจาก Archive อัตโนมัติ
 * @param {Object} options
 * @param {string} options.startDate - YYYY-MM-DD
 * @param {string} options.endDate - YYYY-MM-DD
 */
export async function getRevenueReconciliationData({ startDate, endDate, autoArchive = false } = {}) {
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

  // ดึงข้อมูลทั้งหมดในครั้งเดียว (รวมข้อมูล Archive ย้อนหลัง และ Customer_Summary)
  const [
    allTransactions,
    urgentLogs,
    allBookings,
    masterList,
    allAdjustments,
    archiveData,
    custSummaryRangeData,
  ] = await Promise.all([
    getTransectionRows(),
    getUrgentAccessLogs(),
    getAllBookingRows(),
    getMasterList(),
    getBookingAdjustments(),
    getAccountingArchive({ startDate: sDate, endDate: eDate }).catch((err) => {
      console.warn("Failed to fetch accounting archive:", err.message);
      return { customerSummary: [], rawTransactions: [], archivedDates: new Set() };
    }),
    getCustomerSummaryData({
      startDate: isoFromSerial(startSerial + 1),
      endDate: isoFromSerial(endSerial + 1),
      mode: "range",
    }).catch(() => ({ dailyBreakdown: [] })),
  ]);

  const custSummaryRowsByOpDate = new Map();
  (custSummaryRangeData?.dailyBreakdown || []).forEach((r) => {
    if (!r?.date) return;
    if (!custSummaryRowsByOpDate.has(r.date)) custSummaryRowsByOpDate.set(r.date, []);
    custSummaryRowsByOpDate.get(r.date).push(r);
  });

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

  // วันที่มีตั๋วสดใน tbt_DailyFee (Rolling 5 วันล่าสุด)
  const liveDates = new Set(allTransactions.map((t) => t.dateStr));

  // ผลลัพธ์รวม
  const customerSummary = [];
  const rawTransactions = [];
  const entriesToArchive = [];

  let grandTotalCash = 0;
  let grandEarnedToday = 0;
  let grandAdvanceTomorrow = 0;
  let grandSurplus = 0;
  let grandShortfall = 0;
  let grandPaidTickets = 0;
  let grandBookedTickets = 0;
  const uniqueCustomers = new Set();

  // วนลูปแต่ละวันใน Date Range
  for (let currentSerial = startSerial; currentSerial <= endSerial; currentSerial++) {
    const dIso = isoFromSerial(currentSerial);
    const tomorrowSerial = currentSerial + 1;
    const tomorrowIso = isoFromSerial(tomorrowSerial);

    const hasLiveTickets = liveDates.has(dIso);
    const archivedForDay = (archiveData?.customerSummary || []).filter((c) => c.date === dIso);

    const liveDayTransactions = allTransactions.filter(
      (t) => t.dateSerial === currentSerial || t.dateStr === dIso
    );
    const liveTicketsCount = liveDayTransactions.reduce((sum, t) => sum + (Number(t.quantity) || 1), 0);
    const archivedPaidCount = archivedForDay.reduce((sum, c) => sum + (c.paidTickets || 0), 0);

    const custRowsForTomorrow = custSummaryRowsByOpDate.get(tomorrowIso) || [];
    const custSumTotalPaid = custRowsForTomorrow.reduce(
      (sum, r) => sum + (Number(r.paid) || 0) + (Number(r.urgent) || 0),
      0
    );

    // กรณีที่ 1: ใช้ข้อมูลจาก Archive ถาวรเมื่อ:
    // 1) ใน Archive มีข้อมูล และมียอดตั๋ว paidTickets > 0
    // 2) และยอดตั๋วใน Archive ต้องไม่น้อยกว่าทั้ง liveTicketsCount และ custSumTotalPaid
    const minExpectedPaid = Math.max(liveTicketsCount, custSumTotalPaid);
    if (
      archivedForDay.length > 0 &&
      archivedPaidCount > 0 &&
      archivedPaidCount >= minExpectedPaid
    ) {
      const archivedTxForDay = (archiveData?.rawTransactions || []).filter((tx) => tx.posDate === dIso);
      archivedForDay.forEach((c) => {
        uniqueCustomers.add(c.boothCode);
        customerSummary.push(c);
        grandTotalCash += c.totalPaid || 0;
        grandEarnedToday += c.earnedToday || 0;
        grandAdvanceTomorrow += c.advanceTomorrow || 0;
        grandSurplus += c.surplus || 0;
        grandShortfall += c.shortfall || 0;
        grandPaidTickets += c.paidTickets || 0;
        grandBookedTickets += c.bookedTickets || 0;
      });
      archivedTxForDay.forEach((tx) => rawTransactions.push(tx));
      continue;
    }

    // กรณีที่ 1.5: หากมีข้อมูล Snapshot ใน Customer_Summary (วันปฏิบัติการ tomorrowIso) และมียอดรวม >= ตั๋วสดใน tbt_DailyFee
    // ให้ยึดข้อมูลจาก Customer_Summary เป็นหลัก (ป้องกันกรณีไม่มีตั๋วสด หรือวันขอบที่ตั๋วสดโดนตัด 1,000 แถวจนแหว่ง)
    if (custRowsForTomorrow.length > 0 && custSumTotalPaid >= liveTicketsCount && (!hasLiveTickets || custSumTotalPaid > 0)) {
      const fallbackDaySummary = [];
      custRowsForTomorrow.forEach((r) => {
        const docId = String(r.docId || "").trim();
        const custName = String(r.customerName || getCustomerName(docId)).trim();
        const advanceSlotsCount = Number(r.booked) || 0;
        const urgentSlotsCount = Number(r.urgent) || 0;
        const totalBookedSlots = advanceSlotsCount + urgentSlotsCount;
        const advancePaidSlots = Number(r.paid) || 0;
        const totalPaidTickets = advancePaidSlots + urgentSlotsCount;

        const earnedTodaySlots = urgentSlotsCount;
        const advanceTomorrowSlots = Math.min(advancePaidSlots, advanceSlotsCount);
        const surplusSlots = Math.max(0, advancePaidSlots - advanceSlotsCount);
        const totalShortfallSlots = Math.max(0, advanceSlotsCount - advanceTomorrowSlots);

        const totalPaidAmount = totalPaidTickets * TICKET_PRICE_PER_UNIT;
        const earnedTodayAmount = earnedTodaySlots * TICKET_PRICE_PER_UNIT;
        const advanceTomorrowAmount = advanceTomorrowSlots * TICKET_PRICE_PER_UNIT;
        const surplusAmount = surplusSlots * TICKET_PRICE_PER_UNIT;
        const shortfallAmount = totalShortfallSlots * TICKET_PRICE_PER_UNIT;

        let status = RECON_STATUS.BALANCED;
        let statusKey = RECON_STATUS_KEY.BALANCED;
        if (totalShortfallSlots > 0) {
          status = RECON_STATUS.UNDERFUNDED;
          statusKey = RECON_STATUS_KEY.UNDERFUNDED;
        } else if (surplusSlots > 0) {
          status = RECON_STATUS.SURPLUS;
          statusKey = RECON_STATUS_KEY.SURPLUS;
        }

        const item = {
          date: dIso,
          boothCode: docId,
          customerName: custName,
          bookedTickets: totalBookedSlots,
          paidTickets: totalPaidTickets,
          totalPaid: totalPaidAmount,
          earnedToday: earnedTodayAmount,
          advanceTomorrow: advanceTomorrowAmount,
          surplus: surplusAmount,
          shortfall: shortfallAmount,
          status,
          statusKey,
          urgentCount: urgentSlotsCount,
          advanceCount: advanceSlotsCount,
          surplusTickets: surplusSlots,
          shortfallTickets: totalShortfallSlots,
        };

        uniqueCustomers.add(docId);
        fallbackDaySummary.push(item);
        customerSummary.push(item);
        grandTotalCash += totalPaidAmount;
        grandEarnedToday += earnedTodayAmount;
        grandAdvanceTomorrow += advanceTomorrowAmount;
        grandSurplus += surplusAmount;
        grandShortfall += shortfallAmount;
        grandPaidTickets += totalPaidTickets;
        grandBookedTickets += totalBookedSlots;
      });

      // หากมีตั๋วรายใบใน Archive หรือใน tbt_DailyFee ให้แนบไปด้วยสำหรับการส่งออก Excel แท็บที่ 2
      const archivedTxForDay = (archiveData?.rawTransactions || []).filter((tx) => tx.posDate === dIso);
      if (archivedTxForDay.length > 0) {
        archivedTxForDay.forEach((tx) => rawTransactions.push(tx));
      } else if (liveDayTransactions.length > 0) {
        liveDayTransactions.forEach((tx) => {
          const docId = String(tx.boothCode || "").trim();
          const custName = getCustomerName(docId);
          const qty = Number(tx.quantity) || 1;
          for (let q = 0; q < qty; q++) {
            rawTransactions.push({
              sheetRow: tx.sheetRow,
              posDate: dIso,
              createDate: tx.createDate || tx.docDate || "-",
              boothCode: docId,
              customerName: custName,
              quantity: 1,
              amount: TICKET_PRICE_PER_UNIT,
              attribution: "เงินรับล่วงหน้า / ค่าบริการตามสิทธิ์",
              serviceDate: tomorrowIso,
              slotInfo: "-",
            });
          }
        });
      }

      continue;
    }

    // กรณีที่ 2: วันที่นี้ยังอยู่ใน Rolling 5 วันของตั๋วด่าน -> คำนวณสด & เตรียมเซฟ Archive
    const dayCustomerSummary = [];
    const dayRawTransactions = [];

    // ดึงข้อมูล Customer_Summary ของวันปฏิบัติการ tomorrowIso (sourceDate = dIso) มาช่วยป้องกันกรณีวันเก่าสุดใน tbt_DailyFee ทยอยหลุดรอบบางส่วน
    const custPaidByDoc = new Map();
    const custNameByDocFromSnap = new Map();
    custRowsForTomorrow.forEach((r) => {
      if (r.docId) {
        const doc = String(r.docId).trim();
        custPaidByDoc.set(doc, Number(r.paid) || 0);
        if (r.customerName) custNameByDocFromSnap.set(doc, String(r.customerName).trim());
      }
    });

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

    // รวบรวม docId ทั้งหมดที่เกี่ยวข้องในวัน dIso (รวมทั้งจากตั๋วสด และจาก Customer_Summary)
    const dayDocIds = new Set();
    dayTransactions.forEach((t) => {
      if (t.boothCode) dayDocIds.add(String(t.boothCode).trim());
    });
    custRowsForTomorrow.forEach((r) => {
      if (r.docId) dayDocIds.add(String(r.docId).trim());
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
      const custName = custNameByDocFromSnap.get(docId) || getCustomerName(docId);

      // 1. ตั๋วที่จ่ายจริงในวัน dIso
      const custTxList = dayTransactions
        .filter((t) => String(t.boothCode).trim() === docId)
        .sort((a, b) => (a.sheetRow || 0) - (b.sheetRow || 0));

      const livePaidTickets = custTxList.reduce(
        (sum, t) => sum + (Number(t.quantity) || 1),
        0
      );

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

      const snapshotAdvancePaid = custPaidByDoc.get(docId) || 0;
      const totalPaidTickets = Math.max(livePaidTickets, snapshotAdvancePaid + urgentSlotsCount);
      const totalPaidAmount = totalPaidTickets * TICKET_PRICE_PER_UNIT;

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

      const totalBookedSlots = urgentSlotsCount + advanceSlotsCount;
      const custSummaryItem = {
        date: dIso,
        boothCode: docId,
        customerName: custName,
        bookedTickets: totalBookedSlots,
        paidTickets: totalPaidTickets,
        totalPaid: totalPaidAmount,
        earnedToday: earnedTodayAmount,
        advanceTomorrow: advanceTomorrowAmount,
        surplus: surplusAmount,
        shortfall: shortfallAmount,
        status,
        statusKey,
        urgentCount: urgentSlotsCount,
        advanceCount: advanceSlotsCount,
        surplusTickets: surplusSlots,
        shortfallTickets: totalShortfallSlots,
      };

      dayCustomerSummary.push(custSummaryItem);
      customerSummary.push(custSummaryItem);

      // สะสมยอดรวม KPI
      grandTotalCash += totalPaidAmount;
      grandEarnedToday += earnedTodayAmount;
      grandAdvanceTomorrow += advanceTomorrowAmount;
      grandSurplus += surplusAmount;
      grandShortfall += shortfallAmount;
      grandPaidTickets += totalPaidTickets;
      grandBookedTickets += totalBookedSlots;

      // 5. บันทึกรายละเอียดตั๋วรายวัน (Sheet 2) แยกตามแถวตั๋ว
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

          const rawTxItem = {
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
          };

          dayRawTransactions.push(rawTxItem);
          rawTransactions.push(rawTxItem);
        }
      });
    }

    // เก็บวันที่คำนวณสดเพื่อเตรียม Auto-Archive
    // STRICT GUARD: บันทึกเฉพาะวันที่มีตั๋วสดจากด่าน (hasLiveTickets === true) เท่านั้น
    // ห้าม auto-archive หรือทับข้อมูลของวันที่ตั๋วสดหลุดรอบไปแล้วโดยเด็ดขาด
    if (hasLiveTickets && (dayCustomerSummary.length > 0 || dayRawTransactions.length > 0)) {
      entriesToArchive.push({
        date: dIso,
        customerSummary: dayCustomerSummary,
        rawTransactions: dayRawTransactions,
      });
    }
  }

  // Auto-Archive: บันทึกข้อมูลเฉพาะเมื่อเรียกจาก Cron Job หรือได้รับคำสั่งบันทึกอย่างชัดเจน (autoArchive === true)
  // ป้องกันไม่ให้การเปิดดูหน้าเว็บทั่วไป (GET Request) ไปแอบเขียนหรือเสี่ยงล้างชีตโดยไม่ตั้งใจ
  if (autoArchive && entriesToArchive.length > 0) {
    try {
      await saveAccountingArchive(entriesToArchive);
    } catch (err) {
      console.warn("Auto-archiving reconciliation failed (safe ignore):", err.message);
    }
  }

  return {
    dateRange: {
      startDate: sDate,
      endDate: eDate,
      days: endSerial - startSerial + 1,
    },
    totals: {
      totalBooked: grandBookedTickets,
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
