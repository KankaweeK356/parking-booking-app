import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export default function CSOverview() {
  const [data, setData] = useState({ slots: [], assignments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch("/api/cs-overview")
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error);
        setData(res);
        const uniqueLots = Array.from(new Set(res.slots.map((s) => s.lot).filter(Boolean))).sort();
        if (uniqueLots.length > 0) {
          setSelectedLot(uniqueLots[0]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const lots = useMemo(() => {
    return Array.from(new Set(data.slots.map((s) => s.lot).filter(Boolean))).sort();
  }, [data.slots]);

  const assignmentMap = useMemo(() => {
    const map = {};
    (data.assignments || []).forEach((a) => {
      map[a.slot] = a;
    });
    return map;
  }, [data.assignments]);

  const slotsInLot = useMemo(() => {
    return data.slots.filter((s) => s.lot === selectedLot);
  }, [data.slots, selectedLot]);

  const stats = useMemo(() => {
    const total = slotsInLot.length;
    let closed = 0;
    let occupied = 0;
    slotsInLot.forEach((s) => {
      if (s.isClosed || s.isRoad) closed++;
      else if (assignmentMap[s.code]) occupied++;
    });
    const available = total - closed - occupied;
    return { total, closed, occupied, available };
  }, [slotsInLot, assignmentMap]);

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>ภาพรวมการจัดสรรพื้นที่จอดรถ (CS Overview)</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>

      <div className="page" style={{ maxWidth: 960 }}>
        <h2>ภาพรวมการจัดสรรช่องจอด (CS Overview)</h2>
        <p className="subtitle">
          ตรวจสอบการจัดสรรช่องจอดของลูกค้าที่ยังมีผล (รวมรายการที่จองล่วงหน้า) เพื่อประสานงานและตอบคำถามลูกค้า
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="card">
          <label>เลือกลาน:</label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
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

        {loading ? (
          <div className="card" style={{ textAlign: "center", padding: "40px" }}>
            <p className="subtitle" style={{ margin: 0 }}>กำลังโหลดข้อมูลการจัดสรรช่องจอด...</p>
          </div>
        ) : (
          <div className="card">
            <div className="summary-stat">
              <div className="stat-box">
                <div className="stat-label">ช่องจอดทั้งหมด (ลาน {selectedLot})</div>
                <div className="stat-value">{stats.total} ช่อง</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">มีผู้จองแล้ว</div>
                <div className="stat-value" style={{ color: "var(--navy)" }}>{stats.occupied} ช่อง</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">ช่องว่าง</div>
                <div className="stat-value" style={{ color: "var(--green)" }}>{stats.available} ช่อง</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">ปิดซ่อม/งดใช้</div>
                <div className="stat-value" style={{ color: "var(--red)" }}>{stats.closed} ช่อง</div>
              </div>
            </div>

            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: "90px" }}>รหัสช่อง</th>
                    <th style={{ width: "120px" }}>สถานะ</th>
                    <th>ลูกค้าผู้ได้รับสิทธิ์</th>
                    <th style={{ width: "110px" }}>รอบเวลา</th>
                    <th style={{ width: "200px" }}>ระยะเวลาจอง</th>
                  </tr>
                </thead>
                <tbody>
                  {slotsInLot.map((s) => {
                    const assign = assignmentMap[s.code];
                    if (s.isClosed || s.isRoad) {
                      return (
                        <tr key={s.code} style={{ background: "#fff5f5" }}>
                          <td style={{ fontWeight: 700, color: "var(--red)" }}>{s.code}</td>
                          <td><span className="status-badge status-closed">{s.isRoad ? "ถนน" : "ปิดซ่อม"}</span></td>
                          <td colSpan={3} style={{ color: "var(--gray)", fontSize: "13px" }}>
                            {s.closedReason ? `สาเหตุ: ${s.closedReason}` : (s.isRoad ? "ถนน / ไม่เปิดใช้งาน" : "ปิดใช้งานชั่วคราว")}
                          </td>
                        </tr>
                      );
                    }

                    if (assign) {
                      return (
                        <tr key={s.code}>
                          <td style={{ fontWeight: 700, color: "var(--navy)" }}>{s.code}</td>
                          <td><span className="status-badge status-open" style={{ background: "#fee2e2", color: "var(--navy)" }}>จองแล้ว</span></td>
                          <td>
                            <strong>คุณ{assign.customer}</strong>
                            {assign.docId && <span style={{ color: "var(--gray)", fontSize: "12px", marginLeft: 6 }}>({assign.docId})</span>}
                          </td>
                          <td>รอบ {assign.startTime || "-"} น.</td>
                          <td style={{ fontSize: "13px" }}>
                            {assign.startDate} ถึง {assign.endDate || "ไม่มีกำหนด"}
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={s.code}>
                        <td style={{ fontWeight: 700, color: "var(--green)" }}>{s.code}</td>
                        <td><span className="status-badge status-open">ว่าง</span></td>
                        <td colSpan={3} style={{ color: "var(--gray)", fontSize: "13px" }}>— พร้อมรับการจอง —</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
