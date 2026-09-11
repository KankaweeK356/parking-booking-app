import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewBooking() {
  const [customers, setCustomers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [lots, setLots] = useState([]);
  const [customer, setCustomer] = useState("");
  const [lot, setLot] = useState("");
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("07:00");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { ok, error, message }
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
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
  }, []);

  const slotsInLot = useMemo(() => slots.filter((s) => s.lot === lot), [slots, lot]);

  function toggleSlot(slotCode, disabled) {
    if (disabled) return;
    setSelectedSlots((prev) =>
      prev.includes(slotCode) ? prev.filter((s) => s !== slotCode) : [...prev, slotCode]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!customer || selectedSlots.length === 0 || !startDate || !startTime) return;
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
          startTime,
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
          message: `✓ บันทึกการจองสำเร็จเรียบร้อยแล้ว ทั้งหมด ${selectedSlots.length} ช่อง (${selectedSlots.join(", ")})`,
        });
        setSelectedSlots([]);
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
            <label>ลูกค้า</label>
            <select value={customer} onChange={(e) => setCustomer(e.target.value)} required>
              <option value="">— เลือกลูกค้า —</option>
              {customers.map((c) => (
                <option key={c.docId || c.name} value={c.name}>{c.name}</option>
              ))}
            </select>

            <label>ลาน</label>
            <select value={lot} onChange={(e) => { setLot(e.target.value); setSelectedSlots([]); }}>
              {lots.map((l) => (
                <option key={l} value={l}>ลาน {l}</option>
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
                    {s.slotCode}
                  </button>
                );
              })}
            </div>
            {slotsInLot.length === 0 && <p className="subtitle">ยังไม่มีข้อมูลช่องจอดของลานนี้ใน Slot_Master</p>}

            <label>วันที่เริ่มจอง</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />

            <label>วันที่สิ้นสุด (เว้นว่าง = ยังไม่มีกำหนด)</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />

            <label>เวลาเริ่ม (ใช้ต่อเนื่อง 4 ชั่วโมงเสมอ)</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </div>

          {result && (
            <div className={`alert ${result.ok ? "alert-success" : "alert-error"}`}>
              {result.ok ? result.message : `✗ ไม่สามารถบันทึกการจองได้: ${result.error}`}
            </div>
          )}

          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={submitting || selectedSlots.length === 0}>
              {submitting ? "กำลังตรวจสอบและบันทึก..." : `บันทึกการจอง (${selectedSlots.length} ช่อง)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
