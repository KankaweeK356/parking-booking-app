// pages/admin/revenue-reconciliation.js
// หน้าสรุปการชำระเงินและกระทบยอดรายได้สำหรับฝ่ายบัญชีและการเงิน (Admin / Accounting / Account)

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { exportRevenueReconciliationExcel } from "../../lib/excel-export";

function getYesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDaysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatCurrency(val) {
  return Number(val || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(val) {
  return Number(val || 0).toLocaleString("th-TH");
}

export default function RevenueReconciliationPage() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  // ค่าเริ่มต้น: "เมื่อวาน" (D-1) ซึ่งเป็นกะที่ปิดยอดเรียบร้อยแล้ว
  const [startDate, setStartDate] = useState(getYesterdayIso());
  const [endDate, setEndDate] = useState(getYesterdayIso());

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [reconData, setReconData] = useState(null);

  // ตัวกรองตารางตรวจสอบด่วน
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // ตรวจสอบสิทธิ์ผู้ใช้
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setUser(data?.user || null);
        setAuthChecking(false);
      })
      .catch(() => setAuthChecking(false));
  }, []);

  const canAccess =
    user?.role === "Admin" ||
    user?.role === "Accounting" ||
    user?.role === "Account";

  // ฟังก์ชันโหลดข้อมูล
  async function loadData() {
    if (!canAccess) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ startDate, endDate });
      const res = await fetch(`/api/admin/revenue-reconciliation?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "เกิดข้อผิดพลาดในการคำนวณข้อมูลกระทบยอด");
      }
      setReconData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // โหลดข้อมูลอัตโนมัติเมื่อตรวจสอบสิทธิ์ผ่าน
  useEffect(() => {
    if (canAccess) {
      loadData();
    }
  }, [user]);

  // ฟังก์ชันส่งออก Excel
  async function handleExportExcel() {
    if (!reconData) return;
    setExporting(true);
    try {
      await exportRevenueReconciliationExcel(reconData);
    } catch (err) {
      alert("เกิดข้อผิดพลาดในการส่งออกไฟล์ Excel: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  // Quick Preset Handlers
  function setPresetYesterday() {
    const y = getYesterdayIso();
    setStartDate(y);
    setEndDate(y);
  }

  function setPresetToday() {
    const t = getTodayIso();
    setStartDate(t);
    setEndDate(t);
  }

  function setPreset7Days() {
    setStartDate(getDaysAgoIso(7));
    setEndDate(getYesterdayIso());
  }

  function setPresetMonth() {
    const now = new Date();
    const firstDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "01",
    }).format(now);
    setStartDate(firstDay);
    setEndDate(getYesterdayIso());
  }

  // กรองรายการลูกค้าในตารางตรวจสอบด่วน
  const filteredCustomers = useMemo(() => {
    if (!reconData?.customerSummary) return [];
    let list = reconData.customerSummary;

    if (statusFilter !== "all") {
      list = list.filter((c) => c.statusKey === statusFilter);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.boothCode.toLowerCase().includes(q) ||
          c.customerName.toLowerCase().includes(q)
      );
    }

    return list;
  }, [reconData, statusFilter, searchTerm]);

  const totals = reconData?.totals || {
    totalCash: 0,
    earnedToday: 0,
    advanceTomorrow: 0,
    surplus: 0,
    shortfall: 0,
    totalTickets: 0,
    customerCount: 0,
    transactionCount: 0,
  };

  if (authChecking) {
    return (
      <div className="page" style={{ maxWidth: 1040 }}>
        <div className="card">
          <p className="subtitle">กำลังตรวจสอบสิทธิ์การใช้งาน...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div>
        <div className="top-bar">
          <div className="inner" style={{ maxWidth: 1040 }}>
            <h1>📊 สรุปการชำระเงิน</h1>
            <Link href="/" className="back">← กลับหน้าหลัก</Link>
          </div>
        </div>
        <div className="page" style={{ maxWidth: 1040 }}>
          <div className="card alert alert-error">
            <strong>ไม่มีสิทธิ์เข้าถึง:</strong> หน้านี้เปิดให้เฉพาะฝ่ายบัญชีและการเงิน (Accounting) และผู้ดูแลระบบ (Admin) เท่านั้น
          </div>
          <Link href="/" className="btn btn-secondary">← กลับหน้าหลัก</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="top-bar" style={{ background: "#0f172a" }}>
        <div className="inner" style={{ maxWidth: 1040 }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>📊 สรุปการชำระเงิน (ฝ่ายบัญชีและการเงิน)</span>
            </h1>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>
              กระทบยอดเงินสด POS • รับรู้รายได้สิทธิ์ด่วน • บันทึกเงินรับล่วงหน้า
            </span>
          </div>
          <Link href="/" className="back" style={{ color: "#cbd5e1" }}>← กลับหน้าหลัก</Link>
        </div>
      </div>

      <div className="page" style={{ maxWidth: 1040, paddingBottom: 80 }}>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* กล่องเลือกช่วงวันที่ */}
        <div className="card" style={{ marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>
              📅 เลือกช่วงวันที่ทำรายการ POS
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: 13, background: "#f8fafc", borderColor: "#cbd5e1" }}
                onClick={setPresetYesterday}
              >
                เมื่อวาน (D-1)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: 13, background: "#f8fafc", borderColor: "#cbd5e1" }}
                onClick={setPresetToday}
              >
                วันนี้
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: 13, background: "#f8fafc", borderColor: "#cbd5e1" }}
                onClick={setPreset7Days}
              >
                7 วันย้อนหลัง
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: 13, background: "#f8fafc", borderColor: "#cbd5e1" }}
                onClick={setPresetMonth}
              >
                ต้นเดือนถึงเมื่อวาน
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 13, color: "#475569", marginBottom: 4 }}>วันที่เริ่มต้น (POS Date)</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "#475569", marginBottom: 4 }}>วันที่สิ้นสุด (POS Date)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: "100%", padding: "10px 18px", background: "#1e293b" }}
                onClick={loadData}
                disabled={loading}
              >
                {loading ? "กำลังคำนวณ..." : "🔍 คำนวณกระทบยอด"}
              </button>
            </div>
          </div>
        </div>

        {/* บล็อก 4 KPI สรุปยอดทางบัญชี */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          {/* Card 1: เงินสดรับจริง */}
          <div
            className="card"
            style={{
              margin: 0,
              padding: "18px 20px",
              borderTop: "4px solid #1e293b",
              background: "#ffffff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>
              1. ยอดเงินสดรับจริง (POS)
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#0f172a",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
              }}
            >
              ฿{formatCurrency(totals.totalCash)}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              {formatNumber(totals.totalTickets)} สิทธิ์ ({formatNumber(totals.transactionCount)} สลิป)
            </div>
          </div>

          {/* Card 2: รายได้วันนี้ (สิทธิ์ด่วน) */}
          <div
            className="card"
            style={{
              margin: 0,
              padding: "18px 20px",
              borderTop: "4px solid #059669",
              background: "#ffffff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#059669", marginBottom: 4 }}>
              2. รายได้ค่าบริการวันนี้ (สิทธิ์ด่วน)
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#065f46",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
              }}
            >
              ฿{formatCurrency(totals.earnedToday)}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              {formatNumber(totals.earnedToday / 100)} สิทธิ์ (รับรู้รายได้ทันที)
            </div>
          </div>

          {/* Card 3: เงินรับล่วงหน้า (จอดพรุ่งนี้) */}
          <div
            className="card"
            style={{
              margin: 0,
              padding: "18px 20px",
              borderTop: "4px solid #2563eb",
              background: "#ffffff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", marginBottom: 4 }}>
              3. เงินรับล่วงหน้า (จอดพรุ่งนี้)
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#1e40af",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
              }}
            >
              ฿{formatCurrency(totals.advanceTomorrow)}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              {formatNumber(totals.advanceTomorrow / 100)} สิทธิ์ (หนี้สินหมุนเวียน)
            </div>
          </div>

          {/* Card 4: เงินรับส่วนเกิน */}
          <div
            className="card"
            style={{
              margin: 0,
              padding: "18px 20px",
              borderTop: "4px solid #0284c7",
              background: "#ffffff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0284c7", marginBottom: 4 }}>
              4. เงินรับส่วนเกิน (ตั๋วเกิน)
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#0369a1",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
              }}
            >
              ฿{formatCurrency(totals.surplus)}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              {formatNumber(totals.surplus / 100)} สิทธิ์ (ช่วงรอยต่อ/ตั๋วเกิน)
            </div>
          </div>
        </div>

        {/* แถบเตือน Shortfall / ขาดชำระ หากมี */}
        {totals.shortfall > 0 && (
          <div
            className="alert"
            style={{
              background: "#fff1f2",
              border: "1px solid #fecdd3",
              color: "#9f1239",
              padding: "14px 18px",
              borderRadius: 8,
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <strong>⚠️ รอตรวจยอดชำระ:</strong> พบยอดขาดชำระรวม{" "}
              <strong>฿{formatCurrency(totals.shortfall)}</strong> (
              {formatNumber(totals.shortfall / 100)} สิทธิ์) — CS ทำการจองแต่ตั๋ว POS ไม่เพียงพอ
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderColor: "#f43f5e",
                color: "#9f1239",
                background: "white",
              }}
              onClick={() => setStatusFilter("shortfall")}
            >
              กรองดูเฉพาะรายที่ขาดชำระ
            </button>
          </div>
        )}

        {/* ปุ่มส่งออก Excel หลักเพียงปุ่มเดียว */}
        <div
          className="card"
          style={{
            marginBottom: 24,
            padding: 24,
            textAlign: "center",
            background: "#f8fafc",
            border: "1px dashed #cbd5e1",
          }}
        >
          <button
            type="button"
            className="btn"
            style={{
              background: "#107c41",
              color: "white",
              fontSize: 17,
              fontWeight: 700,
              padding: "14px 32px",
              borderRadius: 8,
              boxShadow: "0 2px 6px rgba(16, 124, 65, 0.25)",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              cursor: exporting || loading ? "not-allowed" : "pointer",
            }}
            onClick={handleExportExcel}
            disabled={exporting || loading || !reconData}
          >
            <span style={{ fontSize: 20 }}>📥</span>
            <span>
              {exporting ? "กำลังสร้างไฟล์ Excel..." : "ส่งออกไฟล์ Excel สรุปการชำระเงิน (.xlsx)"}
            </span>
          </button>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>
            ไฟล์ Excel สมบูรณ์ 2 แท็บ (แท็บ 1: สรุปภาพรวมรายลูกค้า • แท็บ 2: รายละเอียดสลิป POS พร้อมแถวอ้างอิง)
          </div>
        </div>

        {/* ตารางตรวจสอบรายการหน้าเว็บ (Lightweight Sanity Check) */}
        {reconData && (
          <div className="card" style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: "#1e293b" }}>
                  📋 ตรวจสอบรายการรายลูกค้า ({filteredCustomers.length} ราย)
                </h3>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  คลิกกรองหรือค้นหาเพื่อตรวจสอบความถูกต้องเบื้องต้นก่อนนำไฟล์ไปใช้
                </span>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ width: "auto", fontSize: 13, padding: "6px 10px" }}
                >
                  <option value="all">สถานะทั้งหมด</option>
                  <option value="balanced">กระทบยอดลงตัว</option>
                  <option value="surplus">เงินรับส่วนเกิน</option>
                  <option value="shortfall">รอตรวจยอดชำระ</option>
                </select>

                <input
                  type="text"
                  placeholder="ค้นหาชื่อหรือรหัส..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ width: 180, fontSize: 13, padding: "6px 10px" }}
                />
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <thead>
                  <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1", color: "#334155" }}>
                    <th style={{ padding: "8px 10px", textAlign: "center" }}>#</th>
                    <th style={{ padding: "8px 10px", textAlign: "center" }}>วันที่ POS</th>
                    <th style={{ padding: "8px 10px", textAlign: "center" }}>รหัสลูกค้า</th>
                    <th style={{ padding: "8px 10px", textAlign: "left" }}>ชื่อลูกค้า</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>ชำระ (ใบ)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>เงินรับจริง (฿)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>รายได้วันนี้ (฿)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>รับล่วงหน้า (฿)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>ส่วนเกิน (฿)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>รอตรวจ (฿)</th>
                    <th style={{ padding: "8px 10px", textAlign: "center" }}>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                        ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((c, idx) => (
                      <tr
                        key={`${c.date}-${c.boothCode}-${idx}`}
                        style={{
                          borderBottom: "1px solid #e2e8f0",
                          background: idx % 2 === 1 ? "#f8fafc" : "white",
                        }}
                      >
                        <td style={{ padding: "8px 10px", textAlign: "center", color: "#64748b" }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>{c.date}</td>
                        <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>
                          {c.boothCode}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "left" }}>{c.customerName}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{c.paidTickets}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>
                          {formatCurrency(c.totalPaid)}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#059669" }}>
                          {formatCurrency(c.earnedToday)}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#2563eb" }}>
                          {formatCurrency(c.advanceTomorrow)}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#0284c7" }}>
                          {c.surplus > 0 ? formatCurrency(c.surplus) : "-"}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            textAlign: "right",
                            color: c.shortfall > 0 ? "#dc2626" : "#64748b",
                            fontWeight: c.shortfall > 0 ? 700 : 400,
                          }}
                        >
                          {c.shortfall > 0 ? formatCurrency(c.shortfall) : "-"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              background:
                                c.statusKey === "shortfall"
                                  ? "#fee2e2"
                                  : c.statusKey === "surplus"
                                  ? "#e0f2fe"
                                  : "#dcfce7",
                              color:
                                c.statusKey === "shortfall"
                                  ? "#991b1b"
                                  : c.statusKey === "surplus"
                                  ? "#0369a1"
                                  : "#15803d",
                            }}
                          >
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
