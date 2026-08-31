import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const LOTS = ["A", "B", "C", "D"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function SlotStatus() {
  const [slots, setSlots] = useState([]);
  const [lot, setLot] = useState("A");
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [warning, setWarning] = useState(null); // { hasActiveBooking: true, bookings: [...] }
  const [selectedBookingRowsToClose, setSelectedBookingRowsToClose] = useState([]); // [rowNumber, ...]
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
    setSelectedBookingRowsToClose([]);

    if (s.status === "เปิด") {
      // กำลังจะปิดช่อง — เช็คก่อนว่ามีคนจองอยู่ไหม
      setChecking(true);
      try {
        const res = await fetch(`/api/slot-status?slot=${encodeURIComponent(s.slotCode)}`);
        const data = await res.json();
        if (data.hasActiveBooking && data.bookings?.length > 0) {
          setWarning(data);
          // ค่าเริ่มต้น: ติ๊กเลือกปิดการจองทั้งหมดที่ค้างอยู่ในช่องนี้โดยอัตโนมัติ
          setSelectedBookingRowsToClose(data.bookings.map((b) => b.rowNumber));
        }
      } catch (err) {
        console.error("Error checking active bookings for slot:", err);
      } finally {
        setChecking(false);
      }
    }
  }

  function toggleBookingRow(rowNumber) {
    setSelectedBookingRowsToClose((prev) =>
      prev.includes(rowNumber) ? prev.filter((id) => id !== rowNumber) : [...prev, rowNumber]
    );
  }

  async function doAction(action) {
    if (action === "ปิด" && !reason) {
      setMessage({ type: "error", text: "กรุณาระบุสาเหตุที่ต้องการปิดช่องจอดก่อนกดบันทึก" });
      return;
    }
    setSubmitting(true);
    setMessage(null);

    try {
      // ขั้นที่ 1: บันทึกสถานะปิด/เปิดช่องใน Slot_Status_Log
      const res = await fetch("/api/slot-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotCode: selected.slotCode, action, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการบันทึกสถานะช่อง");

      // ขั้นที่ 2: หากเป็นกรณีปิดช่อง และมีติ๊กเลือกปิด Booking ที่ค้างอยู่
      if (action === "ปิด" && selectedBookingRowsToClose.length > 0 && warning?.bookings) {
        const outcomes = [];
        for (const rowNum of selectedBookingRowsToClose) {
          const bookingObj = warning.bookings.find((b) => b.rowNumber === rowNum);
          const custName = bookingObj ? `คุณ${bookingObj.customer} (รอบ ${bookingObj.startTime || "-"} น.)` : `รายการที่ ${rowNum}`;
          try {
            const closeRes = await fetch("/api/bookings/close", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                rowNumber: rowNum,
                endDate: today(),
                reason: "ช่องถูกปิดใช้งาน",
              }),
            });
            const closeData = await closeRes.json();
            if (!closeRes.ok) throw new Error(closeData.error || "ล้มเหลว");
            outcomes.push({ rowNum, custName, ok: true });
          } catch (err) {
            outcomes.push({ rowNum, custName, ok: false, error: err.message });
          }
        }

        const failedList = outcomes.filter((o) => !o.ok);
        const successList = outcomes.filter((o) => o.ok);

        if (failedList.length > 0) {
          setMessage({
            type: "warning",
            text: `⚠️ ปิดช่อง ${selected.slotCode} สำเร็จแล้ว แต่ระบบไม่สามารถยกเลิกการจองบางรายการได้:\n• ${failedList.map((f) => `${f.custName} (สาเหตุ: ${f.error})`).join("\n• ")}\n➔ คำแนะนำ: กรุณาไปที่หน้า "ปรับ / ยกเลิกการจอง" เพื่อตรวจสอบและปิดรายการของลูกค้าที่ค้างอยู่ด้วยตนเอง`,
          });
        } else {
          setMessage({
            type: "success",
            text: `✓ ปิดช่อง ${selected.slotCode} เรียบร้อยแล้ว (และยกเลิกรายการจองของ ${successList.map((s) => s.custName).join(", ")} ให้เรียบร้อย)`,
          });
        }
      } else {
        setMessage({ type: "success", text: `✓ ${action === "เปิด" ? "เปิดใช้งาน" : "ปิด"}ช่อง ${selected.slotCode} เรียบร้อยแล้ว` });
      }

      setSelected(null);
      setWarning(null);
      setSelectedBookingRowsToClose([]);
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
        <h2>ปิด / เปิดช่องจอด</h2>
        <p className="subtitle">จัดการสถานะช่องจอดที่ชำรุดหรือเปิดใช้งาน พร้อมระบบช่วยยกเลิกรายการจองที่ค้างอยู่อัตโนมัติ</p>

        <div className="card">
          <label>1. เลือกลานที่ต้องการจัดการ</label>
          <select value={lot} onChange={(e) => { setLot(e.target.value); setSelected(null); }}>
            {LOTS.map((l) => (
              <option key={l} value={l}>ลาน {l}</option>
            ))}
          </select>

          <label style={{ marginTop: "16px" }}>2. เลือกช่องจอดเพื่อดูสถานะหรือปรับปรุง</label>
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
          <p className="subtitle" style={{ marginTop: 12 }}>
            <span style={{ color: "var(--green)" }}>■</span> เปิดใช้งานปกติ &nbsp;&nbsp;
            <span style={{ color: "var(--red)" }}>■</span> ปิดใช้งานชั่วคราว
          </p>
        </div>

        {selected && (
          <div className="card">
            <h2 style={{ fontSize: 16 }}>
              ช่อง {selected.slotCode} — สถานะปัจจุบัน: {" "}
              <span className={`status-badge ${selected.status === "ปิด" ? "status-closed" : "status-open"}`}>
                {selected.status === "ปิด" ? "ปิดใช้งานชั่วคราว" : "เปิดใช้งานปกติ"}
              </span>
            </h2>

            {checking && <p className="subtitle">กำลังตรวจสอบรายการจองในช่องนี้...</p>}

            {warning && warning.bookings && (
              <div className="alert alert-warning" style={{ marginTop: "14px" }}>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>
                  ⚠️ ช่องนี้มีรายการจองค้างอยู่ ({warning.bookings.map((b) => b.customer).join(", ")})
                </div>
                <div style={{ fontSize: "13px", marginBottom: "10px" }}>
                  เลือกรายการจองที่ต้องการยกเลิกพร้อมการปิดช่อง (วันสิ้นสุด = วันนี้ / บันทึกเหตุผล &quot;ช่องถูกปิดใช้งาน&quot; ให้อัตโนมัติ):
                </div>
                <div style={{ background: "white", padding: "8px 12px", borderRadius: "6px", border: "1px solid #f0d2a8" }}>
                  {warning.bookings.map((b) => {
                    const isChecked = selectedBookingRowsToClose.includes(b.rowNumber);
                    return (
                      <label
                        key={b.rowNumber}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          margin: "6px 0",
                          cursor: "pointer",
                          fontWeight: "normal",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleBookingRow(b.rowNumber)}
                          style={{ width: "16px", height: "16px", cursor: "pointer" }}
                        />
                        <span>
                          ยกเลิกการจองของ <strong>คุณ{b.customer}</strong> (รอบ {b.startTime || "-"} น. | สิทธิ์เดิม: {b.startDate} ถึง {b.endDate || "ไม่มีกำหนด"})
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
                  <button className="btn btn-danger" disabled={submitting} onClick={() => doAction("ปิด")}>
                    {submitting ? "กำลังบันทึกข้อมูล..." : `ยืนยันปิดช่อง ${selected.slotCode}`}
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
              <div
                className={`alert ${
                  message.type === "success"
                    ? "alert-success"
                    : message.type === "warning"
                    ? "alert-warning"
                    : "alert-error"
                }`}
                style={{ marginTop: 14, whiteSpace: "pre-line", lineHeight: "1.5" }}
              >
                {message.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
