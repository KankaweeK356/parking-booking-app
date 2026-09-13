import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParkingTimelineGrid from "../components/ParkingTimelineGrid";

function today() { return new Date().toISOString().slice(0, 10); }

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");

  useEffect(() => { loadDashboard(today()); }, []);

  async function loadDashboard(date) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/dashboard?date=${encodeURIComponent(date)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูล Dashboard ไม่สำเร็จ");
      setData(result);
      const availableLots = Array.from(new Set((result.slots || []).map((slot) => slot.lot).filter(Boolean))).sort();
      setSelectedLot((current) => current || availableLots[0] || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const lots = useMemo(() => Array.from(new Set((data.slots || []).map((slot) => slot.lot).filter(Boolean))).sort(), [data.slots]);
  const slotsInLot = useMemo(() => (data.slots || []).filter((slot) => slot.lot === selectedLot), [data.slots, selectedLot]);
  const paidBookingsInLot = useMemo(() => (data.bookings || []).filter((booking) => booking.lot === selectedLot), [data.bookings, selectedLot]);
  const unpaidBookingsInLot = useMemo(() => (data.unpaidBookings || []).filter((booking) => booking.lot === selectedLot), [data.unpaidBookings, selectedLot]);
  const stats = useMemo(() => {
    const closed = slotsInLot.filter((slot) => slot.isClosed || slot.isRoad).length;
    const paidKeys = new Set(paidBookingsInLot.map((booking) => booking.slot));
    return { closed, occupied: paidKeys.size, vacant: slotsInLot.length - closed - paidKeys.size };
  }, [slotsInLot, paidBookingsInLot]);

  return (
    <div>
      <div className="top-bar"><div className="inner"><h1>ตารางสถานะลานจอด (Dashboard)</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div>
      <div className="page timeline-page">
        <h2>การตรวจสอบพื้นที่ตามรอบปฏิบัติการ 07:00–07:00</h2>
        <p className="subtitle">“มีการจอง” หมายถึงพบหลักฐานการชำระเงินของวันที่เลือกตามกติกา production (Transection ของวันก่อนหน้า)</p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls">
          <div><label>วันที่ของรอบ 07:00</label><input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); loadDashboard(e.target.value); }} /></div>
          <div><label>เลือกลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>ลาน {lot}</button>)}</div></div>
          <button type="button" className="btn btn-secondary refresh-button" onClick={() => loadDashboard(selectedDate)}>↻ Refresh</button>
        </div>
        {!loading && <div className="summary-stat"><div className="stat-box"><div className="stat-label">มีการจอง</div><div className="stat-value">{stats.occupied}</div></div><div className="stat-box"><div className="stat-label">ว่าง</div><div className="stat-value">{stats.vacant}</div></div><div className="stat-box"><div className="stat-label">ปิดใช้งาน</div><div className="stat-value">{stats.closed}</div></div></div>}
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดข้อมูล Dashboard...</p></div> : <><div className="card"><ParkingTimelineGrid slots={slotsInLot} bookings={paidBookingsInLot} mode="dashboard" /></div>{unpaidBookingsInLot.length > 0 && <div className="alert alert-warning">มี {unpaidBookingsInLot.length} รายการจองที่ยังไม่พบหลักฐานชำระเงิน จึงแสดงเป็น “ว่าง” สำหรับทีมตรวจพื้นที่ตามกติกา production</div>}</>}
      </div>
    </div>
  );
}
