import { useEffect, useState } from "react";
import Link from "next/link";

const REASONS = ["เพิ่มจำนวนช่อง-ช่วงเวลา", "ลดจำนวนช่อง-ช่วงเวลา", "เปลี่ยนช่อง", "ช่องถูกปิดใช้งาน"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function EditBooking() {
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState("");
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState(REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetch("/api/master").then((r) => r.json()).then(setCustomers);
  }, []);

  useEffect(() => {
    if (!customer) {
      setBookings([]);
      return;
    }
    setLoadingBookings(true);
    setSelectedRow(null);
    fetch(`/api/bookings?customer=${encodeURIComponent(customer)}`)
      .then((r) => r.json())
      .then((data) => setBookings(Array.isArray(data) ? data : []))
      .finally(() => setLoadingBookings(false));
  }, [customer]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedRow) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/bookings/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNumber: selectedRow.rowNumber, endDate, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาด");
      setMessage({ type: "success", text: `ปิดรายการช่อง ${selectedRow.slot} เรียบร้อยแล้ว` });
      setBookings((prev) => prev.filter((b) => b.rowNumber !== selectedRow.rowNumber));
      setSelectedRow(null);
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
          <h1>แก้ไข / ยกเลิกการจอง</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>
      <div className="page">
        <div className="card">
          <label>เลือกลูกค้า</label>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">— เลือกลูกค้า —</option>
            {customers.map((c) => (
              <option key={c.docId} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        {customer && (
          <div className="card">
            <h2 style={{ fontSize: 16 }}>รายการที่กำลังจองอยู่</h2>
            {loadingBookings && <p className="subtitle">กำลังโหลด...</p>}
            {!loadingBookings && bookings.length === 0 && (
              <p className="subtitle">ลูกค้าคนนี้ไม่มีรายการจองที่ Active อยู่ตอนนี้</p>
            )}
            {bookings.map((b) => (
              <div
                key={b.rowNumber}
                className={`booking-row ${selectedRow?.rowNumber === b.rowNumber ? "selected" : ""}`}
                onClick={() => setSelectedRow(b)}
              >
                <div>
                  <div className="slot-code">ลาน {b.lot} / ช่อง {b.slot}</div>
                  <div className="meta">
                    {b.startDate} ถึง {b.endDate || "ไม่มีกำหนด"} • เริ่ม {b.startTime}
                  </div>
                </div>
                <input type="radio" checked={selectedRow?.rowNumber === b.rowNumber} readOnly />
              </div>
            ))}
          </div>
        )}

        {selectedRow && (
          <form onSubmit={handleSubmit} className="card">
            <p className="subtitle">กำลังปิด: ลาน {selectedRow.lot} / ช่อง {selectedRow.slot}</p>
            <label>วันที่สิ้นสุด (วันสุดท้ายที่ยังมีสิทธิ์)</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />

            <label>เหตุผล</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>

            {message && (
              <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`}>
                {message.text}
              </div>
            )}

            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "กำลังบันทึก..." : "ยืนยันปิดรายการนี้"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
