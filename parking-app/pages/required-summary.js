import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import CustomerPicker from "../components/CustomerPicker";
import { displayCustomerName, displayLotName } from "../lib/display";
import { getBangkokCalendarDateIso } from "../lib/operational-day";

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("th-TH").format(Number(value) || 0)} บาท`;
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function TicketTotals({ report, showAmounts = false }) {
  const ticketText = (count, amount) => showAmounts ? `${count || 0} ใบ · ${formatMoney(amount)}` : `${count || 0} ใบ`;
  return <div className="report-totals">
    <div className="report-total"><small>ตั๋วจองระยะยาว</small><strong>{ticketText(report.longTickets, report.longAmount)}</strong></div>
    <div className="report-total"><small>ตั๋วจองรายวัน</small><strong>{ticketText(report.dailyTickets, report.dailyAmount)}</strong></div>
    <div className="report-total"><small>{showAmounts ? "รวมตั๋วและค่าบริการ" : "รวมตั๋วที่ต้องตีวันนี้"}</small><strong>{ticketText(report.totalTickets, report.totalAmount)}</strong></div>
  </div>;
}

export default function RequiredSummary() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(getBangkokCalendarDateIso());
  const [tab, setTab] = useState("overview");
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printUserName, setPrintUserName] = useState("");
  const [printedAt, setPrintedAt] = useState("");

  async function loadReport(date, selectedCustomer = "") {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ date });
      if (selectedCustomer) query.set("customer", selectedCustomer);
      const response = await fetch(`/api/required-summary?${query.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการคำนวณรายการตั๋ว");
      setReport(data); setSelectedDate(data.selectedDate || date);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    loadReport(selectedDate);
    fetch("/api/master").then((response) => response.ok ? response.json() : []).then((data) => setCustomers(Array.isArray(data) ? data : []));
    fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then((data) => setPrintUserName(data?.user?.name || ""));
  }, []);

  useEffect(() => {
    if (!router.isReady || typeof router.query.customer !== "string") return;
    setCustomer(router.query.customer);
    setTab("customer");
    loadReport(selectedDate, router.query.customer);
  }, [router.isReady, router.query.customer]);

  function updateDate(value) {
    if (!value) return;
    setSelectedDate(value);
    loadReport(value, tab === "customer" ? customer : "");
  }

  function chooseCustomer(name) {
    setCustomer(name);
    if (name) loadReport(selectedDate, name);
  }

  function printCustomerReport() {
    setPrintedAt(new Date().toISOString());
    window.setTimeout(() => window.print(), 100);
  }

  const rows = report?.rows || [];
  const overviewTotals = rows.reduce((total, row) => ({
    longTickets: total.longTickets + Number(row.longTickets || 0),
    dailyTickets: total.dailyTickets + Number(row.dailyTickets || 0),
    totalTickets: total.totalTickets + Number(row.totalTickets || 0),
  }), { longTickets: 0, dailyTickets: 0, totalTickets: 0 });
  const customerReport = report?.customerReport;

  return <div>
    <div className="top-bar no-print"><div className="inner"><h1>สรุปรายการตีตั๋ว</h1><Link href="/" className="back">← กลับหน้าหลัก</Link></div></div>
    <main className="page report-page">
      <h2 className="no-print">สรุปรายการตีตั๋ว</h2>
      <p className="subtitle no-print">ดูภาพรวมตั๋วที่ต้องตีวันนี้ หรือพิมพ์สรุปรายการของลูกค้าแต่ละราย</p>
      <div className="report-tabs no-print">
        <button type="button" className={`btn ${tab === "overview" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setTab("overview"); loadReport(selectedDate); }}>ภาพรวมตั๋วที่ต้องตี</button>
        <button type="button" className={`btn ${tab === "customer" ? "btn-primary" : "btn-secondary"}`} onClick={() => { setTab("customer"); if (customer) loadReport(selectedDate, customer); }}>สรุปรายการลูกค้า</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {tab === "overview" ? <>
        <div className="card no-print"><label>วันที่ออกตั๋ว</label><input type="date" value={selectedDate} onChange={(event) => updateDate(event.target.value)} disabled={loading} /></div>
        {loading ? <div className="card"><p className="subtitle">กำลังคำนวณรายการตั๋ว...</p></div> : <div className="card">
          <h2>รายการตั๋วที่ต้องตี วันที่ {formatDate(selectedDate)}</h2>
          <p className="report-lead">ตั๋วจองระยะยาว: ตั๋วที่ต้องตีวันนี้ สำหรับสิทธิ์วันที่ {formatDate(report?.nextOperationalDate)}</p>
          <p className="report-note">ตั๋วจองรายวัน: ตั๋วที่ใช้ภายในวันที่ {formatDate(selectedDate)}</p>
          <TicketTotals report={overviewTotals} />
          {rows.length === 0 ? <div className="alert alert-warning">ไม่มีรายการตั๋วที่ต้องตีในวันนี้</div> : <div className="table-container"><table className="data-table"><thead><tr><th>ลูกค้า</th><th style={{ textAlign: "center" }}>ตั๋วจองระยะยาว</th><th style={{ textAlign: "center" }}>ตั๋วจองรายวัน</th><th style={{ textAlign: "center" }}>รวมตั๋วที่ต้องตีวันนี้</th></tr></thead><tbody>{rows.map((row) => <tr key={row.docId || row.customer}><td>{displayCustomerName(row.name || row.customer)}</td><td style={{ textAlign: "center" }}>{row.longTickets}</td><td style={{ textAlign: "center" }}>{row.dailyTickets}</td><td style={{ textAlign: "center" }}><span className="ticket-badge">{row.totalTickets}</span></td></tr>)}</tbody></table></div>}
          <div className="btn-row no-print"><button type="button" className="btn btn-secondary" onClick={() => window.print()}>พิมพ์ภาพรวม</button><button type="button" className="btn btn-secondary" onClick={() => loadReport(selectedDate)}>↻ อัปเดตรายการ</button></div>
        </div>}
      </> : <>
        <div className="card no-print"><label>วันที่ออกตั๋ว</label><input type="date" value={selectedDate} onChange={(event) => updateDate(event.target.value)} disabled={loading} /><CustomerPicker customers={customers} value={customer} onChange={chooseCustomer} label="ระบุชื่อลูกค้า" /></div>
        {!customer ? <div className="card"><p className="subtitle">ระบุชื่อลูกค้าเพื่อดูและพิมพ์สรุปรายการ</p></div> : loading ? <div className="card"><p className="subtitle">กำลังคำนวณรายการของลูกค้า...</p></div> : <div className="card">
          <h2>สรุปรายการของลูกค้า</h2>
          <p className="report-lead">ลูกค้า: {displayCustomerName(customer)}</p>
          <p className="report-note">รายการตั๋วที่ต้องตี วันที่ {formatDate(selectedDate)}</p>
          <TicketTotals report={customerReport || {}} showAmounts />
          <div className="ticket-payment-notes"><p><strong>ตั๋วจองระยะยาว:</strong> ชำระก่อน 23:59</p><p><strong>ตั๋วจองรายวัน:</strong> ชำระก่อนเวลาเริ่มรอบ</p></div>
          <section className="report-section"><h3>รายการจองระยะยาว</h3><p className="report-note">ตั๋วที่ต้องตีวันนี้ {customerReport?.longTickets || 0} ใบ สำหรับสิทธิ์วันที่ {formatDate(report?.nextOperationalDate)}</p>{(customerReport?.longGroups || []).length === 0 ? <p className="subtitle">ไม่มีรายการจองระยะยาวที่ยังมีผล</p> : <div className="table-container"><table className="data-table grouped-ticket-table"><thead><tr className="print-repeat-heading"><th colSpan="4">สรุปรายการของลูกค้า · {displayCustomerName(customer)}</th></tr><tr><th>ลาน / รอบ</th><th>ช่อง</th><th>ช่วงสิทธิ์</th><th>จำนวน</th></tr></thead><tbody>{customerReport.longGroups.map((group, index) => <tr key={`${group.lot}-${group.startTime}-${index}`}><td>{displayLotName(group.lot)}<br /><small>รอบ {group.startTime}</small></td><td>ช่อง {group.slots}</td><td>{formatDate(group.startDate)}–{formatDate(group.endDate)}{group.pausePeriods?.length ? <small className="pause-print-note">พักการจอง {group.pausePeriods.map((period) => `${formatDate(period.startDate)}–${formatDate(period.endDate)}`).join(", ")}</small> : null}</td><td style={{ textAlign: "center" }}>{group.ticketCount} ใบ</td></tr>)}</tbody></table></div>}</section>
          <section className="report-section"><h3>รายการจองรายวัน</h3><p className="report-note">ตั๋วที่ใช้ภายในวันที่ {formatDate(selectedDate)}: {customerReport?.dailyTickets || 0} ใบ</p>{(customerReport?.dailyGroups || []).length === 0 ? <p className="subtitle">ไม่มีรายการจองรายวันในวันนี้</p> : <div className="table-container"><table className="data-table grouped-ticket-table"><thead><tr className="print-repeat-heading"><th colSpan="4">สรุปรายการของลูกค้า · {displayCustomerName(customer)}</th></tr><tr><th>ลาน / รอบ</th><th>ช่อง</th><th>วันที่ใช้งาน</th><th>จำนวน</th></tr></thead><tbody>{customerReport.dailyGroups.map((group, index) => <tr key={`${group.lot}-${group.startTime}-${index}`}><td>{displayLotName(group.lot)}<br /><small>รอบ {group.startTime}</small></td><td>ช่อง {group.slots}</td><td>{formatDate(group.accessDate)}</td><td style={{ textAlign: "center" }}>{group.ticketCount} ใบ</td></tr>)}</tbody></table></div>}</section>
          <div className="report-print-meta print-only"><span>พิมพ์โดย: {printUserName || "-"}</span><span>พิมพ์เมื่อ: {formatDateTime(printedAt)}</span></div>
          <div className="btn-row no-print"><button type="button" className="btn btn-secondary" onClick={printCustomerReport}>พิมพ์เอกสารสรุป</button><button type="button" className="btn btn-secondary" onClick={() => loadReport(selectedDate, customer)}>↻ อัปเดตรายการ</button></div>
        </div>}
      </>}
    </main>
  </div>;
}
