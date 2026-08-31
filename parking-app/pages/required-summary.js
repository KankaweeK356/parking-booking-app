import { useEffect, useState } from "react";
import Link from "next/link";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function RequiredSummary() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [currentDate, setCurrentDate] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  // โหลดข้อมูลครั้งแรก
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/required-summary");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการโหลดข้อมูลจาก Google Sheet");
      setRows(data.rows || []);
      if (data.date) {
        setCurrentDate(data.date);
        setSelectedDate(data.date);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDateChange(newDate) {
    if (!newDate) return;
    setSelectedDate(newDate);
    setUpdating(true);
    setError("");
    try {
      const res = await fetch("/api/required-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการคำนวณวันที่ใหม่");
      setRows(data.rows || []);
      if (data.date) {
        setCurrentDate(data.date);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  }

  const totalTickets = rows.reduce((sum, r) => sum + (Number(r.required) || 0), 0);

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>สรุปจำนวนตั๋วที่ต้องตี</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>

      <div className="page">
        <h2>สรุปจำนวนตั๋วที่ต้องตีต่อวัน</h2>
        <p className="subtitle">
          ตรวจสอบรายชื่อลูกค้าที่มีการจองและจำนวนตั๋วที่ต้องเตรียมแจ้งด่าน (แสดงเฉพาะรายที่มียอดจองมากกว่า 0 ใบ)
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="card">
          <label>เลือกวันที่ต้องการตรวจสอบ (Google Sheet จะนำไปคำนวณผลลัพธ์ให้อัตโนมัติ):</label>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "6px" }}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              disabled={loading || updating}
              style={{ maxWidth: "240px" }}
            />
            {updating && <span style={{ fontSize: "14px", color: "var(--navy)" }}>⏳ กำลังส่งคำนวณข้อมูลใหม่...</span>}
          </div>
        </div>

        {loading ? (
          <div className="card" style={{ textAlign: "center", padding: "40px" }}>
            <p className="subtitle" style={{ margin: 0 }}>กำลังดึงข้อมูลสรุปจาก Google Sheet...</p>
          </div>
        ) : (
          <div className="card">
            <div className="summary-stat">
              <div className="stat-box">
                <div className="stat-label">วันที่ตรวจสอบ</div>
                <div className="stat-value" style={{ fontSize: "18px" }}>
                  {currentDate || selectedDate}
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-label">ลูกค้าที่มียอดจอง</div>
                <div className="stat-value">{rows.length} ราย</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">รวมตั๋วที่ต้องตีทั้งหมด</div>
                <div className="stat-value" style={{ color: "var(--navy)" }}>
                  {totalTickets} ใบ
                </div>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="alert alert-warning" style={{ marginTop: "16px", marginBottom: 0 }}>
                ไม่มีรายการที่ต้องตีตั๋วในวันที่เลือก (ไม่พบยอดการจองในระบบ)
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "60px", textAlign: "center" }}>#</th>
                      <th style={{ width: "120px" }}>รหัสลูกค้า</th>
                      <th>ชื่อลูกค้า</th>
                      <th style={{ width: "140px", textAlign: "center" }}>จำนวนตั๋ว (ใบ)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={row.docId || index}>
                        <td style={{ textAlign: "center", color: "var(--gray)" }}>{index + 1}</td>
                        <td style={{ fontWeight: 600 }}>{row.docId || "-"}</td>
                        <td>{row.customer}</td>
                        <td style={{ textAlign: "center" }}>
                          <span className="ticket-badge">{row.required}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
