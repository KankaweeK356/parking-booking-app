import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OperationalTimePicker from "../../components/OperationalTimePicker";
import EndDateField from "../../components/EndDateField";
import { getCurrentOperationalDateIso } from "../../lib/operational-day";

function defaultStartDate() {
  const date = new Date(`${getCurrentOperationalDateIso()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default function NewBooking() {
  const [customers, setCustomers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [lots, setLots] = useState([]);
  const [customer, setCustomer] = useState("");
  const [lot, setLot] = useState("");
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState("");
  const [startTimes, setStartTimes] = useState(["07:00"]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { ok, error, message }
  const [loadError, setLoadError] = useState("");
  const [existingBookings, setExistingBookings] = useState([]);
  const [referenceRow, setReferenceRow] = useState(null);

  function loadFormData() {
    setLoadError("");
    Promise.all([
      fetch("/api/master").then((r) => r.json()),
      fetch("/api/slots").then((r) => r.json()),
    ])
      .then(([m, s]) => {
        if (m.error || s.error) throw new Error(m.error || s.error);
        setCustomers(Array.isArray(m) ? m : []);
        const slotList = Array.isArray(s) ? s : (s.slots || []);
        const lotList = s.lots || Array.from(new Set(slotList.map((item) => item.lot).filter(Boolean))).sort();
        setSlots(slotList);
        setLots(lotList);
        if (lotList.length > 0) {
          setLot(lotList[0]);
        }
      })
      .catch((e) => setLoadError(e.message));
  }

  useEffect(() => { loadFormData(); }, []);
  useEffect(() => {
    setReferenceRow(null); setExistingBookings([]);
    if (!customer) return;
    fetch(`/api/bookings?customer=${encodeURIComponent(customer)}`).then((r) => r.ok ? r.json() : []).then((rows) => setExistingBookings(Array.isArray(rows) ? rows : []));
  }, [customer]);

  const slotsInLot = useMemo(() => slots.filter((s) => s.lot === lot), [slots, lot]);

  function toggleSlot(slotCode, disabled) {
    if (disabled) return;
    setSelectedSlots((prev) =>
      prev.includes(slotCode) ? prev.filter((s) => s !== slotCode) : [...prev, slotCode]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!customer || selectedSlots.length === 0 || !startDate || startTimes.length === 0) return;
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer,
          lot,
          slots: selectedSlots,
          startDate,
          endDate,
          startTimes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({
          ok: false,
          error: data.error || "เกิดข้อผิดพลาดในการบันทึกการจอง",
        });
      } else {
        setResult({
          ok: true,
          message: `✓ บันทึกการจองสำเร็จ ${data.count} สิทธิ์ (${selectedSlots.length} ช่อง × ${startTimes.length} รอบ)`,
        });
        setSelectedSlots([]);
        loadFormData();
      }
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>จองใหม่ / เพิ่มช่อง</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>
      <div className="page">
        {loadError && <div className="alert alert-error">โหลดข้อมูลไม่สำเร็จ: {loadError}</div>}

        <form onSubmit={handleSubmit}>
          <div className="card">
            <div className="section-heading-row">
              <div><label>ข้อมูลการจอง</label></div>
              <button type="button" className="btn btn-secondary" onClick={loadFormData}>↻ Refresh สถานะช่อง</button>
            </div>
            <label>ลูกค้า</label>
            <select value={customer} onChange={(e) => setCustomer(e.target.value)} required>
              <option value="">— เลือกลูกค้า —</option>
              {customers.map((c) => (
                <option key={c.docId || c.name} value={c.name}>{c.name}</option>
              ))}
            </select>

            {existingBookings.length > 0 && <div className="existing-rights"><label>สิทธิ์ที่ลูกค้ามีอยู่ (เลือกเป็นรายการอ้างอิงได้)</label>{existingBookings.map((booking) => <button key={booking.rowNumber} type="button" className={`booking-row ${referenceRow?.rowNumber === booking.rowNumber ? "selected" : ""}`} onClick={() => { setReferenceRow(booking); setEndDate(booking.endDate || ""); setLot(booking.lot || lot); }}><span>{booking.lot} / ช่อง {slots.find((slot) => slot.slotCode === booking.slot)?.number || "-"} / รอบ {booking.startTime} / ถึง {booking.endDate}</span></button>)}</div>}
            {referenceRow && <p className="subtitle">กำลังเพิ่มช่องจากรายการอ้างอิง โดยวันเริ่มตั้งต้นเป็นวันถัดไป 07:00 และใช้วันสิ้นสุดเดิมเป็นค่าเริ่มต้น แก้ไขได้</p>}

            <label>ลาน</label>
            <select value={lot} onChange={(e) => { setLot(e.target.value); setSelectedSlots([]); }}>
              {lots.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>

            <label>เลือกช่อง (เลือกได้หลายช่อง)</label>
            <div className="slot-grid">
              {slotsInLot.map((s) => {
                const disabled = s.status === "ปิด" || s.isRoad;
                const active = selectedSlots.includes(s.slotCode);
                return (
                  <button
                    type="button"
                    key={s.slotCode}
                    className={`slot-btn ${disabled ? "closed" : "open"} ${active ? "active" : ""}`}
                    onClick={() => toggleSlot(s.slotCode, disabled)}
                    title={disabled ? `ปิดใช้งาน: ${s.reason || (s.isRoad ? "ถนน/ไม่เปิดใช้งาน" : "สถานะพื้นฐานปิดใช้งาน")}` : "ว่าง"}
                  >
                    ช่อง {s.number || "-"}
                  </button>
                );
              })}
            </div>
            {slotsInLot.length === 0 && <p className="subtitle">ยังไม่มีข้อมูลช่องจอดของลานนี้ใน Slot_Master</p>}

            <label>วันที่เริ่มจอง</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />

            <EndDateField startDate={startDate} value={endDate} onChange={setEndDate} />

            <OperationalTimePicker values={startTimes} onChange={setStartTimes} label="เลือกรอบเวลา (เลือกได้หลายรอบ, รอบละ 4 ชั่วโมง)" required multiple />
            <p className="subtitle">จะสร้าง {selectedSlots.length * startTimes.length} สิทธิ์ / ต้องใช้ตั๋ว {selectedSlots.length * startTimes.length} ใบต่อ operational day</p>
          </div>

          {result && (
            <div className={`alert ${result.ok ? "alert-success" : "alert-error"}`}>
              {result.ok ? result.message : `✗ ไม่สามารถบันทึกการจองได้: ${result.error}`}
            </div>
          )}

          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={submitting || selectedSlots.length === 0 || startTimes.length === 0}>
              {submitting ? "กำลังตรวจสอบและบันทึก..." : `บันทึกการจอง (${selectedSlots.length * startTimes.length} สิทธิ์)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
