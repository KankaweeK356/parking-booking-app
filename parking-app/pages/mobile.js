import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardAttentionList from "../components/DashboardAttentionList";
import MobileRoundSlotList from "../components/MobileRoundSlotList";
import { getCurrentOperationalDateIso, OPERATIONAL_TIME_BLOCKS } from "../lib/operational-day";
import { displayLotName } from "../lib/display";
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
  const [selectedRound, setSelectedRound] = useState("");

  useEffect(() => {
    loadData(selectedDate);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const currentDate = today();
      if (currentDate !== selectedDate) setSelectedDate(currentDate);
      else loadData(selectedDate, { silent: true });
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [selectedDate]);
  useEffect(() => {
    if (data.currentBlock?.startTime) setSelectedRound(data.currentBlock.startTime);
  }, [data.currentBlock?.startTime]);
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
  const activeRound = selectedRound || data.currentBlock?.startTime || "07:00";

  return (
    <div>
      <div className="top-bar"><div className="inner"><h1>📱 ติดตามสถานะช่องจอด</h1><Link href="/" className="back">หน้าหลัก</Link></div></div>
      <div className="page timeline-page mobile-timeline-page">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls mobile-timeline-controls">
          <div><label>วันปฏิบัติการ</label><strong>{selectedDate} · 07:00–07:00</strong></div>
          <div><label>ลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>{displayLotName(lot)}</button>)}</div></div>
          <div>
            <label>&nbsp;</label>
            <div>
              <button
                type="button"
                className="btn btn-secondary refresh-button"
                disabled={loading || refreshing}
                onClick={() => loadData(selectedDate, { force: true })}
              >
                {refreshing ? "กำลังอัปเดต..." : "↻ อัปเดตสถานะล่าสุด"}
              </button>
            </div>
          </div>
        </div>
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดสถานะช่องจอด...</p></div> : <>{paymentUpdate?.status !== "READY" ? <div className="alert alert-warning">{paymentUpdate?.status === "FAILED" ? `ระบบยังอัปเดตข้อมูลสำหรับวันที่ ${paymentDateLabel} ไม่สำเร็จ` : `ระบบกำลังอัปเดตข้อมูลสำหรับวันที่ ${paymentDateLabel}`}</div> : <div className="alert alert-success">ระบบอัปเดตข้อมูลสำหรับวันที่ {paymentDateLabel} เรียบร้อยแล้ว</div>}{data.paymentStatus === "UPDATING" ? <div className="card"><p className="subtitle">โปรดรอให้ข้อมูลพร้อมก่อนใช้สถานะช่องจอดตัดสินพื้นที่</p></div> : <><div className="dashboard-current-block">รอบปัจจุบัน: {data.currentBlock?.label || "-"}{lastUpdated ? ` · ข้อมูลล่าสุด ${lastUpdated}` : ""}</div><div className="mobile-status-summary"><span>มีการจอง {stats.booked}</span><span>รอตรวจตั๋ว {stats["ticket-check"]}</span><span>หมดเวลาจอด {stats.expired}</span></div><DashboardAttentionList slots={slotsInLot} bookings={paidBookingsInLot} currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /><section className="mobile-round-picker"><h2>ดูสถานะตามรอบ</h2><div className="round-buttons">{OPERATIONAL_TIME_BLOCKS.map((block) => <button type="button" key={block.startTime} className={`round-button ${activeRound === block.startTime ? "active" : ""}`} onClick={() => setSelectedRound(block.startTime)}>{block.startTime}</button>)}</div></section><MobileRoundSlotList slots={slotsInLot} bookings={paidBookingsInLot} selectedRound={activeRound} currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /></>}</>}
      </div>
    </div>
  );
}
