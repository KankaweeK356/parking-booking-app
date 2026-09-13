import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParkingTimelineGrid from "../components/ParkingTimelineGrid";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function CSOverview() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], assignments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");

  useEffect(() => { loadOverview(today()); }, []);

  async function loadOverview(date) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/cs-overview?date=${encodeURIComponent(date)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่สำเร็จ");
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
  const assignmentsInLot = useMemo(() => (data.assignments || []).filter((assignment) => assignment.lot === selectedLot), [data.assignments, selectedLot]);
  const futureAssignmentsInLot = useMemo(() => (data.futureAssignments || []).filter((assignment) => assignment.lot === selectedLot), [data.futureAssignments, selectedLot]);

  return (
    <div>
      <div className="top-bar"><div className="inner"><h1>ภาพรวมการจัดสรรพื้นที่จอดรถ (CS Overview)</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div>
      <div className="page timeline-page">
        <h2>การจัดสรรตามรอบปฏิบัติการ 07:00–07:00</h2>
        <p className="subtitle">แสดงชื่อลูกค้าที่มีสิทธิ์จองในแต่ละช่องและรอบเวลา โดยไม่ใช้สถานะการชำระเงินเป็นเงื่อนไข</p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls">
          <div><label>วันที่ของรอบ 07:00</label><input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); loadOverview(e.target.value); }} /></div>
          <div><label>เลือกลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>ลาน {lot}</button>)}</div></div>
          <button type="button" className="btn btn-secondary refresh-button" onClick={() => loadOverview(selectedDate)}>↻ Refresh</button>
        </div>
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดข้อมูลการจัดสรรช่องจอด...</p></div> : <><div className="card"><ParkingTimelineGrid slots={slotsInLot} bookings={assignmentsInLot} mode="cs" /></div>{futureAssignmentsInLot.length > 0 && <div className="card"><h2 style={{ fontSize: 16 }}>รายการจองล่วงหน้าที่ยังมีผล</h2><div className="future-booking-list">{futureAssignmentsInLot.map((booking, index) => <div key={`${booking.slot}-${booking.startDate}-${index}`}><strong>ช่อง {booking.slot}</strong> — คุณ{booking.customer}, รอบ {booking.startTime}, เริ่ม {booking.startDate}{booking.endDate ? ` ถึง ${booking.endDate}` : ""}</div>)}</div></div>}</>}
      </div>
    </div>
  );
}
