import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

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

function formatThaiDate(isoStr) {
  if (!isoStr) return "-";
  try {
    return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
      timeZone: "Asia/Bangkok",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(`${isoStr}T00:00:00Z`));
  } catch {
    return isoStr;
  }
}

export default function PaymentSummaryPage() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [mode, setMode] = useState("day"); // "day" | "range"
  const [selectedDate, setSelectedDate] = useState(getTodayIso());
  const [startDate, setStartDate] = useState(getDaysAgoIso(7));
  const [endDate, setEndDate] = useState(getTodayIso());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summaryData, setSummaryData] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Check user session
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setUser(data?.user || null);
        setAuthChecking(false);
      })
      .catch(() => setAuthChecking(false));
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("mode", mode);
      if (mode === "day") {
        params.set("date", selectedDate);
      } else {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }

      const res = await fetch(`/api/admin/payment-summary?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "เกิดข้อผิดพลาดในการดึงข้อมูล");
      }
      setSummaryData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load when user changes filter
  useEffect(() => {
    if (user?.role === "Admin") {
      loadData();
    }
  }, [user, mode, selectedDate, startDate, endDate]);

  const rows = useMemo(() => {
    if (!summaryData?.summaryRows) return [];
    let list = summaryData.summaryRows;
    if (statusFilter !== "all") {
      list = list.filter((r) => {
        if (statusFilter === "surplus") return (r.surplus || 0) > 0 || r.statusKey === "surplus";
        if (statusFilter === "shortfall") return (r.shortfall || 0) > 0 || r.statusKey === "shortfall";
        if (statusFilter === "balanced") return (r.surplus || 0) === 0 && (r.shortfall || 0) === 0;
        return true;
      });
    }
    if (!filterText.trim()) return list;
    const q = filterText.trim().toLowerCase();
    return list.filter(
      (r) =>
        (r.docId && String(r.docId).toLowerCase().includes(q)) ||
        (r.customerName && String(r.customerName).toLowerCase().includes(q))
    );
  }, [summaryData, filterText, statusFilter]);

  // จัดกลุ่มรายการแยกตามวัน สำหรับการพิมพ์ PDF แนวนอน แยกแผ่นละ 1 วัน
  const dailyPrintPages = useMemo(() => {
    const rawList = summaryData?.dailyBreakdown || summaryData?.summaryRows || [];
    if (!rawList.length) return [];
    let list = rawList;
    if (statusFilter !== "all") {
      list = list.filter((r) => {
        if (statusFilter === "surplus") return (r.surplus || 0) > 0 || r.statusKey === "surplus";
        if (statusFilter === "shortfall") return (r.shortfall || 0) > 0 || r.statusKey === "shortfall";
        if (statusFilter === "balanced") return (r.surplus || 0) === 0 && (r.shortfall || 0) === 0;
        return true;
      });
    }
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.docId && String(r.docId).toLowerCase().includes(q)) ||
          (r.customerName && String(r.customerName).toLowerCase().includes(q))
      );
    }
    const byDate = new Map();
    list.forEach((r) => {
      const d = r.date || selectedDate;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(r);
    });
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, items]) => {
        const dayTotals = items.reduce(
          (acc, item) => ({
            booked: acc.booked + (item.booked || 0),
            paid: acc.paid + (item.paid || 0),
            surplus: acc.surplus + (item.surplus || 0),
            shortfall: acc.shortfall + (item.shortfall || 0),
            urgent: acc.urgent + (item.urgent || 0),
          }),
          { booked: 0, paid: 0, surplus: 0, shortfall: 0, urgent: 0 }
        );
        const mid = Math.ceil(items.length / 2);
        const leftItems = items.slice(0, mid);
        const rightItems = items.slice(mid);
        return { date, items, leftItems, rightItems, mid, dayTotals };
      });
  }, [summaryData, statusFilter, filterText, selectedDate]);

  const totals = summaryData?.totals || {
    totalBooked: 0,
    totalPaid: 0,
    totalShortfall: 0,
    totalSurplus: 0,
    totalUrgent: 0,
    overallPct: 0,
    customerCount: 0,
  };

  // Quick Preset Handlers
  function setRange7Days() {
    setMode("range");
    setStartDate(getDaysAgoIso(7));
    setEndDate(getTodayIso());
  }

  function setRange30Days() {
    setMode("range");
    setStartDate(getDaysAgoIso(30));
    setEndDate(getTodayIso());
  }

  function setRangeThisMonth() {
    setMode("range");
    const today = getTodayIso();
    const firstDay = `${today.slice(0, 7)}-01`;
    setStartDate(firstDay);
    setEndDate(today);
  }

  // Export to CSV with UTF-8 BOM
  function exportToCsv() {
    if (!summaryData) return;

    const escapeCell = (val) => {
      const s = String(val === null || val === undefined ? "" : val);
      return `"${s.replace(/"/g, '""')}"`;
    };

    let csv = "\uFEFF"; // UTF-8 BOM for Microsoft Excel

    if (mode === "day") {
      csv += `${escapeCell("รายงาน")},${escapeCell("สรุปยอดการชำระเงินรายวัน")}\n`;
      csv += `${escapeCell("วันปฏิบัติการ")},${escapeCell(summaryData.date || selectedDate)}\n`;
      csv += `${escapeCell("อ้างอิงตั๋ววันที่")},${escapeCell(summaryData.sourceDate || "-")}\n`;
      csv += `${escapeCell("เวลาที่บันทึกข้อมูลล่าสุด")},${escapeCell(summaryData.latestRecordedAt || "-")}\n`;
      csv += `\n`;

      csv += [
        escapeCell("ลำดับ"),
        escapeCell("รหัสสัญญา"),
        escapeCell("ชื่อลูกค้า"),
        escapeCell("จองตามสัญญา (ช่อง)"),
        escapeCell("จ่ายจริง (ใบ)"),
        escapeCell("ส่วนเกิน / ตีเบิ้ล (ใบ)"),
        escapeCell("ไม่ได้ใช้สิทธิ์ (ช่อง)"),
        escapeCell("ขอด่วน (ช่อง)"),
        escapeCell("% การจ่ายจริง"),
        escapeCell("สถานะ"),
      ].join(",") + "\n";

      rows.forEach((r, idx) => {
        const statusText = (r.surplus || 0) > 0 ? "เงินรับส่วนเกิน" : (r.shortfall || 0) > 0 ? "รอตรวจยอดชำระ" : "กระทบยอดลงตัว";
        csv += [
          escapeCell(idx + 1),
          escapeCell(r.docId),
          escapeCell(r.customerName),
          escapeCell(r.booked),
          escapeCell(r.paid),
          escapeCell(r.surplus || 0),
          escapeCell(r.shortfall),
          escapeCell(r.urgent),
          escapeCell(`${((r.pct || 0) * 100).toFixed(1)}%`),
          escapeCell(statusText),
        ].join(",") + "\n";
      });

      // Total row
      const overallStatus = (totals.totalSurplus || 0) > 0 && totals.totalShortfall > 0 ? "มีทั้งขาดและเกิน" : (totals.totalSurplus || 0) > 0 ? "มีเงินส่วนเกิน" : totals.totalShortfall > 0 ? "รอตรวจยอดชำระ" : "กระทบยอดลงตัว";
      csv += [
        escapeCell("รวมทั้งหมด"),
        escapeCell(`ลูกค้า ${totals.customerCount} ราย`),
        escapeCell(""),
        escapeCell(totals.totalBooked),
        escapeCell(totals.totalPaid),
        escapeCell(totals.totalSurplus || 0),
        escapeCell(totals.totalShortfall),
        escapeCell(totals.totalUrgent),
        escapeCell(`${((totals.overallPct || 0) * 100).toFixed(1)}%`),
        escapeCell(overallStatus),
      ].join(",") + "\n";

      const filename = `สรุปยอดการชำระเงิน_${summaryData.date || selectedDate}.csv`;
      downloadBlob(csv, filename);
    } else {
      // Range mode
      csv += `${escapeCell("รายงาน")},${escapeCell("สรุปยอดการชำระเงินตามช่วงวันที่")}\n`;
      csv += `${escapeCell("ช่วงวันที่")},${escapeCell(`${summaryData.startDate || startDate} ถึง ${summaryData.endDate || endDate}`)}\n`;
      csv += `${escapeCell("จำนวนวันที่มีข้อมูล")},${escapeCell(totals.daysInRange || 0)}\n`;
      csv += `\n`;

      csv += `${escapeCell("--- ส่วนที่ 1: สรุปรวมรายลูกค้า (ตลอดช่วงเวลา) ---")}\n`;
      csv += [
        escapeCell("ลำดับ"),
        escapeCell("รหัสสัญญา"),
        escapeCell("ชื่อลูกค้า"),
        escapeCell("จำนวนวันที่จอง (วัน)"),
        escapeCell("จองรวมทั้งช่วง (ช่อง)"),
        escapeCell("จ่ายจริงรวม (ใบ)"),
        escapeCell("ส่วนเกิน / ตีเบิ้ลรวม (ใบ)"),
        escapeCell("ไม่ได้ใช้สิทธิ์รวม (ช่อง)"),
        escapeCell("ขอด่วนรวม (ช่อง)"),
        escapeCell("% การจ่ายจริงเฉลี่ย"),
      ].join(",") + "\n";

      rows.forEach((r, idx) => {
        csv += [
          escapeCell(idx + 1),
          escapeCell(r.docId),
          escapeCell(r.customerName),
          escapeCell(r.daysCount || 1),
          escapeCell(r.booked),
          escapeCell(r.paid),
          escapeCell(r.surplus || 0),
          escapeCell(r.shortfall),
          escapeCell(r.urgent),
          escapeCell(`${((r.pct || 0) * 100).toFixed(1)}%`),
        ].join(",") + "\n";
      });

      // Total row for summary
      csv += [
        escapeCell("รวมทั้งหมด"),
        escapeCell(`ลูกค้า ${totals.customerCount} ราย`),
        escapeCell(""),
        escapeCell(`รวม ${totals.daysInRange || 0} วัน`),
        escapeCell(totals.totalBooked),
        escapeCell(totals.totalPaid),
        escapeCell(totals.totalSurplus || 0),
        escapeCell(totals.totalShortfall),
        escapeCell(totals.totalUrgent),
        escapeCell(`${((totals.overallPct || 0) * 100).toFixed(1)}%`),
      ].join(",") + "\n";

      csv += `\n\n`;
      csv += `${escapeCell("--- ส่วนที่ 2: รายละเอียดแจงรายวัน (Daily Breakdown) ---")}\n`;
      csv += [
        escapeCell("วันที่"),
        escapeCell("รหัสสัญญา"),
        escapeCell("ชื่อลูกค้า"),
        escapeCell("จองตามสัญญา (ช่อง)"),
        escapeCell("จ่ายจริง (ใบ)"),
        escapeCell("ส่วนเกิน / ตีเบิ้ล (ใบ)"),
        escapeCell("ไม่ได้ใช้สิทธิ์ (ช่อง)"),
        escapeCell("ขอด่วน (ช่อง)"),
        escapeCell("% การจ่ายจริง"),
        escapeCell("สถานะ"),
      ].join(",") + "\n";

      (summaryData.dailyBreakdown || []).forEach((r) => {
        const statusText = (r.surplus || 0) > 0 ? "เงินรับส่วนเกิน" : (r.shortfall || 0) > 0 ? "รอตรวจยอดชำระ" : "กระทบยอดลงตัว";
        csv += [
          escapeCell(r.date),
          escapeCell(r.docId),
          escapeCell(r.customerName),
          escapeCell(r.booked),
          escapeCell(r.paid),
          escapeCell(r.surplus || 0),
          escapeCell(r.shortfall),
          escapeCell(r.urgent),
          escapeCell(`${((r.pct || 0) * 100).toFixed(1)}%`),
          escapeCell(statusText),
        ].join(",") + "\n";
      });

      const filename = `สรุปยอดการชำระเงิน_${summaryData.startDate || startDate}_ถึง_${summaryData.endDate || endDate}.csv`;
      downloadBlob(csv, filename);
    }
  }

  function downloadBlob(content, filename) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  if (authChecking) {
    return (
      <div className="page summary-container">
        <div className="card"><p className="subtitle">กำลังตรวจสอบสิทธิ์การใช้งาน...</p></div>
      </div>
    );
  }

  if (!user || user.role !== "Admin") {
    return (
      <div>
        <div className="top-bar">
          <div className="inner">
            <h1>👥 สรุปพฤติกรรมลูกค้า</h1>
            <Link href="/" className="back">← กลับหน้าหลัก</Link>
          </div>
        </div>
        <div className="page summary-container">
          <div className="card alert alert-error">
            <strong>ไม่มีสิทธิ์เข้าถึง:</strong> หน้านี้เปิดให้เฉพาะผู้ดูแลระบบ (Admin) ใช้งานเท่านั้น
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="top-bar no-print">
        <div className="inner top-bar-wide">
          <div>
            <h1>👥 สรุปพฤติกรรมลูกค้า</h1>
            <span className="top-bar-sub">Customer Payment & Utilization Summary</span>
          </div>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>

      <div className="page summary-container no-print">
        {error && <div className="alert alert-error">{error}</div>}

        {/* Filter Controls Card */}
        <div className="card filter-card no-print">
          <div className="filter-header">
            <span className="filter-title">🔍 ตัวกรองการแสดงผล</span>
            <div className="mode-toggle">
              <button
                type="button"
                className={`btn btn-sm ${mode === "day" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setMode("day")}
              >
                📅 รายวัน
              </button>
              <button
                type="button"
                className={`btn btn-sm ${mode === "range" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setMode("range")}
              >
                📊 ช่วงหลายวัน (Range)
              </button>
            </div>
          </div>

          <div className="filter-inputs">
            {mode === "day" ? (
              <div className="input-group">
                <label>เลือกวันที่ปฏิบัติการ:</label>
                <div className="input-row">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSelectedDate(getTodayIso())}
                  >
                    วันนี้
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSelectedDate(getDaysAgoIso(1))}
                  >
                    เมื่อวาน
                  </button>
                </div>
              </div>
            ) : (
              <div className="input-group range-group">
                <div>
                  <label>จากวันที่:</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label>ถึงวันที่:</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
                <div className="preset-buttons">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={setRange7Days}>
                    7 วันล่าสุด
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={setRange30Days}>
                    30 วันล่าสุด
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={setRangeThisMonth}>
                    เดือนนี้
                  </button>
                </div>
              </div>
            )}

            <div className="action-buttons">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={loadData}
              >
                {loading ? "กำลังโหลด..." : "↻ รีเฟรช"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-excel"
                disabled={loading || rows.length === 0}
                onClick={exportToCsv}
              >
                📥 ส่งออก Excel
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || dailyPrintPages.length === 0}
                onClick={handlePrint}
              >
                🖨 พิมพ์ / PDF ({dailyPrintPages.length || 1} แผ่น)
              </button>
            </div>
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">จองตามสัญญา</span>
            <span className="kpi-value">{totals.totalBooked} <small>ช่อง</small></span>
            <span className="kpi-sub">จากลูกค้า {totals.customerCount} ราย</span>
          </div>

          <div className="kpi-card kpi-paid">
            <span className="kpi-label">จ่ายจริง / มีสิทธิ์</span>
            <span className="kpi-value">{totals.totalPaid} <small>ใบ</small></span>
            <span className="kpi-sub">รวมตั๋วที่ชำระจริง</span>
          </div>

          <div
            className="kpi-card kpi-surplus"
            style={{ cursor: (totals.totalSurplus || 0) > 0 ? "pointer" : "default" }}
            onClick={() => { if ((totals.totalSurplus || 0) > 0) setStatusFilter("surplus"); }}
            title={(totals.totalSurplus || 0) > 0 ? "คลิกเพื่อกรองดูเฉพาะรายที่จ่ายเกิน" : ""}
          >
            <span className="kpi-label">ส่วนเกิน / ตีเบิ้ล</span>
            <span className="kpi-value" style={{ color: "#0284c7" }}>{totals.totalSurplus || 0} <small>ใบ</small></span>
            <span className="kpi-sub">
              {(totals.totalSurplus || 0) > 0 ? "คลิกเพื่อกรองดูเฉพาะรายที่จ่ายเกิน" : "จ่ายเกินจำนวนที่จอง"}
            </span>
          </div>

          <div
            className="kpi-card kpi-shortfall"
            style={{ cursor: (totals.totalShortfall || 0) > 0 ? "pointer" : "default" }}
            onClick={() => { if ((totals.totalShortfall || 0) > 0) setStatusFilter("shortfall"); }}
            title={(totals.totalShortfall || 0) > 0 ? "คลิกเพื่อกรองดูเฉพาะรายที่ขาดชำระ" : ""}
          >
            <span className="kpi-label">ไม่ได้ใช้สิทธิ์</span>
            <span className="kpi-value">{totals.totalShortfall} <small>ช่อง</small></span>
            <span className="kpi-sub">
              {(totals.totalShortfall || 0) > 0 ? "คลิกเพื่อกรองดูเฉพาะรายที่ขาดชำระ" : "ไม่มีการชำระเงิน"}
            </span>
          </div>

          <div className="kpi-card kpi-urgent">
            <span className="kpi-label">ขอด่วนพิเศษ</span>
            <span className="kpi-value">{totals.totalUrgent} <small>ช่อง</small></span>
            <span className="kpi-sub">รายการเร่งด่วนรายวัน</span>
          </div>

          <div className="kpi-card kpi-pct">
            <span className="kpi-label">% การจ่ายจริงเฉลี่ย</span>
            <span className="kpi-value">{((totals.overallPct || 0) * 100).toFixed(1)}%</span>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, (totals.overallPct || 0) * 100))}%` }}
              />
            </div>
          </div>
        </div>

        {/* Data Table Section */}
        <div className="card table-card">
          <div className="table-header-bar no-print">
            <div className="table-title">
              <strong>📋 รายละเอียดแยกตามรายชื่อลูกค้า ({rows.length} ราย)</strong>
              {mode === "range" && (
                <span className="range-badge">สรุปรวมทั้งช่วงเวลา ({totals.daysInRange || 0} วัน)</span>
              )}
            </div>
            <div className="table-search" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  width: "auto",
                  fontSize: 13,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "white",
                  color: "#334155",
                  fontWeight: 600,
                }}
              >
                <option value="all">สถานะทั้งหมด</option>
                <option value="balanced">กระทบยอดลงตัว</option>
                <option value="surplus">เงินรับส่วนเกิน</option>
                <option value="shortfall">รอตรวจยอดชำระ</option>
              </select>

              <input
                type="text"
                placeholder="🔍 ค้นหาชื่อ หรือ รหัสสัญญา..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="empty-state">
              <p>⏳ กำลังโหลดข้อมูลสรุปการชำระเงิน...</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <p>📭 ไม่พบข้อมูลสำหรับวันที่หรือช่วงเวลาที่เลือก</p>
              <small className="help-text">
                {mode === "day"
                  ? `ระบบจะประมวลผลสรุปยอดอัตโนมัติทุกวันเวลา 00:05 น. หรือหากเพิ่งคีย์ข้อมูลใหม่ ท่านสามารถกดปุ่ม "อัปเดตข้อมูลใหม่" บนหน้าบอร์ดติดตามสถานะได้ครับ`
                  : `ไม่มีข้อมูลการจองหรือการชำระเงินในช่วงวันที่ดังกล่าว`}
              </small>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: "50px", textAlign: "center" }}>#</th>
                    <th style={{ width: "90px" }}>รหัสสัญญา</th>
                    <th>ชื่อลูกค้า</th>
                    {mode === "range" && (
                      <th style={{ width: "110px", textAlign: "center" }}>วันที่มีจอง</th>
                    )}
                    <th style={{ width: "120px", textAlign: "right" }}>จองตามสัญญา</th>
                    <th style={{ width: "110px", textAlign: "right" }}>จ่ายจริง</th>
                    <th style={{ width: "120px", textAlign: "right" }}>ส่วนเกิน / ตีเบิ้ล</th>
                    <th style={{ width: "120px", textAlign: "right" }}>ไม่ได้ใช้สิทธิ์</th>
                    <th style={{ width: "100px", textAlign: "right" }}>ขอด่วน</th>
                    <th style={{ width: "110px", textAlign: "center" }}>% การจ่ายจริง</th>
                    <th style={{ width: "120px", textAlign: "center" }}>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const pctVal = Math.round((r.pct || 0) * 100);
                    let badgeClass = "badge-red";
                    if (pctVal >= 100) badgeClass = "badge-green";
                    else if (pctVal >= 80) badgeClass = "badge-orange";

                    return (
                      <tr key={r.docId || idx}>
                        <td style={{ textAlign: "center" }}>{idx + 1}</td>
                        <td><strong>{r.docId}</strong></td>
                        <td>{r.customerName}</td>
                        {mode === "range" && (
                          <td style={{ textAlign: "center" }}>{r.daysCount || 1} วัน</td>
                        )}
                        <td style={{ textAlign: "right" }}>{r.booked}</td>
                        <td style={{ textAlign: "right", color: "#2e7d32", fontWeight: "600" }}>{r.paid}</td>
                        <td style={{ textAlign: "right", color: (r.surplus || 0) > 0 ? "#0284c7" : "#9e9e9e", fontWeight: (r.surplus || 0) > 0 ? "700" : "400" }}>
                          {(r.surplus || 0) > 0 ? `+${r.surplus}` : 0}
                        </td>
                        <td style={{ textAlign: "right", color: r.shortfall > 0 ? "#c62828" : "#9e9e9e", fontWeight: r.shortfall > 0 ? "700" : "400" }}>
                          {r.shortfall > 0 ? `-${r.shortfall}` : 0}
                        </td>
                        <td style={{ textAlign: "right" }}>{r.urgent}</td>
                        <td style={{ textAlign: "center" }}>
                          <span className={`pct-badge ${badgeClass}`}>{pctVal}%</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {(r.surplus || 0) > 0 ? (
                            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#e0f2fe", color: "#0369a1" }}>
                              เงินรับส่วนเกิน
                            </span>
                          ) : (r.shortfall || 0) > 0 ? (
                            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#fee2e2", color: "#991b1b" }}>
                              รอตรวจยอดชำระ
                            </span>
                          ) : (
                            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#dcfce7", color: "#15803d" }}>
                              กระทบยอดลงตัว
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="summary-foot">
                    <td colSpan={mode === "range" ? 4 : 3} style={{ textAlign: "right", fontWeight: "bold" }}>
                      รวมทั้งหมด (ลูกค้า {totals.customerCount} ราย):
                    </td>
                    <td style={{ textAlign: "right", fontWeight: "bold" }}>{totals.totalBooked}</td>
                    <td style={{ textAlign: "right", fontWeight: "bold", color: "#2e7d32" }}>{totals.totalPaid}</td>
                    <td style={{ textAlign: "right", fontWeight: "bold", color: (totals.totalSurplus || 0) > 0 ? "#0284c7" : "#9e9e9e" }}>
                      {totals.totalSurplus || 0}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: "bold", color: totals.totalShortfall > 0 ? "#c62828" : "#9e9e9e" }}>
                      {totals.totalShortfall}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: "bold" }}>{totals.totalUrgent}</td>
                    <td style={{ textAlign: "center", fontWeight: "bold" }}>
                      <span className="pct-badge badge-foot">
                        {((totals.overallPct || 0) * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td style={{ textAlign: "center", fontWeight: "bold" }}>
                      {(totals.totalSurplus || 0) > 0 && totals.totalShortfall > 0 ? (
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#f1f5f9", color: "#475569" }}>
                          มีทั้งขาดและเกิน
                        </span>
                      ) : (totals.totalSurplus || 0) > 0 ? (
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#e0f2fe", color: "#0369a1" }}>
                          มีเงินส่วนเกิน
                        </span>
                      ) : totals.totalShortfall > 0 ? (
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#fee2e2", color: "#991b1b" }}>
                          รอตรวจยอดชำระ
                        </span>
                      ) : (
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "#dcfce7", color: "#15803d" }}>
                          กระทบยอดลงตัว
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Timestamp footer */}
          <div className="data-meta-bar">
            <span>
              ⏱️ {mode === "day"
                ? `ข้อมูล ณ เวลา: ${summaryData?.latestRecordedAt || "-"} · อ้างอิงตั๋ววันที่: ${formatThaiDate(summaryData?.sourceDate)}`
                : `ข้อมูลช่วง: ${formatThaiDate(summaryData?.startDate)} ถึง ${formatThaiDate(summaryData?.endDate)} · สรุปความถี่ ${totals.daysInRange || 0} วัน`}
            </span>
          </div>
        </div>
      </div>

      {/* โซนสำหรับสั่งพิมพ์ / Export PDF แนวนอน (แยก 1 แผ่นต่อ 1 วัน) */}
      <div className="print-only summary-print-container">
        {dailyPrintPages.map((page, pageIdx) => {
          const dayPct = page.dayTotals.booked > 0 ? ((page.dayTotals.paid / page.dayTotals.booked) * 100).toFixed(1) : "100.0";
          return (
            <div
              key={page.date}
              className="summary-print-sheet"
              style={{
                pageBreakAfter: pageIdx < dailyPrintPages.length - 1 ? "always" : "auto",
                breakAfter: pageIdx < dailyPrintPages.length - 1 ? "page" : "auto",
              }}
            >
              <div className="summary-print-header">
                <div>
                  <h2>รายงานสรุปพฤติกรรมลูกค้าและการใช้สิทธิ์ประจำวัน — วันปฏิบัติการ: {formatThaiDate(page.date)}</h2>
                  <p>
                    ลูกค้าทั้งหมด {page.items.length} ราย · จองตามสัญญา {page.dayTotals.booked} ช่อง · จ่ายจริง {page.dayTotals.paid} ใบ · อัตราจ่ายจริง {dayPct}%
                  </p>
                </div>
                <div style={{ textAlign: "right", fontSize: "8.5pt", color: "#334155" }}>
                  <div>แผ่นที่ {pageIdx + 1} / {dailyPrintPages.length}</div>
                  <div>ระบบจองที่จอดรถเรียงสินค้า</div>
                </div>
              </div>

              <div className="summary-print-kpis">
                <div className="summary-print-kpi">
                  <span>จองตามสัญญา:</span> <strong>{page.dayTotals.booked} ช่อง</strong>
                </div>
                <div className="summary-print-kpi">
                  <span>จ่ายจริง / มีสิทธิ์:</span> <strong>{page.dayTotals.paid} ใบ</strong>
                </div>
                <div className="summary-print-kpi">
                  <span>ส่วนเกิน / ตีเบิ้ล:</span> <strong>+{page.dayTotals.surplus} ใบ</strong>
                </div>
                <div className="summary-print-kpi">
                  <span>ไม่ได้ใช้สิทธิ์:</span> <strong>-{page.dayTotals.shortfall} ช่อง</strong>
                </div>
                <div className="summary-print-kpi">
                  <span>ขอด่วน / % จ่ายจริง:</span> <strong>{page.dayTotals.urgent} ช่อง ({dayPct}%)</strong>
                </div>
              </div>

              <div className="summary-print-two-cols">
                {[
                  { list: page.leftItems, offset: 0 },
                  { list: page.rightItems, offset: page.mid },
                ].map((col, colIdx) => (
                  <table key={colIdx} className="summary-print-table">
                    <thead>
                      <tr>
                        <th style={{ width: "22px" }}>#</th>
                        <th style={{ width: "36px" }}>รหัส</th>
                        <th style={{ textAlign: "left" }}>ชื่อลูกค้า</th>
                        <th style={{ width: "36px" }}>จอง</th>
                        <th style={{ width: "36px" }}>จ่าย</th>
                        <th style={{ width: "42px" }}>ส่วนเกิน</th>
                        <th style={{ width: "42px" }}>ขาด</th>
                        <th style={{ width: "34px" }}>ด่วน</th>
                        <th style={{ width: "42px" }}>% จ่าย</th>
                        <th style={{ width: "70px" }}>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {col.list.map((r, idx) => {
                        const pctVal = Math.round((r.pct || 0) * 100);
                        const statusLabel = (r.surplus || 0) > 0 ? "เงินรับส่วนเกิน" : (r.shortfall || 0) > 0 ? "รอตรวจยอดชำระ" : "กระทบยอดลงตัว";
                        return (
                          <tr key={`${r.docId}-${idx}`}>
                            <td style={{ textAlign: "center" }}>{col.offset + idx + 1}</td>
                            <td style={{ textAlign: "center", fontWeight: 700 }}>{r.docId}</td>
                            <td style={{ textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "130px" }}>
                              {r.customerName}
                            </td>
                            <td style={{ textAlign: "right" }}>{r.booked}</td>
                            <td style={{ textAlign: "right", fontWeight: 700 }}>{r.paid}</td>
                            <td style={{ textAlign: "right", fontWeight: (r.surplus || 0) > 0 ? 700 : 400 }}>
                              {(r.surplus || 0) > 0 ? `+${r.surplus}` : 0}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: r.shortfall > 0 ? 700 : 400 }}>
                              {r.shortfall > 0 ? `-${r.shortfall}` : 0}
                            </td>
                            <td style={{ textAlign: "right" }}>{r.urgent || 0}</td>
                            <td style={{ textAlign: "right" }}>{pctVal}%</td>
                            <td style={{ textAlign: "center", fontWeight: 600 }}>{statusLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ))}
              </div>

              <div className="summary-print-footer">
                <strong>รวมประจำวันปฏิบัติการ {formatThaiDate(page.date)} ({page.items.length} ราย):</strong>{" "}
                จองตามสัญญา {page.dayTotals.booked} ช่อง | จ่ายจริง {page.dayTotals.paid} ใบ | ส่วนเกิน +{page.dayTotals.surplus} ใบ | ไม่ได้ใช้สิทธิ์ -{page.dayTotals.shortfall} ช่อง | ขอด่วน {page.dayTotals.urgent} ช่อง | อัตราการจ่ายจริง {dayPct}%
              </div>
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .summary-container {
          max-width: 1200px;
          margin: 0 auto;
        }
        .top-bar-wide {
          max-width: 1200px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .top-bar-sub {
          font-size: 13px;
          color: #fecaca;
          display: block;
          margin-top: 2px;
        }
        .filter-card {
          margin-bottom: 20px;
        }
        .filter-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border);
        }
        .filter-title {
          font-weight: 700;
          font-size: 16px;
          color: var(--navy);
        }
        .mode-toggle {
          display: flex;
          gap: 8px;
        }
        .btn-sm {
          padding: 6px 12px;
          font-size: 14px;
        }
        .filter-inputs {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
        }
        .input-group label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--gray);
          margin-bottom: 6px;
        }
        .input-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .input-row input[type="date"],
        .range-group input[type="date"] {
          padding: 8px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 14px;
        }
        .range-group {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 12px;
        }
        .preset-buttons {
          display: flex;
          gap: 6px;
        }
        .action-buttons {
          display: flex;
          gap: 8px;
        }
        .btn-excel {
          background-color: #107c41;
          color: white;
          border-color: #107c41;
        }
        .btn-excel:hover {
          background-color: #0c5e31;
        }

        /* KPI Grid */
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
          margin-bottom: 20px;
        }
        .kpi-card {
          background: white;
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }
        .kpi-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--gray);
          margin-bottom: 4px;
        }
        .kpi-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--text);
        }
        .kpi-value small {
          font-size: 14px;
          font-weight: 400;
          color: var(--gray);
        }
        .kpi-sub {
          font-size: 12px;
          color: #8c9ba5;
          margin-top: 4px;
        }
        .kpi-paid .kpi-value { color: #2e7d32; }
        .kpi-shortfall .kpi-value { color: #c62828; }
        .kpi-urgent .kpi-value { color: #e67e22; }
        .kpi-pct .kpi-value { color: var(--navy); }

        .progress-bar-bg {
          height: 6px;
          background: #e5e7eb;
          border-radius: 3px;
          margin-top: 8px;
          overflow: hidden;
        }
        .progress-bar-fill {
          height: 100%;
          background: var(--navy);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        /* Table Card */
        .table-card {
          padding: 0;
          overflow: hidden;
        }
        .table-header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
        }
        .table-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .range-badge {
          background: #eff6ff;
          color: #1d4ed8;
          font-size: 12px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid #bfdbfe;
        }
        .table-search input {
          padding: 6px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 13px;
          min-width: 220px;
        }
        .data-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
        }
        .data-table th {
          background: #f8fafc;
          padding: 12px 14px;
          color: var(--gray);
          font-weight: 600;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        .data-table td {
          padding: 12px 14px;
          border-bottom: 1px solid #f1f5f9;
        }
        .data-table tbody tr:hover {
          background: #fdfaf7;
        }
        .summary-foot {
          background: #f8fafc;
          font-size: 14px;
          border-top: 2px solid var(--border);
        }
        .summary-foot td {
          padding: 14px;
        }

        /* Badges */
        .pct-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 12px;
          font-weight: 600;
          font-size: 13px;
        }
        .badge-green {
          background: #e8f5e9;
          color: #2e7d32;
        }
        .badge-orange {
          background: #fff3e0;
          color: #ef6c00;
        }
        .badge-red {
          background: #ffebee;
          color: #c62828;
        }
        .badge-foot {
          background: var(--navy);
          color: white;
        }

        .empty-state {
          padding: 40px 20px;
          text-align: center;
          color: var(--gray);
        }
        .empty-state p {
          font-size: 16px;
          margin-bottom: 8px;
        }
        .help-text {
          font-size: 13px;
          color: #94a3b8;
          max-width: 500px;
          display: inline-block;
        }

        .data-meta-bar {
          padding: 10px 20px;
          background: #f8fafc;
          border-top: 1px solid var(--border);
          font-size: 12px;
          color: #64748b;
        }

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
          .summary-print-sheet {
            width: 100%;
            box-sizing: border-box;
            font-family: "Sarabun", "Tahoma", sans-serif;
            color: #000;
          }
          .summary-print-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-bottom: 1.5px solid #0f172a;
            padding-bottom: 3px;
            margin-bottom: 4px;
          }
          .summary-print-header h2 {
            margin: 0;
            font-size: 11.5pt;
            font-weight: 700;
            color: #0f172a;
          }
          .summary-print-header p {
            margin: 1px 0 0;
            font-size: 8.5pt;
            color: #334155;
          }
          .summary-print-kpis {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 4px;
            margin-bottom: 5px;
          }
          .summary-print-kpi {
            border: 1px solid #cbd5e1;
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 8pt;
            background: #f8fafc;
          }
          .summary-print-two-cols {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            align-items: start;
          }
          .summary-print-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 7.2pt;
            font-variant-numeric: tabular-nums;
          }
          .summary-print-table th,
          .summary-print-table td {
            border: 1px solid #cbd5e1;
            padding: 1.5px 3px;
            text-align: center;
            line-height: 1.15;
          }
          .summary-print-table th {
            background: #e2e8f0 !important;
            font-weight: 700;
            color: #0f172a;
          }
          .summary-print-footer {
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
