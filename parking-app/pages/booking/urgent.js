import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OperationalTimePicker from "../../components/OperationalTimePicker";
import CustomerPicker from "../../components/CustomerPicker";
import { getUrgentAccessDefaultDateIso, isBeforeOperationalBlockStart } from "../../lib/operational-day";
import { displayLotName } from "../../lib/display";

function timeLabel(value) {
  const match = String(value || "").match(/T(\d{2}:\d{2})/) || String(value || "").match(/\s(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

export default function UrgentBooking() {
  const [customers, setCustomers] = useState([]); const [slots, setSlots] = useState([]); const [customer, setCustomer] = useState("");
  const [data, setData] = useState(null); const [selected, setSelected] = useState([]); const [note, setNote] = useState("");
  const [mode, setMode] = useState("existing"); const [lot, setLot] = useState(""); const [newSlots, setNewSlots] = useState([]); const [startTime, setStartTime] = useState("");
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [submitting, setSubmitting] = useState(false);
  const accessDate = getUrgentAccessDefaultDateIso();

  async function loadReferenceData() {
    setLoading(true); setError("");
    try {
      const [masterResponse, slotsResponse] = await Promise.all([fetch("/api/master"), fetch("/api/slots")]);
      const master = await masterResponse.json(); const slotData = await slotsResponse.json();
      if (!masterResponse.ok) throw new Error(master.error || "โหลดรายชื่อลูกค้าไม่สำเร็จ");
      if (!slotsResponse.ok) throw new Error(slotData.error || "โหลดข้อมูลช่องจอดไม่สำเร็จ");
      const list = slotData.slots || slotData || [];
      setCustomers(master || []); setSlots(list); setLot((current) => current || list[0]?.lot || "");
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function loadCustomer() {
    if (!customer) return;
    setError("");
    try {
      const response = await fetch(`/api/bookings/urgent?customer=${encodeURIComponent(customer)}&date=${accessDate}`);
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "โหลดสิทธิ์ลูกค้าไม่สำเร็จ");
      setData(result); setSelected([]); setMessage("");
    } catch (err) { setData(null); setError(err.message); }
  }

  useEffect(() => { loadReferenceData(); }, []);
  useEffect(() => { if (customer) loadCustomer(); else { setData(null); setSelected([]); } }, [customer, accessDate]);

  const uncovered = useMemo(() => (data?.bookings || []).filter((b) => !(data.coveredKeys || []).includes(`${b.slot}::${b.startTime}`) && isBeforeOperationalBlockStart(accessDate, b.startTime)), [data, accessDate]);
  const allowedStartTimes = useMemo(() => ["07:00", "11:00", "15:00", "19:00", "23:00", "03:00"].filter((time) => isBeforeOperationalBlockStart(accessDate, time)), [accessDate]);
  const lotSlots = useMemo(() => slots.filter((s) => s.lot === lot && s.status !== "ปิด" && !s.isRoad), [slots, lot]);

  async function submit() {
    setSubmitting(true); setError(""); setMessage("");
    try {
      const body = { customer, accessDate, note };
      if (mode === "existing") body.entries = uncovered.filter((b) => selected.includes(b.rowNumber)).map((b) => ({ rowNumber: b.rowNumber, lot: b.lot, slot: b.slot, number: slots.find((s) => s.slotCode === b.slot)?.number || "", startTime: b.startTime }));
      else body.newBooking = { lot, slots: newSlots, startTime };
      const response = await fetch("/api/bookings/urgent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "บันทึกไม่สำเร็จ");
      setMessage(`บันทึกสำเร็จ ${result.count} สิทธิ์`); setSelected([]); setNewSlots([]); setStartTime(""); await loadCustomer();
    } catch (err) { setError(err.message); } finally { setSubmitting(false); }
  }

  const cannotSubmit = submitting || !customer || (mode === "existing" ? selected.length === 0 : newSlots.length === 0 || !startTime);
  return <div><div className="top-bar"><div className="inner"><h1>จองรายวัน</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div><div className="page">
    <div className="card"><div className="section-heading-row"><span></span><button type="button" className="btn btn-secondary" onClick={loadReferenceData} disabled={loading}>↻ อัปเดตสถานะช่อง</button></div><CustomerPicker customers={customers} value={customer} onChange={setCustomer} label="เลือกลูกค้า" required /><p className="subtitle">วันที่ใช้สิทธิ์: {accessDate} · บันทึกได้เฉพาะก่อนเวลาเริ่มรอบ</p></div>
    {error && <div className="alert alert-error">{error}</div>}{message && <div className="alert alert-success">{message}</div>}
    {data && <><details className="card"><summary>ประวัติสิทธิ์ระหว่างวันล่าสุด ({(data.history || []).length} รายการ)</summary>{(data.history || []).map((h, i) => <p key={i}>วันที่ {h.accessDate} — {h.lot || "-"} / ช่อง {h.number || "-"} / รอบ {h.startTime} — {h.actionType || "สิทธิ์ระหว่างวัน"}{timeLabel(h.createdAt) ? ` · บันทึก ${timeLabel(h.createdAt)}` : ""}</p>)}</details>
      <div className="card"><div className="home-tabs"><button className={`btn ${mode === "existing" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("existing")}>จองเพิ่ม</button><button className={`btn ${mode === "new" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("new")}>จองใหม่รายวัน</button></div>
        {mode === "existing" ? <>{uncovered.length === 0 ? <p className="subtitle">ไม่มีรายการจองเดิมที่ยังบันทึกได้ก่อนรอบเริ่ม</p> : uncovered.map((b) => <label key={b.rowNumber} className="booking-row"><input type="checkbox" checked={selected.includes(b.rowNumber)} onChange={() => setSelected((items) => items.includes(b.rowNumber) ? items.filter((id) => id !== b.rowNumber) : [...items, b.rowNumber])} /><span>{displayLotName(b.lot)} / ช่อง {slots.find((s) => s.slotCode === b.slot)?.number || "-"} / รอบ {b.startTime}</span></label>)}</> : <><label>เลือกลานจอด</label><select value={lot} onChange={(e) => { setLot(e.target.value); setNewSlots([]); }}>{[...new Set(slots.map((s) => s.lot))].map((item) => <option key={item}>{displayLotName(item)}</option>)}</select><div className="slot-grid">{lotSlots.map((s) => <button type="button" key={s.slotCode} className={`slot-btn ${newSlots.includes(s.slotCode) ? "active" : "open"}`} onClick={() => setNewSlots((items) => items.includes(s.slotCode) ? items.filter((id) => id !== s.slotCode) : [...items, s.slotCode])}>ช่อง {s.number}</button>)}</div><OperationalTimePicker value={startTime} onChange={setStartTime} label="เลือกรอบเวลา (เลือกได้ 1 รอบ)" availableValues={allowedStartTimes} /></>}</div>
      <div className="card"><label>หมายเหตุเพิ่มเติม (ถ้ามี)</label><input value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn btn-primary" disabled={cannotSubmit} onClick={submit}>{submitting ? "กำลังบันทึก..." : "บันทึกสิทธิ์ระหว่างวัน"}</button></div>
    </>}</div></div>;
}
