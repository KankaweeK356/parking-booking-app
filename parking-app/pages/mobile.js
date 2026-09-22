import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MobileRoundSlotList from "../components/MobileRoundSlotList";
import { getBangkokCalendarDateIso, getCurrentOperationalDateIso } from "../lib/operational-day";
import { displayLotName } from "../lib/display";
import { getDashboardStatusCounts } from "../lib/timeline-status";

function today() { return getCurrentOperationalDateIso(); }

export default function MobileView() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState({ slots: [], bookings: [], unpaidBookings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLot, setSelectedLot] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retryingPayment, setRetryingPayment] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [canRetryPayment, setCanRetryPayment] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((response) => response.ok ? response.json() : null).then((result) => {
      setCanRetryPayment(["Admin", "Field"].includes(result?.user?.role));
    });
  }, []);

  // ตรวจสอบและนับถอยหลัง Cooldown 2 นาที (ซิงค์ทั้งจาก server และ localStorage)
  useEffect(() => {
    function checkCooldown() {
      const storedUntil = Number(localStorage.getItem("payment_cooldown_until") || 0);
      const serverAttemptTime = Date.parse(data.paymentUpdate?.refresh?.attemptedAt || 0);
      const serverUntil = data.paymentUpdate?.refresh?.status === "READY" ? serverAttemptTime + 120 * 1000 : 0;
      const effectiveUntil = Math.max(storedUntil, serverUntil);
      const remaining = Math.ceil((effectiveUntil - Date.now()) / 1000);
      if (remaining > 0) {
        setCooldownSeconds(remaining);
      } else {
        setCooldownSeconds(0);
        localStorage.removeItem("payment_cooldown_until");
      }
    }
    checkCooldown();
    const interval = window.setInterval(checkCooldown, 1000);
    return () => window.clearInterval(interval);
  }, [data.paymentUpdate]);

  useEffect(() => {
    loadData(selectedDate);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const currentDate = today();
      if (currentDate !== selectedDate) setSelectedDate(currentDate);
      else loadData(selectedDate, { silent: true });
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [selectedDate]);
  async function loadData(date, { silent = false, force = false } = {}) {
    if (!silent && !force) { setLoading(true); setError(""); }
    if (force) { setRefreshing(true); setError(""); }
    try {
      const url = `/api/dashboard?date=${encodeURIComponent(date)}${force ? "&force=true" : ""}`;
      const response = await fetch(url);
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch { throw new Error("โหลดข้อมูลไม่สำเร็จ กรุณารอสักครู่"); }
      if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่สำเร็จ");
      setData(result);
      setLastUpdated(new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date()));
      const availableLots = Array.from(new Set((result.slots || []).map((slot) => slot.lot).filter(Boolean))).sort();
      setSelectedLot((current) => availableLots.includes(current) ? current : availableLots[0] || "");
    } catch (err) { if (!silent || force) setError(err.message); } finally { if (!silent && !force) setLoading(false); if (force) setRefreshing(false); }
  }

  async function retryPaymentSnapshot() {
    if (cooldownSeconds > 0) return;
    setRetryingPayment(true);
    setError("");
    try {
      const response = await fetch(`/api/payment-snapshot?date=${encodeURIComponent(data.paymentUpdate?.date || getBangkokCalendarDateIso())}`, { method: "POST" });
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch { throw new Error("อัปเดตข้อมูลใหม่ไม่สำเร็จ กรุณารอสักครู่"); }
      if (!response.ok) {
        if (response.status === 429 && result.remainingSeconds) {
          const until = Date.now() + result.remainingSeconds * 1000;
          localStorage.setItem("payment_cooldown_until", String(until));
          setCooldownSeconds(result.remainingSeconds);
        }
        throw new Error(result.error || "อัปเดตข้อมูลใหม่ไม่สำเร็จ");
      }
      const until = Date.now() + 120 * 1000;
      localStorage.setItem("payment_cooldown_until", String(until));
      setCooldownSeconds(120);
      await loadData(selectedDate, { force: true });
    } catch (err) { setError(err.message); } finally { setRetryingPayment(false); }
  }

  const lots = useMemo(() => Array.from(new Set((data.slots || []).map((slot) => slot.lot).filter(Boolean))).sort(), [data.slots]);
  const slotsInLot = useMemo(() => (data.slots || []).filter((slot) => slot.lot === selectedLot), [data.slots, selectedLot]);
  const paidBookingsInLot = useMemo(() => (data.bookings || []).filter((booking) => booking.lot === selectedLot), [data.bookings, selectedLot]);
  const stats = useMemo(() => getDashboardStatusCounts({ slots: slotsInLot, bookings: paidBookingsInLot, currentBlockStartTime: data.currentBlock?.startTime, isLiveOperationalDate: data.isLiveOperationalDate }), [slotsInLot, paidBookingsInLot, data.currentBlock, data.isLiveOperationalDate]);
  const paymentUpdate = data.paymentUpdate;
  const paymentDateLabel = paymentUpdate?.date ? new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${paymentUpdate.date}T00:00:00Z`)) : "";
  const activeRound = data.currentBlock?.startTime || "07:00";
  const attentionCount = stats["ticket-check"] + stats.expired;

  return (
    <div>
      <div className="top-bar"><div className="inner"><h1>📱 ติดตามสถานะช่องจอด</h1><Link href="/" className="back">หน้าหลัก</Link></div></div>
      <div className="page timeline-page mobile-timeline-page">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card timeline-controls mobile-timeline-controls">
          <div><label>วันปฏิบัติการ</label><strong>{selectedDate} · 07:00–07:00</strong></div>
          <div><label>ลาน</label><div className="lot-buttons">{lots.map((lot) => <button key={lot} type="button" className={`btn ${selectedLot === lot ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedLot(lot)}>{displayLotName(lot)}</button>)}</div></div>
          <div>
            <label>&nbsp;</label>
            <div>
              <button
                type="button"
                className="btn btn-secondary refresh-button"
                disabled={loading || refreshing}
                onClick={() => loadData(selectedDate, { force: true })}
              >
                {refreshing ? "กำลังอัปเดต..." : "↻ อัปเดตสถานะล่าสุด"}
              </button>
            </div>
          </div>
        </div>
        {loading ? <div className="card"><p className="subtitle">กำลังโหลดสถานะช่องจอด...</p></div> : <>{paymentUpdate?.status !== "READY" && <div className="alert alert-warning">ข้อมูลสำหรับวันที่ {paymentDateLabel} ยังไม่พร้อม<br />โปรดรอ{canRetryPayment ? <>หรือกด <button type="button" className="btn btn-secondary refresh-button" disabled={retryingPayment || cooldownSeconds > 0} onClick={retryPaymentSnapshot}>{retryingPayment ? "กำลังอัปเดตข้อมูล..." : cooldownSeconds > 0 ? `ข้อมูลล่าสุดแล้ว (รอ ${Math.floor(cooldownSeconds / 60)}:${String(cooldownSeconds % 60).padStart(2, "0")})` : "อัปเดตข้อมูลใหม่"}</button></> : "ระบบกำลังอัปเดตข้อมูลอัตโนมัติ"}</div>}{data.paymentStatus === "UPDATING" ? <div className="card"><p className="subtitle">โปรดรอให้ข้อมูลพร้อมก่อนใช้สถานะช่องจอดตัดสินพื้นที่</p></div> : <><div className="dashboard-current-block">รอบปัจจุบัน: {data.currentBlock?.label || "-"}{lastUpdated ? ` · อัปเดต ${lastUpdated}` : ""}</div><p className="mobile-attention-count">ต้องตรวจ {attentionCount} ช่อง</p><MobileRoundSlotList slots={slotsInLot} bookings={paidBookingsInLot} selectedRound={activeRound} currentBlockStartTime={data.currentBlock?.startTime} isLiveOperationalDate={data.isLiveOperationalDate} /></>}</>}
      </div>
    </div>
  );
}
