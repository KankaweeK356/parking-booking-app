import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OperationalTimePicker from "../../components/OperationalTimePicker";
import EndDateField from "../../components/EndDateField";
import CustomerPicker from "../../components/CustomerPicker";
import { getCurrentOperationalDateIso } from "../../lib/operational-day";
import { displayLotName } from "../../lib/display";

function nextOperationalDate() { const d = new Date(`${getCurrentOperationalDateIso()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function bookingText(booking, slots) { return `${displayLotName(booking.lot)} / ช่อง ${slots.find((item) => item.slotCode === booking.slot)?.number || "-"} / รอบ ${booking.startTime}`; }

export default function NewBooking() {
  const [customers, setCustomers] = useState([]); const [slots, setSlots] = useState([]); const [lots, setLots] = useState([]);
  const [customer, setCustomer] = useState(""); const [lot, setLot] = useState(""); const [selectedSlots, setSelectedSlots] = useState([]);
  const [startDate, setStartDate] = useState(nextOperationalDate()); const [endDate, setEndDate] = useState(""); const [startTimes, setStartTimes] = useState(["07:00"]);
  const [availability, setAvailability] = useState({}); const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState(""); const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false); const [result, setResult] = useState(null); const [loadError, setLoadError] = useState("");
  const [existingBookings, setExistingBookings] = useState([]); const [showExistingBookings, setShowExistingBookings] = useState(false); const [refreshMessage, setRefreshMessage] = useState("");

  async function loadFormData() {
    setLoadError(""); setRefreshMessage("");
    try {
      const [m, s] = await Promise.all([fetch("/api/master").then((r) => r.json()), fetch("/api/slots").then((r) => r.json())]);
      if (m.error || s.error) throw new Error(m.error || s.error);
      const slotList = Array.isArray(s) ? s : (s.slots || []); const lotList = s.lots || Array.from(new Set(slotList.map((item) => item.lot).filter(Boolean))).sort();
      setCustomers(Array.isArray(m) ? m : []); setSlots(slotList); setLots(lotList); setLot((old) => lotList.includes(old) ? old : (lotList[0] || "")); setAvailabilityVersion((current) => current + 1); setRefreshMessage("อัปเดตสถานะช่องแล้ว");
    } catch (error) { setLoadError(error.message); }
  }
  useEffect(() => { loadFormData(); }, []);
  useEffect(() => { setExistingBookings([]); setShowExistingBookings(false); if (customer) fetch(`/api/bookings?customer=${encodeURIComponent(customer)}`).then((r) => r.ok ? r.json() : []).then((rows) => setExistingBookings(Array.isArray(rows) ? rows : [])); }, [customer]);
  useEffect(() => {
    if (!lot || !startDate || !endDate || !startTimes.length) { setAvailability({}); setAvailabilityLoading(false); return; }
    let alive = true; setAvailabilityLoading(true); setAvailabilityMessage("");
    fetch(`/api/booking-availability?lot=${encodeURIComponent(lot)}&startDate=${startDate}&endDate=${endDate}&startTimes=${encodeURIComponent(startTimes.join(","))}`)
      .then((r) => r.ok ? r.json() : { availability: [] }).then((data) => { if (!alive) return; const map = Object.fromEntries((data.availability || []).map((item) => [item.slotCode, item])); setAvailability(map); setSelectedSlots((chosen) => { const retained = chosen.filter((code) => !map[code]?.blocked); if (retained.length < chosen.length) setAvailabilityMessage("มีช่องที่เลือกไว้ไม่ว่างตามวันหรือรอบใหม่ จึงนำออกจากรายการแล้ว"); return retained; }); })
      .finally(() => alive && setAvailabilityLoading(false));
    return () => { alive = false; };
  }, [lot, startDate, endDate, startTimes.join(","), availabilityVersion]);
  const slotsInLot = useMemo(() => slots.filter((item) => item.lot === lot), [slots, lot]);
  const relevantExistingBookings = useMemo(() => existingBookings.filter((booking) => booking.lot === lot && startTimes.includes(booking.startTime)), [existingBookings, lot, startTimes]);
  const chooseCustomer = (name) => { setCustomer(name); setSelectedSlots([]); setResult(null); };
  const toggleSlot = (slotCode, disabled) => { if (!disabled) setSelectedSlots((current) => current.includes(slotCode) ? current.filter((item) => item !== slotCode) : [...current, slotCode]); };
  async function handleSubmit(event) {
    event.preventDefault(); if (!customer || !selectedSlots.length || !startDate || !endDate || !startTimes.length) return; setSubmitting(true); setResult(null);
    try { const response = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer, lot, slots: selectedSlots, startDate, endDate, startTimes }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setResult({ ok: true, message: `บันทึกการจองสำเร็จ ${data.count} รายการ` }); setSelectedSlots([]); loadFormData(); }
    catch (error) { setResult({ ok: false, error: error.message || "เกิดข้อผิดพลาดในการบันทึก" }); } finally { setSubmitting(false); }
  }
  return <div><div className="top-bar"><div className="inner"><h1>จองใหม่ / เพิ่มช่อง</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div><div className="page">
    {loadError && <div className="alert alert-error">โหลดข้อมูลไม่สำเร็จ: {loadError}</div>}
    <form onSubmit={handleSubmit}><div className="card"><div className="section-heading-row"><label>ข้อมูลการจอง</label><button type="button" className="btn btn-secondary" onClick={loadFormData}>↻ อัปเดตสถานะช่อง</button></div>{refreshMessage && <p className="subtitle">{refreshMessage}</p>}
      <CustomerPicker customers={customers} value={customer} onChange={chooseCustomer} required />
      {existingBookings.length > 0 && <p className="booking-count-note">มีรายการจองอยู่ {existingBookings.length} รายการ</p>}
      <label>เลือกลานจอด</label><select value={lot} onChange={(event) => { setLot(event.target.value); setSelectedSlots([]); }}>{lots.map((item) => <option key={item} value={item}>{displayLotName(item)}</option>)}</select>
      <section className="booking-period-section"><h2>ช่วงการจอง</h2><div className="booking-date-range"><div><label>วันที่เริ่มใช้</label><input type="date" value={startDate} min={nextOperationalDate()} onChange={(event) => setStartDate(event.target.value)} required /></div><EndDateField startDate={startDate} value={endDate} onChange={setEndDate} label="วันที่สิ้นสุด" /></div></section>
      <OperationalTimePicker values={startTimes} onChange={setStartTimes} label="เลือกรอบการใช้งาน" required multiple />
      {relevantExistingBookings.length > 0 && <div className="booking-context"><strong>รายการเดิมในลาน/รอบที่เลือก</strong>{startTimes.map((time) => { const numbers = relevantExistingBookings.filter((booking) => booking.startTime === time).map((booking) => slots.find((slot) => slot.slotCode === booking.slot)?.number).filter(Boolean).sort((a, b) => Number(a) - Number(b)); return numbers.length ? <p key={time}>รอบ {time} · ช่องเดิม {numbers.join(", ")}</p> : null; })}</div>}
      {!endDate || !startTimes.length ? <p className="availability-prompt">ระบุช่วงวันและรอบที่ต้องการ เพื่อดูช่องว่าง</p> : <><label>เลือกช่องจอด (เลือกได้หลายช่อง)</label>{availabilityLoading ? <p className="availability-prompt">กำลังตรวจสอบช่องว่าง…</p> : <div className="slot-grid">{slotsInLot.map((slot) => { const isClosed = slot.status === "ปิด" || slot.isRoad; const hasConflict = !isClosed && availability[slot.slotCode]?.blocked; const blocked = isClosed || hasConflict; const active = selectedSlots.includes(slot.slotCode); return <button type="button" key={slot.slotCode} className={`slot-btn ${isClosed ? "closed" : hasConflict ? "unavailable" : "open"} ${active ? "active" : ""}`} onClick={() => toggleSlot(slot.slotCode, blocked)} title={blocked ? (availability[slot.slotCode]?.reason || slot.reason || "ปิดใช้งาน") : "ว่าง"}>ช่อง {slot.number || "-"}</button>; })}</div>}{availabilityMessage && <p className="alert alert-warning">{availabilityMessage}</p>}<p className="subtitle">เขียว = เลือกได้ · แดง = มีการจองแล้ว · เทา = ปิดใช้งาน</p></>}
      <p className="subtitle">จองทั้งหมด {selectedSlots.length} ช่อง × {startTimes.length} รอบ = {selectedSlots.length * startTimes.length} ตั๋วต่อวัน</p>
      {existingBookings.length > 0 && <details className="existing-bookings-details"><summary>ดูรายการจองทั้งหมดของลูกค้ารายนี้ ({existingBookings.length} รายการ)</summary>{existingBookings.map((booking) => <p key={booking.rowNumber}>{bookingText(booking, slots)} · ใช้ถึง {booking.endDate}</p>)}</details>}
    </div>{result && <div className={`alert ${result.ok ? "alert-success" : "alert-error"}`}>{result.ok ? <>{result.message} <Link href={`/required-summary?customer=${encodeURIComponent(customer)}`}>พิมพ์สรุปให้ลูกค้า</Link></> : `ไม่สามารถบันทึกได้: ${result.error}`}</div>}<div className="btn-row"><button type="submit" className="btn btn-primary" disabled={submitting || !selectedSlots.length || !endDate || !startTimes.length}>{submitting ? "กำลังตรวจสอบและบันทึก..." : "ยืนยันการจอง"}</button></div></form>
  </div></div>;
}
