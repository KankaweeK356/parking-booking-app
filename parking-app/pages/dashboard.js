import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");

  useEffect(() => {
    loadDashboard(today());
  }, []);

  async function loadDashboard(date) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/dashboard?date=${encodeURIComponent(date)}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "โหลดข้อมูล Dashboard ไม่สำเร็จ");
      setData(result);
      const uniqueLots = Array.from(new Set((result.slots || []).map((s) => s.lot).filter(Boolean))).sort();
      if (uniqueLots.length > 0 && !selectedLot) {
        setSelectedLot(uniqueLots[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDateChange(newDate) {
    if (!newDate) return;
    setSelectedDate(newDate);
    loadDashboard(newDate);
  }

  const lots = useMemo(() => {
    return Array.from(new Set((data.slots || []).map((s) => s.lot).filter(Boolean))).sort();
  }, [data.slots]);

  const paidBookingMap = useMemo(() => {
    const map = {};
    (data.bookings || []).forEach((b) => {
      map[b.slot] = b;
    });
    return map;
  }, [data.bookings]);

  const unpaidBookingMap = useMemo(() => {
    const map = {};
    (data.unpaidBookings || []).forEach((b) => {
      map[b.slot] = b;
    });
    return map;
  }, [data.unpaidBookings]);

  const slotsInLot = useMemo(() => {
    return (data.slots || []).filter((s) => s.lot === selectedLot);
  }, [data.slots, selectedLot]);

  // ห้ามแสดง unpaid booking เป็น occupied: นับเฉพาะ paid เท่านั้นที่ถือว่า occupied
  // ช่องที่เหลือ (รวม unpaid) ถือเป็น vacant (ว่าง) ทั้งหมดเพื่อให้ทีมสนามตรวจแอบจอด
  const stats = useMemo(() => {
    const total = slotsInLot.length;
    let closed = 0;
    let paid = 0;
    slotsInLot.forEach((s) => {
      if (s.isClosed || s.isRoad) closed++;
      else if (paidBookingMap[s.code]) paid++;
    });
    const vacant = total - closed - paid;
    return { total, closed, paid, vacant };
  }, [slotsInLot, paidBookingMap]);

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>ตารางสถานะลานจอด (Dashboard)</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>

      <div className="page" style={{ maxWidth: 960 }}>
        <h2>ตารางสถานะช่องจอดประจำวัน (Dashboard)</h2>
        <p className="subtitle">
          ตรวจสอบสถานะช่องจอดตามหลักฐานการชำระเงินล่วงหน้า (ตรวจ Transection วันก่อนหน้า 1 วัน)
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="card">
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label>เลือกวันที่ตรวจ:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                style={{ width: 180 }}
              />
            </div>
            <div>
              <label>เลือกลาน:</label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {lots.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={`btn ${selectedLot === l ? "btn-primary" : "btn-secondary"}`}
                    style={{ padding: "8px 18px", fontSize: "14px" }}
                    onClick={() => setSelectedLot(l)}
                  >
                    ลาน {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {data.dayBefore && (
            <p className="subtitle" style={{ margin: "10px 0 0", fontSize: "13px" }}>
              💳 วันที่ตรวจหลักฐานชำระเงิน (วันก่อนหน้า): <strong>{data.dayBefore}</strong>
            </p>
          )}
        </div>

        {loading ? (
          <div className="card" style={{ textAlign: "center", padding: "40px" }}>
            <p className="subtitle" style={{ margin: 0 }}>กำลังประมวลผลข้อมูล Dashboard...</p>
          </div>
        ) : (
          <div className="card">
            <div className="summary-stat">
              <div className="stat-box">
                <div className="stat-label">ช่องทั้งหมด (ลาน {selectedLot})</div>
                <div className="stat-value">{stats.total} ช่อง</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">จองแล้ว (ชำระเงินแล้ว)</div>
                <div className="stat-value" style={{ color: "var(--red)" }}>{stats.paid} ช่อง</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">ว่าง (ตรวจแอบจอด)</div>
                <div className="stat-value" style={{ color: "var(--green)" }}>{stats.vacant} ช่อง</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">ปิดซ่อม / ถนน</div>
                <div className="stat-value" style={{ color: "var(--gray)" }}>{stats.closed} ช่อง</div>
              </div>
            </div>

            <div style={{ margin: "18px 0" }}>
              <p className="subtitle" style={{ margin: "0 0 10px", fontSize: "13px" }}>
                <span style={{ color: "var(--red)" }}>■</span> จองแล้ว (ชำระเงินแล้ว) &nbsp;&nbsp;
                <span style={{ color: "var(--green)" }}>■</span> ว่าง (ไม่มีจอง หรือยังไม่ชำระเงิน — พร้อมตรวจแอบจอด) &nbsp;&nbsp;
                <span style={{ color: "var(--gray)" }}>■</span> ปิดซ่อม / ถนน
              </p>

              <div className="slot-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" }}>
                {slotsInLot.map((s) => {
                  const isClosed = s.isClosed || s.isRoad;
                  const paid = paidBookingMap[s.code];
                  const unpaid = unpaidBookingMap[s.code];

                  let statusClass = "open";
                  let label = "ว่าง";
                  let bg = "#e9f5ee";
                  let border = "#b8e0c8";
                  let color = "var(--green)";

                  if (isClosed) {
                    statusClass = "closed";
                    label = s.isRoad ? "ถนน" : "ปิดซ่อม";
                    bg = "#f3f4f6";
                    border = "#d1d5db";
                    color = "var(--gray)";
                  } else if (paid) {
                    statusClass = "closed";
                    label = "จองแล้ว";
                    bg = "#fee2e2";
                    border = "#fca5a5";
                    color = "var(--red)";
                  } else {
                    // Unpaid booking หรือไม่มี booking เลย => แสดงเป็น "ว่าง" (เขียว) ห้ามแสดงเป็น occupied
                    statusClass = "open";
                    label = "ว่าง";
                    bg = "#e9f5ee";
                    border = "#b8e0c8";
                    color = "var(--green)";
                  }

                  let tooltip = "ว่าง (พร้อมให้จอด/ตรวจแอบจอด)";
                  if (isClosed) {
                    tooltip = s.isRoad ? "ถนน / ไม่เปิดใช้งาน" : `ปิดซ่อม: ${s.closedReason || "ไม่ระบุสาเหตุ"}`;
                  } else if (paid) {
                    tooltip = `จองแล้ว: คุณ${paid.customer} (รอบ ${paid.startTime}-${paid.endTime} น.)`;
                  } else if (unpaid) {
                    tooltip = `ว่าง (มีจองของคุณ${unpaid.customer} แต่ยังไม่พบหลักฐานชำระเงิน จึงถือเป็นช่องว่าง)`;
                  }

                  return (
                    <div
                      key={s.code}
                      className={`slot-btn ${statusClass}`}
                      style={{
                        padding: "10px 6px",
                        cursor: "default",
                        background: bg,
                        borderColor: border,
                        color: color,
                      }}
                      title={tooltip}
                    >
                      <div style={{ fontWeight: 700, fontSize: "14px" }}>{s.code}</div>
                      <div style={{ fontSize: "11px", marginTop: "2px" }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ตารางแสดงรายการจองที่ชำระเงินแล้ว (มีสิทธิ์เข้าจอด) */}
            <div className="table-container" style={{ marginTop: "24px" }}>
              <h2 style={{ fontSize: 16 }}>รายการจองที่ชำระเงินแล้ว (มีสิทธิ์เข้าจอด วันที่ {selectedDate})</h2>
              {data.bookings && data.bookings.length === 0 ? (
                <p className="subtitle" style={{ margin: "8px 0" }}>ไม่มีรายการที่ชำระเงินแล้วในวันนี้</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "80px" }}>ช่อง</th>
                      <th>ลูกค้า</th>
                      <th style={{ width: "120px" }}>รอบเวลา</th>
                      <th style={{ width: "160px" }}>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.bookings || []).map((b, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 700, color: "var(--red)" }}>{b.slot}</td>
                        <td>
                          <strong>คุณ{b.customer}</strong>
                          {b.docId && <span style={{ color: "var(--gray)", fontSize: "12px", marginLeft: 6 }}>({b.docId})</span>}
                        </td>
                        <td>{b.startTime || "-"} น. (4 ชม.)</td>
                        <td>
                          <span className="status-badge" style={{ background: "#fee2e2", color: "var(--red)" }}>
                            🔴 จองแล้ว (ชำระเงินแล้ว)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ตารางรายการที่ยังไม่ชำระเงิน (ไม่นับเป็น occupied ถือเป็นช่องว่าง) */}
            {data.unpaidBookings && data.unpaidBookings.length > 0 && (
              <div className="table-container" style={{ marginTop: "24px" }}>
                <h2 style={{ fontSize: 16, color: "var(--gray)" }}>
                  รายการที่ยังไม่พบหลักฐานชำระเงิน (ไม่มีสิทธิ์เข้าจอด — ถือเป็นช่องว่างสำหรับตรวจแอบจอด)
                </h2>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "80px" }}>ช่อง</th>
                      <th>ลูกค้า</th>
                      <th style={{ width: "120px" }}>รอบเวลา</th>
                      <th style={{ width: "160px" }}>สถานะหน้างาน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.unpaidBookings.map((b, i) => (
                      <tr key={i} style={{ opacity: 0.85 }}>
                        <td style={{ fontWeight: 700 }}>{b.slot}</td>
                        <td>
                          คุณ{b.customer}
                          {b.docId && <span style={{ color: "var(--gray)", fontSize: "12px", marginLeft: 6 }}>({b.docId})</span>}
                        </td>
                        <td>{b.startTime || "-"} น.</td>
                        <td>
                          <span className="status-badge" style={{ background: "#e9f5ee", color: "var(--green)" }}>
                            🟢 ถือเป็นช่องว่าง (ยังไม่จ่าย)
                          </span>
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
