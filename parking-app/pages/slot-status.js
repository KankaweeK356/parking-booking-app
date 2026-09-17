import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { displayLotName, displayCustomerName } from "../lib/display";

export default function SlotStatus() {
  const [slots, setSlots] = useState([]);
  const [lots, setLots] = useState([]);
  const [lot, setLot] = useState("");
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [warning, setWarning] = useState(null); // { hasActiveBooking: true, bookings: [...] }
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  function loadSlots() {
    fetch("/api/slots")
      .then((r) => r.json())
      .then((data) => {
        const slotList = Array.isArray(data) ? data : (data.slots || []);
        const lotList = data.lots || Array.from(new Set(slotList.map((item) => item.lot).filter(Boolean))).sort();
        setSlots(slotList);
        setLots(lotList);
        if (!lot && lotList.length > 0) setLot(lotList[0]);
      });
  }
  useEffect(loadSlots, []);

  const slotsInLot = useMemo(() => slots.filter((s) => s.lot === lot), [slots, lot]);

  async function selectSlot(s) {
    setSelected(s);
    setReason("");
    setMessage(null);
    setWarning(null);

    if (s.status === "เปิด") {
      setChecking(true);
      try {
        const res = await fetch(`/api/slot-status?slot=${encodeURIComponent(s.slotCode)}`);
        const data = await res.json();
        if (data.hasActiveBooking && data.bookings?.length > 0) {
          setWarning(data);
        }
      } catch (err) {
        console.error("Error checking active bookings for slot:", err);
      } finally {
        setChecking(false);
      }
    }
  }

  async function doAction(action) {
    if (action === "ปิด" && !reason) {
      setMessage({ type: "error", text: "กรุณาระบุสาเหตุที่ต้องการปิดช่องจอดก่อนกดบันทึก" });
      return;
    }
    setSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch("/api/slot-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotCode: selected.slotCode,
          action,
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการบันทึกสถานะช่อง");

      if (action === "ปิด") {
          setMessage({ type: "success", text: `✓ ปิดช่อง ${selected.number || ""} เรียบร้อยแล้ว` });
      } else {
        setMessage({ type: "success", text: `✓ เปิดใช้งานช่อง ${selected.slotCode} เรียบร้อยแล้ว` });
      }

      setSelected(null);
      setWarning(null);
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
        <h2>จัดการสถานะช่องจอด</h2>
        <p className="subtitle">ปิดหรือเปิดช่องจอดที่ชำรุด โดยต้องจัดการรายการจองที่กระทบให้เสร็จก่อนปิดช่อง</p>

        <div className="card">
          <label>1. เลือกลานที่ต้องการจัดการ</label>
          <select value={lot} onChange={(e) => { setLot(e.target.value); setSelected(null); }}>
            {lots.map((l) => (
              <option key={l} value={l}>{displayLotName(l)}</option>
            ))}
          </select>

          <label style={{ marginTop: "16px" }}>2. เลือกช่องจอดเพื่อดูสถานะหรือปรับปรุง</label>
          <div className="slot-grid">
            {slotsInLot.map((s) => (
              <button
                type="button"
                key={s.slotCode}
                className={`slot-btn ${s.status === "ปิด" || s.isRoad ? "closed" : "open"} ${selected?.slotCode === s.slotCode ? "active" : ""}`}
                onClick={() => selectSlot(s)}
                title={s.status === "ปิด" || s.isRoad ? `ปิดใช้งาน: ${s.reason || (s.isRoad ? "ถนน/ไม่เปิดใช้งาน" : "สถานะพื้นฐานปิดใช้งาน")}` : "เปิดใช้งานปกติ"}
              >
                ช่อง {s.number || "-"}
              </button>
            ))}
          </div>
          <p className="subtitle" style={{ marginTop: 12 }}>
            <span style={{ color: "var(--green)" }}>■</span> เปิดใช้งานปกติ &nbsp;&nbsp;
            <span style={{ color: "var(--red)" }}>■</span> ปิดใช้งานชั่วคราว / ถนน
          </p>
        </div>

        {selected && (
          <div className="card">
            <h2 style={{ fontSize: 16 }}>
              ช่อง {selected.number || "-"} — สถานะปัจจุบัน: {" "}
              <span className={`status-badge ${selected.status === "ปิด" || selected.isRoad ? "status-closed" : "status-open"}`}>
                {selected.status === "ปิด" || selected.isRoad ? (selected.isRoad ? "ถนน / ปิดใช้งาน" : "ปิดใช้งานชั่วคราว") : "เปิดใช้งานปกติ"}
              </span>
            </h2>

            {checking && <p className="subtitle">กำลังตรวจสอบรายการจองในช่องนี้...</p>}

            {warning && warning.bookings && (
              <div className="alert alert-warning" style={{ marginTop: "14px" }}>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>
                  ⚠️ ช่องนี้มีรายการจองที่ได้รับผลกระทบ ({warning.bookings.map((b) => displayCustomerName(b.customer)).join(", ")})
                </div>
                <div style={{ fontSize: "13px", marginBottom: "10px" }}>
                  กรุณาไปที่เมนู “ปรับ / ยกเลิก / ย้ายช่อง” เพื่อย้ายช่อง พักการจอง หรือยกเลิกรายการเหล่านี้ก่อน แล้วจึงกลับมาปิดช่อง:
                </div>
                <div style={{ background: "white", padding: "8px 12px", borderRadius: "6px", border: "1px solid #f0d2a8" }}>
                  {warning.bookings.map((b) => {
                    return (
                      <label
                        key={b.rowNumber}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          margin: "6px 0",
                        cursor: "default",
                          fontWeight: "normal",
                        }}
                      >
                        <span>
                          <strong>{displayCustomerName(b.customer)}</strong> (รอบ {b.startTime || "-"} น. | {b.startDate} ถึง {b.endDate || "-"})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {selected.status === "เปิด" ? (
              <>
                <label>ระบุสาเหตุที่ปิดช่อง (จำเป็น):</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น พื้นทรุด, ทาสีเส้นใหม่, ชำรุดรอซ่อม"
                />
                <div className="btn-row">
                  <button className="btn btn-danger" disabled={submitting || Boolean(warning?.bookings?.length)} onClick={() => doAction("ปิด")}>
                    {submitting ? "กำลังบันทึกข้อมูล..." : `ยืนยันปิดช่อง ${selected.number || ""}`}
                  </button>
                </div>
              </>
            ) : (
              <>
                {selected.reason && (
                  <p className="subtitle" style={{ margin: "6px 0 16px" }}>
                    สาเหตุที่ปิดอยู่เดิม: <strong>{selected.reason}</strong>
                  </p>
                )}
                <div className="btn-row">
                  <button className="btn btn-primary" disabled={submitting} onClick={() => doAction("เปิด")}>
                    {submitting ? "กำลังบันทึกข้อมูล..." : `ยืนยันเปิดใช้งานช่อง ${selected.slotCode}`}
                  </button>
                </div>
              </>
            )}

            {message && (
              <div className={`alert ${message.type === "success" ? "alert-success" : message.type === "warning" ? "alert-warning" : "alert-error"}`} style={{ marginTop: 12 }}>
                {message.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
