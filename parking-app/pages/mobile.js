import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function MobileView() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [filterType, setFilterType] = useState("all"); // 'all', 'paid', 'vacant'

  useEffect(() => {
    loadData(today());
  }, []);

  async function loadData(date) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/dashboard?date=${encodeURIComponent(date)}`);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "โหลดข้อมูลไม่สำเร็จ");
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

  // ห้ามแสดง unpaid booking เป็น occupied: ช่องที่ยังไม่จ่ายถือเป็น vacant (ว่าง) สำหรับตรวจแอบจอด
  const filteredSlots = useMemo(() => {
    return slotsInLot.filter((s) => {
      const isClosed = s.isClosed || s.isRoad;
      const isPaid = !!paidBookingMap[s.code];
      const isVacant = !isPaid && !isClosed;

      if (filterType === "paid") return isPaid;
      if (filterType === "vacant") return isVacant;
      return true;
    });
  }, [slotsInLot, paidBookingMap, filterType]);

  const paidCount = useMemo(() => slotsInLot.filter((s) => paidBookingMap[s.code]).length, [slotsInLot, paidBookingMap]);
  const vacantCount = useMemo(() => slotsInLot.filter((s) => !paidBookingMap[s.code] && !s.isClosed && !s.isRoad).length, [slotsInLot, paidBookingMap]);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", paddingBottom: 40 }}>
      <div className="top-bar" style={{ padding: "12px 16px", marginBottom: 16 }}>
        <div className="inner">
          <h1 style={{ fontSize: 16 }}>📱 ตรวจสอบพื้นที่ (Mobile View)</h1>
          <Link href="/" className="back" style={{ fontSize: 13 }}>หน้าหลัก</Link>
        </div>
      </div>

      <div style={{ padding: "0 12px" }}>
        {error && <div className="alert alert-error">{error}</div>}

        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>วันที่:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                loadData(e.target.value);
              }}
              style={{ flex: 1, padding: "6px 10px", fontSize: 14 }}
            />
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {lots.map((l) => (
              <button
                key={l}
                type="button"
                className={`btn ${selectedLot === l ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "6px 14px", fontSize: 13, whiteSpace: "nowrap" }}
                onClick={() => setSelectedLot(l)}
              >
                ลาน {l}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button
              className={`btn ${filterType === "all" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, padding: "5px 4px", fontSize: 12 }}
              onClick={() => setFilterType("all")}
            >
              ทั้งหมด ({slotsInLot.length})
            </button>
            <button
              className={`btn ${filterType === "paid" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, padding: "5px 4px", fontSize: 12, color: "var(--red)" }}
              onClick={() => setFilterType("paid")}
            >
              จองแล้ว ({paidCount})
            </button>
            <button
              className={`btn ${filterType === "vacant" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, padding: "5px 4px", fontSize: 12, color: "var(--green)" }}
              onClick={() => setFilterType("vacant")}
            >
              ว่าง ({vacantCount})
            </button>
          </div>
        </div>

        {loading ? (
          <div className="card" style={{ textAlign: "center", padding: 30 }}>
            <p className="subtitle" style={{ margin: 0 }}>กำลังโหลดสถานะช่องจอด...</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredSlots.map((s) => {
              const isClosed = s.isClosed || s.isRoad;
              const paid = paidBookingMap[s.code];
              const unpaid = unpaidBookingMap[s.code];

              let borderLeftColor = "var(--green)";
              let statusText = "🟢 ว่าง (พร้อมใช้งาน/ตรวจแอบจอด)";
              let statusBg = "#e9f5ee";

              if (isClosed) {
                borderLeftColor = "var(--gray)";
                statusText = s.isRoad ? "⚫ ถนน / ปิดใช้งาน" : "⚫ ปิดใช้งานชั่วคราว";
                statusBg = "#f3f4f6";
              } else if (paid) {
                borderLeftColor = "var(--red)";
                statusText = "🔴 จองแล้ว (ชำระเงินแล้ว)";
                statusBg = "#fee2e2";
              } else {
                // Unpaid booking หรือไม่มี booking เลย => แสดงเป็น "ว่าง" (เขียว) ห้ามแสดงเป็น occupied
                borderLeftColor = "var(--green)";
                statusText = "🟢 ว่าง (พร้อมใช้งาน/ตรวจแอบจอด)";
                statusBg = "#e9f5ee";
              }

              return (
                <div
                  key={s.code}
                  style={{
                    background: "white",
                    border: "1px solid var(--border)",
                    borderLeft: `5px solid ${borderLeftColor}`,
                    borderRadius: 8,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
                      {s.code}
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: statusBg,
                      }}
                    >
                      {statusText}
                    </span>
                  </div>

                  {paid && (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      <div>ผู้จอง: <strong>คุณ{paid.customer}</strong></div>
                      <div style={{ color: "var(--gray)", marginTop: 2 }}>
                        เวลา: {paid.startTime} - {paid.endTime} น. (4 ชม.)
                      </div>
                    </div>
                  )}

                  {!paid && unpaid && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--gray)", background: "#f9fafb", padding: "6px 8px", borderRadius: 4 }}>
                      ℹ️ มีจองของคุณ{unpaid.customer} ({unpaid.startTime || "-"} น.) แต่ไม่พบยอดชำระเงินในวันก่อนหน้า จึงไม่มีสิทธิ์เข้าจอด (ถือเป็นช่องว่าง)
                    </div>
                  )}

                  {isClosed && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--gray)" }}>
                      {s.isRoad ? "เป็นทางสัญจร/ถนน" : (s.closedReason ? `สาเหตุ: ${s.closedReason}` : "ปิดใช้งานชั่วคราว")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
