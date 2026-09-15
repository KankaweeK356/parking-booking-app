import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParkingTimelineGrid from "../components/ParkingTimelineGrid";
import { getCurrentOperationalDateIso } from "../lib/operational-day";

function today() { return getCurrentOperationalDateIso(); }

export default function MobileView() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");

  useEffect(() => { loadData(today()); }, []);
  async function loadData(date) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/dashboard?date=${encodeURIComponent(date)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่สำเร็จ");
      setData(result);
      const availableLots = Array.from(new Set((result.slots || []).map((slot) => slot.lot).filter(Boolean))).sort();
      setSelectedLot((current) => current || availableLots[0] || "");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  const lots = useMemo(() => Array.from(new Set((data.slots || []).map((slot) => slot.lot).filter(Boolean))).sort(), [data.slots]);
  const slotsInLot = useMemo(() => (data.slots || []).filter((slot) => slot.lot === selectedLot), [data.slots, selectedLot]);
  const paidBookingsInLot = useMemo(() => (data.bookings || []).filter((booking) => booking.lot === selectedLot), [data.bookings, selectedLot]);

  return (
    <div>
      <div className="top-bar"><div className="inner"><h1>📱 ติดตามสถานะลานจอด</h1><Link href="/" className="back">หน้าหลัก</Link></div></div>
      <div className="page timeline-page mobile-timeline-page">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls">
          <div><label>วันที่ของรอบ 07:00</label><input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); loadData(e.target.value); }} /></div>
          <div><label>ลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>ลาน {lot}</button>)}</div></div>
          <button type="button" className="btn btn-secondary refresh-button" onClick={() => loadData(selectedDate)}>↻ Refresh</button>
        </div>
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดสถานะช่องจอด...</p></div> : <div className="card"><ParkingTimelineGrid slots={slotsInLot} bookings={paidBookingsInLot} mode="dashboard" currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /></div>}
      </div>
    </div>
  );
}
