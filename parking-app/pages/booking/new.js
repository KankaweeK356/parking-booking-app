import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const LOTS = ["A", "B", "C", "D"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewBooking() {
  const [customers, setCustomers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [customer, setCustomer] = useState("");
  const [lot, setLot] = useState("A");
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("07:00");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null); // [{slot, ok, error}]
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/master").then((r) => r.json()),
      fetch("/api/slots").then((r) => r.json()),
    ])
      .then(([m, s]) => {
        if (m.error || s.error) throw new Error(m.error || s.error);
        setCustomers(m);
        setSlots(s);
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
    setResults(null);
    const outcomes = [];
    for (const slot of selectedSlots) {
      try {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer, lot, slot, startDate, endDate, startTime }),
        });
        const data = await res.json();
        outcomes.push({ slot, ok: res.ok, error: data.error });
      } catch (err) {
        outcomes.push({ slot, ok: false, error: err.message });
      }
    }
    setResults(outcomes);
    setSubmitting(false);
    if (outcomes.every((o) => o.ok)) {
      setSelectedSlots([]);
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
                <option key={c.docId} value={c.name}>{c.name}</option>
              ))}
            </select>

            <label>ลาน</label>
            <select value={lot} onChange={(e) => { setLot(e.target.value); setSelectedSlots([]); }}>
              {LOTS.map((l) => (
                <option key={l} value={l}>ลาน {l}</option>
              ))}
            </select>

            <label>เลือกช่อง (เลือกได้หลายช่อง)</label>
            <div className="slot-grid">
              {slotsInLot.map((s) => {
                const disabled = s.status === "ปิด";
                const active = selectedSlots.includes(s.slotCode);
                return (
                  <button
                    type="button"
                    key={s.slotCode}
                    className={`slot-btn ${disabled ? "closed" : "open"} ${active ? "active" : ""}`}
                    onClick={() => toggleSlot(s.slotCode, disabled)}
                    title={disabled ? `ปิดใช้งาน: ${s.reason || "ไม่ระบุเหตุผล"}` : "ว่าง"}
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

          {results && (
            <div className="card">
              {results.map((r) => (
                <div key={r.slot} className={`alert ${r.ok ? "alert-success" : "alert-error"}`}>
                  {r.ok ? `✓ ช่อง ${r.slot} จองสำเร็จ` : `✗ ช่อง ${r.slot}: ${r.error}`}
                </div>
              ))}
            </div>
          )}

          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={submitting || selectedSlots.length === 0}>
              {submitting ? "กำลังบันทึก..." : `บันทึกการจอง (${selectedSlots.length} ช่อง)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
