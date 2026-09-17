import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParkingTimelineGrid from "../components/ParkingTimelineGrid";
import DashboardAttentionList from "../components/DashboardAttentionList";
import { getCurrentOperationalDateIso } from "../lib/operational-day";
import { getDashboardStatusCounts } from "../lib/timeline-status";

function today() { return getCurrentOperationalDateIso(); }

export default function MobileView() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData(selectedDate);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadData(selectedDate, { silent: true });
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [selectedDate]);
  async function loadData(date, { silent = false, force = false } = {}) {
    if (!silent && !force) { setLoading(true); setError(""); }
    if (force) { setRefreshing(true); setError(""); }
    try {
      const url = `/api/dashboard?date=${encodeURIComponent(date)}${force ? "&force=true" : ""}`;
      const response = await fetch(url);
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch { throw new Error("โหลดข้อมูลไม่สำเร็จ กรุณารอสักครู่"); }
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่สำเร็จ");
      setData(result);
      setLastUpdated(new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date()));
      const availableLots = Array.from(new Set((result.slots || []).map((slot) => slot.lot).filter(Boolean))).sort();
      setSelectedLot((current) => availableLots.includes(current) ? current : availableLots[0] || "");
    } catch (err) { if (!silent || force) setError(err.message); } finally { if (!silent && !force) setLoading(false); if (force) setRefreshing(false); }
  }

  const lots = useMemo(() => Array.from(new Set((data.slots || []).map((slot) => slot.lot).filter(Boolean))).sort(), [data.slots]);
  const slotsInLot = useMemo(() => (data.slots || []).filter((slot) => slot.lot === selectedLot), [data.slots, selectedLot]);
  const paidBookingsInLot = useMemo(() => (data.bookings || []).filter((booking) => booking.lot === selectedLot), [data.bookings, selectedLot]);
  const stats = useMemo(() => getDashboardStatusCounts({ slots: slotsInLot, bookings: paidBookingsInLot, currentBlockStartTime: data.currentBlock?.startTime, isLiveOperationalDate: data.isLiveOperationalDate }), [slotsInLot, paidBookingsInLot, data.currentBlock, data.isLiveOperationalDate]);
  const paymentUpdate = data.paymentUpdate;
  const paymentDateLabel = paymentUpdate?.date ? new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${paymentUpdate.date}T00:00:00Z`)) : "";

  return (
    <div>
      <div className="top-bar"><div className="inner"><h1>📱 ติดตามสถานะลานจอด</h1><Link href="/" className="back">หน้าหลัก</Link></div></div>
      <div className="page timeline-page mobile-timeline-page">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls">
          <div><label>วันที่ของรอบ 07:00</label><input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></div>
          <div><label>ลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>{lot}</button>)}</div></div>
          <div>
            <label>&nbsp;</label>
            <div>
              <button
                type="button"
                className="btn btn-secondary refresh-button"
                disabled={loading || refreshing}
                onClick={() => loadData(selectedDate, { force: true })}
              >
                {refreshing ? "กำลังรีเฟรช..." : "↻ รีเฟรช"}
              </button>
            </div>
          </div>
        </div>
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดสถานะช่องจอด...</p></div> : <>{paymentUpdate?.status !== "READY" ? <div className="alert alert-warning">{paymentUpdate?.status === "FAILED" ? `ระบบยังอัปเดตข้อมูลสำหรับวันที่ ${paymentDateLabel} ไม่สำเร็จ` : `ระบบกำลังอัปเดตข้อมูลสำหรับวันที่ ${paymentDateLabel}`}</div> : <div className="alert alert-success">ระบบอัปเดตข้อมูลสำหรับวันที่ {paymentDateLabel} เรียบร้อยแล้ว</div>}{data.paymentStatus === "UPDATING" ? <div className="card"><p className="subtitle">โปรดรอให้ข้อมูลพร้อมก่อนใช้สถานะช่องจอดตัดสินพื้นที่</p></div> : <><div className="dashboard-current-block">รอบปัจจุบัน: {data.currentBlock?.label || "-"}{lastUpdated ? ` · ข้อมูลล่าสุด ${lastUpdated}` : ""}</div><div className="mobile-status-summary"><span>มีการจอง {stats.booked}</span><span>รอตรวจตั๋ว {stats["ticket-check"]}</span><span>หมดเวลาจอด {stats.expired}</span></div><DashboardAttentionList slots={slotsInLot} bookings={paidBookingsInLot} currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /><details className="card mobile-full-grid"><summary>ดูตารางครบ 6 รอบ</summary><ParkingTimelineGrid slots={slotsInLot} bookings={paidBookingsInLot} mode="dashboard" currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /></details></>}</>}
      </div>
    </div>
  );
}
