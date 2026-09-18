import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ParkingTimelineGrid from "../components/ParkingTimelineGrid";
import { displayLotName } from "../lib/display";
import { getCurrentOperationalDateIso } from "../lib/operational-day";

function today() { return getCurrentOperationalDateIso(); }
function formatDate(value) { return String(value || "").split("-").reverse().join("/"); }

export default function CSOverview() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], assignments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printedAt, setPrintedAt] = useState("");
  const [printUserName, setPrintUserName] = useState("");

  useEffect(() => { loadOverview(today()); }, []);
  useEffect(() => { fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then((data) => setPrintUserName(data?.user?.name || "")); }, []);
  useEffect(() => { if (!printing) return undefined; document.body.classList.add("cs-overview-printing"); const done = () => { document.body.classList.remove("cs-overview-printing"); setPrinting(false); }; window.addEventListener("afterprint", done); return () => { document.body.classList.remove("cs-overview-printing"); window.removeEventListener("afterprint", done); }; }, [printing]);

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
  function printOverview() { setPrintedAt(new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date())); setPrinting(true); window.setTimeout(() => window.print(), 100); }

  return (
    <div>
      {printing && <style media="print">{"@page { size: A3 portrait; margin: 8mm; }"}</style>}
      <div className="top-bar"><div className="inner"><h1>ภาพรวมการจอง</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div>
      <div className="page timeline-page">
        <h2>ภาพรวมการจอง</h2>
        <p className="subtitle">ดูรายการจองของลูกค้า แยกตามลาน ช่องจอด และรอบเวลา</p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls">
          <div><label>วันที่ใช้งาน</label><input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); loadOverview(e.target.value); }} /></div>
          <div><label>เลือกลานจอด</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>{displayLotName(lot)}</button>)}</div></div>
          <div><button type="button" className="btn btn-secondary refresh-button" onClick={() => loadOverview(selectedDate)}>↻ อัปเดตรายการจอง</button><button type="button" className="btn btn-secondary" onClick={printOverview} disabled={loading || !selectedLot}>🖨 พิมพ์ภาพรวมการจอง</button></div>
        </div>
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดข้อมูลการจอง...</p></div> : <><div className="print-cs-overview-header print-only"><h1>ระบบจองที่จอดรถเรียงสินค้า</h1><h2>ภาพรวมการจอง</h2><p>วันที่ใช้งาน: {formatDate(selectedDate)} · ลานจอด: {displayLotName(selectedLot)} · พิมพ์โดย: {printUserName || "-"} · พิมพ์เมื่อ: {printedAt || "-"}</p></div><div className="card cs-overview-print-grid"><ParkingTimelineGrid slots={slotsInLot} bookings={assignmentsInLot} mode="cs" /></div></>}
      </div>
    </div>
  );
}
