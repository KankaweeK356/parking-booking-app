// pages/admin/revenue-reconciliation.js
// หน้าสรุปการชำระเงินและกระทบยอดรายได้สำหรับฝ่ายบัญชีและการเงิน (Admin / Accounting / Account) - รองรับพิมพ์ PDF แนวนอนแยกวันละแผ่น

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { exportRevenueReconciliationExcel } from "../../lib/excel-export";

function getBangkokDateObj() {
  const str = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${str}T12:00:00Z`);
}

function formatDate(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getYesterdayIso() {
  const d = getBangkokDateObj();
  d.setUTCDate(d.getUTCDate() - 1);
  return formatDate(d);
}

function getTodayIso() {
  return formatDate(getBangkokDateObj());
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
  async function loadData(customStart, customEnd) {
    if (!canAccess) return;
    const s = customStart !== undefined ? customStart : startDate;
    const e = customEnd !== undefined ? customEnd : endDate;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ startDate: s, endDate: e });
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

  // Preset Handlers สำหรับรอบการทำงานบัญชี (เปลี่ยนวันที่และโหลดข้อมูลทันที)
  function setPresetYesterday() {
    const y = getYesterdayIso();
    setStartDate(y);
    setEndDate(y);
    loadData(y, y);
  }

  function setPresetToday() {
    const t = getTodayIso();
    setStartDate(t);
    setEndDate(t);
    loadData(t, t);
  }

  function setPresetThisMonth() {
    const d = getBangkokDateObj();
    const firstDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
    const s = formatDate(firstDay);
    const e = formatDate(d);
    setStartDate(s);
    setEndDate(e);
    loadData(s, e);
  }

  function setPresetLastMonth() {
    const d = getBangkokDateObj();
    const firstDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12));
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));

    setStartDate(formatDate(firstDay));
    setEndDate(formatDate(lastDay));
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

  // จัดกลุ่มรายการแยกตามวัน สำหรับการพิมพ์ PDF แนวนอน แยกแผ่นละ 1 วัน
  const dailyPrintPages = useMemo(() => {
    if (!filteredCustomers.length) return [];
    const byDate = new Map();
    filteredCustomers.forEach((c) => {
      if (!byDate.has(c.date)) byDate.set(c.date, []);
      byDate.get(c.date).push(c);
    });
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, items]) => {
        const dayTotals = items.reduce(
          (acc, item) => ({
            bookedTickets: acc.bookedTickets + (item.bookedTickets || 0),
            paidTickets: acc.paidTickets + (item.paidTickets || 0),
            avgUsed: acc.avgUsed + Math.round(item.avgUsed || 0),
            totalPaid: acc.totalPaid + (item.totalPaid || 0),
            earnedToday: acc.earnedToday + (item.earnedToday || 0),
            advanceTomorrow: acc.advanceTomorrow + (item.advanceTomorrow || 0),
            surplus: acc.surplus + (item.surplus || 0),
            shortfall: acc.shortfall + (item.shortfall || 0),
          }),
          {
            bookedTickets: 0,
            paidTickets: 0,
            avgUsed: 0,
            totalPaid: 0,
            earnedToday: 0,
            advanceTomorrow: 0,
            surplus: 0,
            shortfall: 0,
          }
        );
        const mid = Math.ceil(items.length / 2);
        const leftItems = items.slice(0, mid);
        const rightItems = items.slice(mid);
        return { date, items, leftItems, rightItems, mid, dayTotals };
      });
  }, [filteredCustomers]);

  function handlePrintPdf() {
    window.print();
  }

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
      <div className="top-bar no-print" style={{ background: "#0f172a" }}>
        <div className="inner" style={{ maxWidth: 1040 }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>📊 สรุปการชำระเงิน (ฝ่ายบัญชีและการเงิน)</span>
            </h1>
            <span style={{ fontSize: 13, color: "#94a3b8" }}>
              กระทบยอดเงินสดตั๋วรายวัน • รับรู้รายได้รอบวัน • บันทึกเงินรับล่วงหน้า
            </span>
          </div>
          <Link href="/" className="back" style={{ color: "#cbd5e1" }}>← กลับหน้าหลัก</Link>
        </div>
      </div>

      <div className="page no-print" style={{ maxWidth: 1040, paddingBottom: 60 }}>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* กล่องเลือกช่วงวันที่ และปุ่มสั่งการ */}
        <div className="card" style={{ marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>
              📅 เลือกช่วงวันที่ในตั๋วรายวัน
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "5px 14px", fontSize: 13, background: "#f8fafc", borderColor: "#cbd5e1", color: "#334155" }}
                onClick={setPresetYesterday}
              >
                เมื่อวาน
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "5px 14px", fontSize: 13, background: "#f8fafc", borderColor: "#cbd5e1", color: "#334155" }}
                onClick={setPresetToday}
              >
                วันนี้
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "5px 14px", fontSize: 13, background: "#f8fafc", borderColor: "#cbd5e1", color: "#334155" }}
                onClick={setPresetThisMonth}
              >
                เดือนนี้
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 13, color: "#475569", marginBottom: 4 }}>วันที่เริ่มต้น (วันที่ในตั๋ว)</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: "#475569", marginBottom: 4 }}>วันที่สิ้นสุด (วันที่ในตั๋ว)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {/* แถวปุ่มคำนวณ ส่งออก Excel และ พิมพ์ PDF */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  background: "#1e293b",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                }}
                onClick={() => loadData()}
                disabled={loading}
              >
                <span>🔍</span>
                <span>{loading ? "กำลังคำนวณ..." : "คำนวณกระทบยอด"}</span>
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  background: "#107c41",
                  color: "white",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  cursor: exporting || loading || !reconData ? "not-allowed" : "pointer",
                  opacity: exporting || loading || !reconData ? 0.65 : 1,
                }}
                onClick={handleExportExcel}
                disabled={exporting || loading || !reconData}
                title="ส่งออกไฟล์ Excel 2 แท็บ (สรุปภาพรวม + รายละเอียดตั๋วรายวัน)"
              >
                <span>📥</span>
                <span>{exporting ? "กำลังส่งออก..." : "ส่งออก Excel"}</span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                  cursor: loading || !dailyPrintPages.length ? "not-allowed" : "pointer",
                  opacity: loading || !dailyPrintPages.length ? 0.65 : 1,
                }}
                onClick={handlePrintPdf}
                disabled={loading || !dailyPrintPages.length}
                title="พิมพ์หรือบันทึกเป็น PDF แนวนอน (แยกแผ่นละ 1 วัน)"
              >
                <span>🖨️</span>
                <span>พิมพ์ / PDF ({dailyPrintPages.length || 1} แผ่น)</span>
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
              1. ยอดเงินสดจากตั๋วรายวัน
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
              {formatNumber(totals.totalTickets)} สิทธิ์ ({formatNumber(totals.transactionCount)} รายการตั๋ว)
            </div>
          </div>

          {/* Card 2: รายได้รอบวัน (จอดวันนั้น) */}
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
              2. รายได้ค่าบริการรอบวัน (จอดวันนั้น)
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
              {formatNumber(totals.earnedToday / 100)} สิทธิ์ (รับรู้รายได้ทันทีตามสิทธิ์ที่จองในรอบวัน)
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
              cursor: totals.surplus > 0 ? "pointer" : "default",
            }}
            onClick={() => { if (totals.surplus > 0) setStatusFilter("surplus"); }}
            title={totals.surplus > 0 ? "คลิกเพื่อกรองดูเฉพาะรายที่จ่ายเกิน" : ""}
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
              {totals.surplus > 0
                ? `฿${formatCurrency(totals.surplus)} (${formatNumber(totals.surplus / 100)} ใบ) — คลิกเพื่อกรองดูรายชื่อ`
                : "0 สิทธิ์ (จ่ายเกินจำนวนที่จอง)"}
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
              {formatNumber(totals.shortfall / 100)} สิทธิ์) — CS ทำการจองแต่ตั๋วรายวันไม่เพียงพอ
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

        {/* ตารางตรวจสอบรายการรายลูกค้า (Lightweight Sanity Check) */}
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
                  สามารถกรองหรือค้นหาเพื่อตรวจสอบความถูกต้องบนหน้าเว็บ หรือกดปุ่ม <strong>ส่งออก Excel</strong> ด้านบนเพื่อดาวน์โหลดรายงาน 2 แท็บ
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
                    <th style={{ padding: "8px 10px", textAlign: "center" }}>วันที่</th>
                    <th style={{ padding: "8px 10px", textAlign: "center" }}>รหัส</th>
                    <th style={{ padding: "8px 10px", textAlign: "left" }}>ชื่อลูกค้า</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>จอง (ใบ)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>ชำระ (ใบ)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>ใช้งานเฉลี่ย (ใบ)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>รับล่วงหน้า (฿)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>รอบวัน (฿)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>ส่วนเกิน / รอตรวจ (฿)</th>
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
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#475569" }}>
                          {c.bookedTickets || 0}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                          {c.paidTickets}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#475569", background: "#f8fafc" }}>
                          {Math.round(c.avgUsed || 0)}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#2563eb" }}>
                          {c.advanceTomorrow > 0 ? formatNumber(c.advanceTomorrow) : "-"}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#059669" }}>
                          {c.earnedToday > 0 ? formatNumber(c.earnedToday) : "-"}
                        </td>
                        <td
                          style={{
                            padding: "8px 10px",
                            textAlign: "right",
                            color:
                              c.surplus > 0
                                ? "#0284c7"
                                : c.shortfall > 0
                                ? "#dc2626"
                                : "#94a3b8",
                            fontWeight: c.surplus > 0 || c.shortfall > 0 ? 700 : 400,
                          }}
                        >
                          {c.surplus > 0
                            ? `+฿${formatNumber(c.surplus)}`
                            : c.shortfall > 0
                            ? `-฿${formatNumber(c.shortfall)}`
                            : "-"}
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

      {/* โซนสำหรับสั่งพิมพ์ / Export PDF แนวนอน (แยก 1 แผ่นต่อ 1 วัน) */}
      <div className="print-only recon-print-container">
        {dailyPrintPages.map((page, pageIdx) => (
          <div
            key={page.date}
            className="recon-print-sheet"
            style={{
              pageBreakAfter: pageIdx < dailyPrintPages.length - 1 ? "always" : "auto",
              breakAfter: pageIdx < dailyPrintPages.length - 1 ? "page" : "auto",
            }}
          >
            <div className="recon-print-header">
              <div>
                <h2>รายงานสรุปการชำระเงินและกระทบยอดรายได้ประจำวัน — วันที่ในตั๋ว: {page.date}</h2>
                <p>
                  ลูกค้าทั้งหมด {page.items.length} ราย · ยอดจองรวม {formatNumber(page.dayTotals.bookedTickets)} ใบ · ยอดชำระจริง {formatNumber(page.dayTotals.paidTickets)} ใบ
                </p>
              </div>
              <div style={{ textAlign: "right", fontSize: "8.5pt", color: "#334155" }}>
                <div>แผ่นที่ {pageIdx + 1} / {dailyPrintPages.length}</div>
                <div>ระบบจองที่จอดรถเรียงสินค้า</div>
              </div>
            </div>

            <div className="recon-print-kpis">
              <div className="recon-print-kpi">
                <span>1. เงินสดรับจริง:</span>{" "}
                <strong>฿{formatCurrency(page.dayTotals.totalPaid)}</strong> ({formatNumber(page.dayTotals.paidTickets)} ใบ)
              </div>
              <div className="recon-print-kpi">
                <span>2. รายได้รอบวัน:</span>{" "}
                <strong>฿{formatCurrency(page.dayTotals.earnedToday)}</strong> ({formatNumber(page.dayTotals.earnedToday / 100)} ใบ)
              </div>
              <div className="recon-print-kpi">
                <span>3. รับล่วงหน้า (จอดพรุ่งนี้):</span>{" "}
                <strong>฿{formatCurrency(page.dayTotals.advanceTomorrow)}</strong> ({formatNumber(page.dayTotals.advanceTomorrow / 100)} ใบ)
              </div>
              <div className="recon-print-kpi">
                <span>4. ส่วนเกิน (ตีเบิ้ล):</span>{" "}
                <strong>+฿{formatCurrency(page.dayTotals.surplus)}</strong> ({formatNumber(page.dayTotals.surplus / 100)} ใบ)
              </div>
              <div className="recon-print-kpi">
                <span>5. รอตรวจ (ขาดชำระ):</span>{" "}
                <strong>-฿{formatCurrency(page.dayTotals.shortfall)}</strong> ({formatNumber(page.dayTotals.shortfall / 100)} ใบ)
              </div>
            </div>

            <div className="recon-print-two-cols">
              {[
                { list: page.leftItems, offset: 0 },
                { list: page.rightItems, offset: page.mid },
              ].map((col, colIdx) => (
                <table key={colIdx} className="recon-print-table">
                  <thead>
                    <tr>
                      <th style={{ width: "22px" }}>#</th>
                      <th style={{ width: "36px" }}>รหัส</th>
                      <th style={{ textAlign: "left" }}>ชื่อลูกค้า</th>
                      <th style={{ width: "30px" }}>จอง</th>
                      <th style={{ width: "30px" }}>ชำระ</th>
                      <th style={{ width: "34px" }}>เฉลี่ย</th>
                      <th style={{ width: "54px" }}>รับล่วงหน้า</th>
                      <th style={{ width: "44px" }}>รอบวัน</th>
                      <th style={{ width: "62px" }}>ส่วนเกิน/รอตรวจ</th>
                      <th style={{ width: "68px" }}>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {col.list.map((c, idx) => (
                      <tr key={`${c.boothCode}-${idx}`}>
                        <td style={{ textAlign: "center" }}>{col.offset + idx + 1}</td>
                        <td style={{ textAlign: "center", fontWeight: 700 }}>{c.boothCode}</td>
                        <td style={{ textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "125px" }}>
                          {c.customerName}
                        </td>
                        <td style={{ textAlign: "right" }}>{c.bookedTickets || 0}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{c.paidTickets}</td>
                        <td style={{ textAlign: "right" }}>{Math.round(c.avgUsed || 0)}</td>
                        <td style={{ textAlign: "right" }}>
                          {c.advanceTomorrow > 0 ? formatNumber(c.advanceTomorrow) : "-"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {c.earnedToday > 0 ? formatNumber(c.earnedToday) : "-"}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontWeight: c.surplus > 0 || c.shortfall > 0 ? 700 : 400,
                          }}
                        >
                          {c.surplus > 0
                            ? `+${formatNumber(c.surplus)}`
                            : c.shortfall > 0
                            ? `-${formatNumber(c.shortfall)}`
                            : "-"}
                        </td>
                        <td style={{ textAlign: "center", fontWeight: 600 }}>{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>

            <div className="recon-print-footer">
              <strong>รวมประจำวันที่ {page.date} ({page.items.length} ราย):</strong>{" "}
              จองรวม {formatNumber(page.dayTotals.bookedTickets)} ใบ | ชำระจริง {formatNumber(page.dayTotals.paidTickets)} ใบ | เงินสดรับจริง ฿{formatCurrency(page.dayTotals.totalPaid)} | รายได้รอบวัน ฿{formatCurrency(page.dayTotals.earnedToday)} | รับล่วงหน้า ฿{formatCurrency(page.dayTotals.advanceTomorrow)} | เงินรับส่วนเกิน +฿{formatCurrency(page.dayTotals.surplus)} | รอตรวจยอดชำระ -฿{formatCurrency(page.dayTotals.shortfall)}
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .print-only {
          display: none;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          @page {
            size: A4 landscape;
            margin: 6mm;
          }
          .recon-print-sheet {
            width: 100%;
            box-sizing: border-box;
            font-family: "Sarabun", "Tahoma", sans-serif;
            color: #000;
          }
          .recon-print-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-bottom: 1.5px solid #0f172a;
            padding-bottom: 3px;
            margin-bottom: 4px;
          }
          .recon-print-header h2 {
            margin: 0;
            font-size: 11.5pt;
            font-weight: 700;
            color: #0f172a;
          }
          .recon-print-header p {
            margin: 1px 0 0;
            font-size: 8.5pt;
            color: #334155;
          }
          .recon-print-kpis {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 4px;
            margin-bottom: 5px;
          }
          .recon-print-kpi {
            border: 1px solid #cbd5e1;
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 8pt;
            background: #f8fafc;
          }
          .recon-print-two-cols {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            align-items: start;
          }
          .recon-print-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 7.2pt;
            font-variant-numeric: tabular-nums;
          }
          .recon-print-table th,
          .recon-print-table td {
            border: 1px solid #cbd5e1;
            padding: 1.5px 3px;
            text-align: center;
            line-height: 1.15;
          }
          .recon-print-table th {
            background: #e2e8f0 !important;
            font-weight: 700;
            color: #0f172a;
          }
          .recon-print-footer {
            margin-top: 4px;
            padding: 3px 6px;
            border: 1px solid #0f172a;
            background: #f1f5f9;
            font-size: 8pt;
            text-align: right;
          }
        }
      `}</style>
    </div>
  );
}
