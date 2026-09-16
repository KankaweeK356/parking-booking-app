import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParkingTimelineGrid from "../components/ParkingTimelineGrid";
import DashboardAttentionList from "../components/DashboardAttentionList";
import { getBangkokCalendarDateIso, getCurrentOperationalDateIso } from "../lib/operational-day";
import { getDashboardStatusCounts } from "../lib/timeline-status";

function today() { return getCurrentOperationalDateIso(); }

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [canRefreshPayment, setCanRefreshPayment] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");

  useEffect(() => { loadDashboard(today()); }, []);
  useEffect(() => { fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then((result) => setCanRefreshPayment(["Admin", "CS"].includes(result?.user?.role))); }, []);

  async function loadDashboard(date) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/dashboard?date=${encodeURIComponent(date)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูล Dashboard ไม่สำเร็จ");
      setData(result);
      setLastUpdated(new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date()));
      const availableLots = Array.from(new Set((result.slots || []).map((slot) => slot.lot).filter(Boolean))).sort();
      setSelectedLot((current) => availableLots.includes(current) ? current : availableLots[0] || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshPaymentSnapshot() {
    setPaymentMessage("");
    const date = getBangkokCalendarDateIso();
    try {
      const response = await fetch(`/api/payment-snapshot?date=${encodeURIComponent(date)}`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "อัปเดตสถานะชำระเงินไม่สำเร็จ");
      setPaymentMessage(`อัปเดตสิทธิ์วันที่ ${date} สำเร็จ`);
      await loadDashboard(selectedDate);
    } catch (err) { setPaymentMessage(err.message); }
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

  return (
    <div>
      <div className="top-bar"><div className="inner"><h1>ติดตามสถานะลานจอด</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div>
      <div className="page timeline-page">
        <h2>การตรวจสอบพื้นที่ตามรอบปฏิบัติการ 07:00–07:00</h2>
        <p className="subtitle">ติดตามตามรอบปฏิบัติการ 07:00–07:00 — “หมดเวลาจอด” หมายถึงสิทธิ์รอบก่อนหน้าสิ้นสุดแล้วและต้องตรวจพื้นที่</p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls">
          <div><label>วันที่ของรอบ 07:00</label><input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); loadDashboard(e.target.value); }} /></div>
          <div><label>เลือกลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>{lot}</button>)}</div></div>
          <button type="button" className="btn btn-secondary refresh-button" disabled={loading} onClick={() => loadDashboard(selectedDate)}>↻ Refresh หน้าจอ</button>
          {canRefreshPayment && <button type="button" className="btn btn-secondary refresh-button" disabled={loading} onClick={refreshPaymentSnapshot}>↻ อัปเดตสถานะชำระเงิน</button>}
        </div>
        {paymentMessage && <div className={`alert ${paymentMessage.includes("สำเร็จ") ? "alert-success" : "alert-error"}`}>{paymentMessage}</div>}
        {!loading && data.paymentStatus === "UPDATING" && <div className="alert alert-warning">กำลังอัปเดตข้อมูลสถานะชำระเงินของวันที่ {selectedDate} · ระบบจะแสดงผลเมื่อมี payment snapshot</div>}
        {!loading && data.paymentStatus === "READY" && <div className="alert alert-success">สถานะชำระเงินอัปเดต ณ {new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(data.paymentSnapshotUpdatedAt))} · อ้างอิงตั๋ววันที่ {data.paymentSourceDate}</div>}
        {!loading && data.isLiveOperationalDate && <><div className="dashboard-current-block">สรุปสถานะรอบปัจจุบัน: {data.currentBlock?.label || "-"}{lastUpdated ? ` · ข้อมูลล่าสุด ${lastUpdated}` : ""}</div><div className="summary-stat"><div className="stat-box"><div className="stat-label">มีการจอง</div><div className="stat-value">{stats.booked}</div></div><div className="stat-box"><div className="stat-label">ว่าง</div><div className="stat-value">{stats.vacant}</div></div><div className="stat-box stat-ticket-check"><div className="stat-label">รอตรวจตั๋ว</div><div className="stat-value">{stats["ticket-check"]}</div></div><div className="stat-box stat-expired"><div className="stat-label">หมดเวลาจอด</div><div className="stat-value">{stats.expired}</div></div><div className="stat-box"><div className="stat-label">ปิดใช้งาน</div><div className="stat-value">{stats.closed}</div></div></div><DashboardAttentionList slots={slotsInLot} bookings={paidBookingsInLot} currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /></>}
        {!loading && !data.isLiveOperationalDate && <div className="alert alert-warning">กำลังดูข้อมูลย้อนหลัง/ล่วงหน้า จึงไม่แสดงสถานะ “หมดเวลาจอด” ตามเวลาจริง</div>}
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดข้อมูล Dashboard...</p></div> : <><div className="status-legend"><span className="timeline-booked">มีการจอง</span><span className="timeline-vacant">ว่าง</span><span className="timeline-ticket-check">รอตรวจตั๋ว</span><span className="timeline-expired">หมดเวลาจอด</span><span className="timeline-closed">ปิดใช้งาน</span></div><div className="card"><ParkingTimelineGrid slots={slotsInLot} bookings={paidBookingsInLot} mode="dashboard" currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /></div>{unpaidBookingsInLot.length > 0 && <div className="alert alert-warning">มี {unpaidBookingsInLot.length} รายการจองที่ยังไม่พบหลักฐานชำระเงิน จึงแสดงเป็น “ว่าง” สำหรับทีมตรวจพื้นที่ตามกติกา production</div>}</>}
      </div>
    </div>
  );
}
