import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParkingTimelineGrid from "../components/ParkingTimelineGrid";
import { getBangkokCalendarDateIso, getCurrentOperationalDateIso } from "../lib/operational-day";
import { getDashboardStatusCounts } from "../lib/timeline-status";
import { displayLotName } from "../lib/display";

function today() { return getCurrentOperationalDateIso(); }
function formatPaymentDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [canRetryPayment, setCanRetryPayment] = useState(false);
  const [canPrint, setCanPrint] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [retryingPayment, setRetryingPayment] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printedAt, setPrintedAt] = useState("");

  useEffect(() => { fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then((result) => { const allowed = ["Admin", "Field"].includes(result?.user?.role); setCanRetryPayment(allowed); setCanPrint(allowed); }); }, []);
  useEffect(() => {
    if (!printing) return undefined;
    document.body.classList.add("dashboard-printing");
    const finishPrinting = () => { document.body.classList.remove("dashboard-printing"); setPrinting(false); };
    window.addEventListener("afterprint", finishPrinting);
    return () => { document.body.classList.remove("dashboard-printing"); window.removeEventListener("afterprint", finishPrinting); };
  }, [printing]);
  useEffect(() => {
    loadDashboard(selectedDate);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadDashboard(selectedDate, { silent: true });
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [selectedDate]);

  async function readApiJson(response, fallbackMessage) {
    const raw = await response.text();
    try { return JSON.parse(raw); } catch { throw new Error(fallbackMessage); }
  }

  async function loadDashboard(date, { silent = false, force = false } = {}) {
    if (!silent && !force) { setLoading(true); setError(""); }
    if (force) { setRefreshing(true); setError(""); }
    try {
      const url = `/api/dashboard?date=${encodeURIComponent(date)}${force ? "&force=true" : ""}`;
      const response = await fetch(url);
      const result = await readApiJson(response, "โหลดข้อมูล Dashboard ไม่สำเร็จ กรุณารอสักครู่");
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูล Dashboard ไม่สำเร็จ");
      setData(result);
      setLastUpdated(new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date()));
      const availableLots = Array.from(new Set((result.slots || []).map((slot) => slot.lot).filter(Boolean))).sort();
      setSelectedLot((current) => availableLots.includes(current) ? current : availableLots[0] || "");
    } catch (err) {
      if (!silent || force) setError(err.message);
    } finally {
      if (!silent && !force) setLoading(false);
      if (force) setRefreshing(false);
    }
  }

  async function retryPaymentSnapshot() {
    setPaymentMessage("");
    setRetryingPayment(true);
    const date = data.paymentUpdate?.date || getBangkokCalendarDateIso();
    try {
      const response = await fetch(`/api/payment-snapshot?date=${encodeURIComponent(date)}`, { method: "POST" });
      const result = await readApiJson(response, "อัปเดตข้อมูลใหม่ไม่สำเร็จ กรุณารอสักครู่");
      if (!response.ok) throw new Error(result.error || "อัปเดตสถานะชำระเงินไม่สำเร็จ");
      setPaymentMessage(`ระบบอัปเดตข้อมูลสำหรับวันที่ ${date} เรียบร้อยแล้ว`);
      await loadDashboard(selectedDate);
    } catch (err) { setPaymentMessage(err.message); } finally { setRetryingPayment(false); }
  }

  function printDashboard() {
    setPrintedAt(new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()));
    setPrinting(true);
    window.setTimeout(() => window.print(), 100);
  }

  const lots = useMemo(() => Array.from(new Set((data.slots || []).map((slot) => slot.lot).filter(Boolean))).sort(), [data.slots]);
  const slotsInLot = useMemo(() => (data.slots || []).filter((slot) => slot.lot === selectedLot), [data.slots, selectedLot]);
  const paidBookingsInLot = useMemo(() => (data.bookings || []).filter((booking) => booking.lot === selectedLot), [data.bookings, selectedLot]);
  const unpaidBookingsInLot = useMemo(() => (data.unpaidBookings || []).filter((booking) => booking.lot === selectedLot), [data.unpaidBookings, selectedLot]);
  const stats = useMemo(() => getDashboardStatusCounts({
    slots: slotsInLot,
    bookings: paidBookingsInLot,
    currentBlockStartTime: data.currentBlock?.startTime,
    isLiveOperationalDate: data.isLiveOperationalDate,
  }), [slotsInLot, paidBookingsInLot, data.currentBlock, data.isLiveOperationalDate]);
  const paymentUpdate = data.paymentUpdate;
  const paymentDateLabel = paymentUpdate?.date ? new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${paymentUpdate.date}T00:00:00Z`)) : "";
  const paymentUpdatedAt = paymentUpdate?.snapshot?.updatedAt ? new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(paymentUpdate.snapshot.updatedAt)) : "";
  const selectedDateLabel = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${selectedDate}T00:00:00Z`));
  const canShowRetry = canRetryPayment && paymentUpdate && paymentUpdate.status !== "READY";
  const canPrintDashboard = canPrint && !loading && data.paymentStatus === "READY" && Boolean(selectedLot);

  return (
    <div>
      {printing && <style media="print">{"@page { size: A3 portrait; margin: 8mm; }"}</style>}
      <div className="top-bar"><div className="inner"><h1>ติดตามสถานะลานจอด</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div>
      <div className="page timeline-page">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls">
          <div><label>วันที่ของรอบ 07:00</label><input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></div>
          <div><label>เลือกลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>{lot}</button>)}</div></div>
          <div>
            <label>&nbsp;</label>
            <div>
              <button
                type="button"
                className="btn btn-secondary refresh-button"
                disabled={loading || refreshing}
                onClick={() => loadDashboard(selectedDate, { force: true })}
              >
                {refreshing ? "กำลังรีเฟรช..." : "↻ รีเฟรชข้อมูล"}
              </button>
              {canPrint && <button type="button" className="btn btn-secondary" disabled={!canPrintDashboard} onClick={printDashboard}>🖨 พิมพ์ตารางสถานะลาน</button>}
            </div>
          </div>
        </div>
        {paymentMessage && <div className={`alert ${paymentMessage.includes("สำเร็จ") ? "alert-success" : "alert-error"}`}>{paymentMessage}</div>}
        {!loading && paymentUpdate?.status === "UPDATING" && <div className="alert alert-warning">ข้อมูลสำหรับวันที่ {paymentDateLabel} ยังไม่พร้อม{canShowRetry && <><br />โปรดรอหรือกด <button type="button" className="btn btn-secondary refresh-button" disabled={retryingPayment} onClick={retryPaymentSnapshot}>{retryingPayment ? "กำลังอัปเดตข้อมูล..." : "อัปเดตข้อมูลใหม่"}</button></>}</div>}
        {!loading && paymentUpdate?.status === "FAILED" && <div className="alert alert-error">ข้อมูลสำหรับวันที่ {paymentDateLabel} ยังไม่พร้อม{canShowRetry && <><br />โปรดรอหรือกด <button type="button" className="btn btn-secondary refresh-button" disabled={retryingPayment} onClick={retryPaymentSnapshot}>{retryingPayment ? "กำลังอัปเดตข้อมูล..." : "อัปเดตข้อมูลใหม่"}</button></>}</div>}
        {!loading && paymentUpdate?.status === "READY" && <div className="alert alert-success">สิทธิ์วันที่ {paymentDateLabel} พร้อมแล้ว<br />ตรวจสอบการชำระเงินเมื่อ {paymentUpdatedAt} · ใช้ตั๋ววันที่ {formatPaymentDate(paymentUpdate.snapshot.sourceDate)}</div>}
        {!loading && data.paymentStatus === "READY" && data.isLiveOperationalDate && <><div className="dashboard-current-block">สรุปสถานะรอบปัจจุบัน: {data.currentBlock?.label || "-"}{lastUpdated ? ` · ข้อมูลสถานะช่องล่าสุด ${lastUpdated}` : ""}</div><div className="summary-stat"><div className="stat-box"><div className="stat-label">มีการจอง</div><div className="stat-value">{stats.booked}</div></div><div className="stat-box"><div className="stat-label">ว่าง</div><div className="stat-value">{stats.vacant}</div></div><div className="stat-box stat-ticket-check"><div className="stat-label">รอตรวจตั๋ว</div><div className="stat-value">{stats["ticket-check"]}</div></div><div className="stat-box stat-expired"><div className="stat-label">หมดเวลาจอด</div><div className="stat-value">{stats.expired}</div></div><div className="stat-box"><div className="stat-label">ปิดใช้งาน</div><div className="stat-value">{stats.closed}</div></div></div></>}
        {!loading && data.paymentStatus === "READY" && !data.isLiveOperationalDate && <div className="alert alert-warning">กำลังดูข้อมูลย้อนหลัง/ล่วงหน้า จึงไม่แสดงสถานะ “หมดเวลาจอด” ตามเวลาจริง</div>}
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดข้อมูล Dashboard...</p></div> : data.paymentStatus === "UPDATING" ? <div className="card"><p className="subtitle">กำลังเตรียมสถานะช่องจอดจากข้อมูลชำระเงินล่าสุด โปรดรอให้ข้อมูลพร้อมก่อนใช้งานตารางนี้</p></div> : <><div className="status-legend screen-only"><span className="timeline-booked">มีการจอง</span><span className="timeline-vacant">ว่าง</span><span className="timeline-ticket-check">รอตรวจตั๋ว</span><span className="timeline-expired">หมดเวลาจอด</span><span className="timeline-closed">ปิดใช้งาน</span></div><div className="print-dashboard-header print-only"><h1>ระบบจองที่จอดรถเรียงสินค้า</h1><h2>ตารางสถานะลานจอด</h2><div><span>วันปฏิบัติการ: {selectedDateLabel}</span><span>ลาน: {displayLotName(selectedLot)}</span><span>ข้อมูลล่าสุด: {lastUpdated || "-"}</span><span>พิมพ์เมื่อ: {printedAt || "-"}</span></div>{!data.isLiveOperationalDate && <p>เอกสารอ้างอิงย้อนหลัง</p>}<div className="print-status-legend"><span>แดง: มีการจอง / รอตรวจตั๋ว</span><span>เขียว: ว่าง</span><span>เหลือง: หมดเวลาจอด</span><span>เทา: ปิดใช้งาน</span></div></div><div className="card dashboard-print-grid"><ParkingTimelineGrid slots={slotsInLot} bookings={paidBookingsInLot} mode="dashboard" currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /></div>{unpaidBookingsInLot.length > 0 && <div className="alert alert-warning screen-only">มี {unpaidBookingsInLot.length} รายการจองที่ยังไม่พบหลักฐานชำระเงิน จึงแสดงเป็น “ว่าง” สำหรับทีมตรวจพื้นที่ตามกติกา production</div>}</>}
      </div>
    </div>
  );
}
