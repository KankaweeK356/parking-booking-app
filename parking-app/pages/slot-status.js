import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const LOTS = ["A", "B", "C", "D"];

export default function SlotStatus() {
  const [slots, setSlots] = useState([]);
  const [lot, setLot] = useState("A");
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [warning, setWarning] = useState(null); // { bookings: [...] }
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  function loadSlots() {
    fetch("/api/slots").then((r) => r.json()).then(setSlots);
  }
  useEffect(loadSlots, []);

  const slotsInLot = useMemo(() => slots.filter((s) => s.lot === lot), [slots, lot]);

  async function selectSlot(s) {
    setSelected(s);
    setReason("");
    setMessage(null);
    setWarning(null);
    if (s.status === "เปิด") {
      // จะปิดช่อง — เช็คก่อนว่ามีคนจองอยู่ไหม
      setChecking(true);
      try {
        const res = await fetch(`/api/slot-status?slot=${encodeURIComponent(s.slotCode)}`);
        const data = await res.json();
        if (data.hasActiveBooking) setWarning(data);
      } finally {
        setChecking(false);
      }
    }
  }

  async function doAction(action) {
    if (action === "ปิด" && !reason) {
      setMessage({ type: "error", text: "กรุณากรอกเหตุผลก่อนปิดช่อง" });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/slot-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotCode: selected.slotCode, action, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาด");
      setMessage({ type: "success", text: `${action}ช่อง ${selected.slotCode} เรียบร้อยแล้ว` });
      setSelected(null);
      loadSlots();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>ปิด / เปิดช่องจอด</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>
      <div className="page">
        <div className="card">
          <label>ลาน</label>
          <select value={lot} onChange={(e) => { setLot(e.target.value); setSelected(null); }}>
            {LOTS.map((l) => (
              <option key={l} value={l}>ลาน {l}</option>
            ))}
          </select>

          <div className="slot-grid">
            {slotsInLot.map((s) => (
              <button
                type="button"
                key={s.slotCode}
                className={`slot-btn ${s.status === "ปิด" ? "closed" : "open"} ${selected?.slotCode === s.slotCode ? "active" : ""}`}
                onClick={() => selectSlot(s)}
              >
                {s.slotCode}
              </button>
            ))}
          </div>
          <p className="subtitle" style={{ marginTop: 10 }}>
            <span style={{ color: "var(--green)" }}>■</span> เปิดใช้งาน &nbsp;
            <span style={{ color: "var(--red)" }}>■</span> ปิดใช้งาน
          </p>
        </div>

        {selected && (
          <div className="card">
            <h2 style={{ fontSize: 16 }}>
              ช่อง {selected.slotCode} — ตอนนี้: {" "}
              <span className={`status-badge ${selected.status === "ปิด" ? "status-closed" : "status-open"}`}>
                {selected.status === "ปิด" ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </span>
            </h2>

            {checking && <p className="subtitle">กำลังตรวจสอบว่ามีคนจองอยู่ไหม...</p>}

            {warning && (
              <div className="alert alert-warning">
                ⚠️ ช่องนี้มีคนจองอยู่ ({warning.bookings.map((b) => b.customer).join(", ")}) — ปิดช่องนี้จะไม่กระทบ
                Required ของลูกค้าอัตโนมัติ กรุณาไปแก้ไข Booking ของลูกค้าคนนี้เองถ้าจำเป็น
              </div>
            )}

            {selected.status === "เปิด" ? (
              <>
                <label>เหตุผลที่ปิด</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น พื้นทรุด รอซ่อม"
                />
                <div className="btn-row">
                  <button className="btn btn-danger" disabled={submitting} onClick={() => doAction("ปิด")}>
                    {submitting ? "กำลังบันทึก..." : "ยืนยันปิดช่อง"}
                  </button>
                </div>
              </>
            ) : (
              <div className="btn-row">
                <button className="btn btn-primary" disabled={submitting} onClick={() => doAction("เปิด")}>
                  {submitting ? "กำลังบันทึก..." : "ยืนยันเปิดช่อง"}
                </button>
              </div>
            )}

            {message && (
              <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`} style={{ marginTop: 12 }}>
                {message.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
