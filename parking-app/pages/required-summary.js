import { useEffect, useState } from "react";
import Link from "next/link";
import { displayCustomerName } from "../lib/display";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function RequiredSummary() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [targetDate, setTargetDate] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData(today());
  }, []);

  async function loadData(date) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/required-summary?date=${encodeURIComponent(date)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการคำนวณข้อมูลสรุปตั๋ว");
      setRows(data.rows || []);
      setTargetDate(data.targetDate || "");
      setSelectedDate(data.selectedDate || date);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDateChange(newDate) {
    if (!newDate) return;
    setSelectedDate(newDate);
    loadData(newDate);
  }

  const totalTickets = rows.reduce((sum, r) => sum + (Number(r.required) || 0), 0);

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>สรุปรายการตีตั๋ว</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>

      <div className="page">
        <h2>รายการจองระยะยาว</h2>
        <p className="subtitle">
          เลือกวันที่ทำรายการ เพื่อดูยอดตั๋วสำหรับใช้สิทธิ์ในวันปฏิบัติการถัดไป
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="card">
          <label>วันที่ทำรายการ</label>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "6px" }}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              disabled={loading}
              style={{ maxWidth: "240px" }}
            />
            {loading && <span style={{ fontSize: "14px", color: "var(--navy)" }}>⏳ กำลังประมวลผล...</span>}
          </div>
          {targetDate && (
            <p className="subtitle" style={{ margin: "10px 0 0", color: "var(--navy)" }}>
              📅 สำหรับใช้สิทธิ์วันที่: <strong>{targetDate}</strong>
            </p>
          )}
        </div>

        {loading ? (
          <div className="card" style={{ textAlign: "center", padding: "40px" }}>
            <p className="subtitle" style={{ margin: 0 }}>กำลังคำนวณข้อมูลสรุป...</p>
          </div>
        ) : (
          <div className="card">
            <div className="summary-stat">
              <div className="stat-box">
                <div className="stat-label">วันที่ใช้สิทธิ์</div>
                <div className="stat-value" style={{ fontSize: "18px" }}>
                  {targetDate || "-"}
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-label">ลูกค้าที่มีรายการจอง</div>
                <div className="stat-value">{rows.length} ราย</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">รวมตั๋วที่ต้องเตรียม</div>
                <div className="stat-value" style={{ color: "var(--navy)" }}>
                  {totalTickets} ใบ
                </div>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="alert alert-warning" style={{ marginTop: "16px", marginBottom: 0 }}>
                ไม่มีรายการที่ต้องตีตั๋วในวันที่ใช้งานนี้ ({targetDate})
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
                        <td>{displayCustomerName(row.name || row.customer)}</td>
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
        {!loading && <div className="btn-row"><button type="button" className="btn btn-secondary" onClick={() => window.print()}>พิมพ์รายการ</button><button type="button" className="btn btn-secondary" onClick={() => loadData(selectedDate)}>↻ อัปเดตรายการ</button></div>}
      </div>
    </div>
  );
}
