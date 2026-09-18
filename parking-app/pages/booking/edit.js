import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OperationalTimePicker from "../../components/OperationalTimePicker";
import EndDateField from "../../components/EndDateField";
import CustomerPicker from "../../components/CustomerPicker";
import { displayLotName } from "../../lib/display";
import { addDaysToIso, getCurrentOperationalDateIso } from "../../lib/operational-day";

function today() {
  return getCurrentOperationalDateIso();
}

function getNextDay(dateStr) {
  return addDaysToIso(dateStr, 1);
}

function laterDate(first, second) {
  return first && first > second ? first : second;
}

export default function EditBooking() {
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState("");
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Dynamic lots & slots
  const [allSlots, setAllSlots] = useState([]);
  const [lots, setLots] = useState([]);

  // ประเภทการเปลี่ยนแปลง:
  // "reduce" (ลดจำนวนช่อง / ยกเลิกบางช่วงเวลา)
  // "change" (ย้ายช่องจอด)
  // "extend" (ปรับวัน-เวลาจอง / ขยายระยะเวลา)
  const [changeType, setChangeType] = useState("reduce");

  // === State สำหรับ "ลดจำนวนช่อง / ยกเลิกบางช่วงเวลา" ===
  const [selectedReduceRows, setSelectedReduceRows] = useState([]);
  const [reduceEndDate, setReduceEndDate] = useState(today());
  const [reduceMode, setReduceMode] = useState("permanent");
  const [pauseStartDate, setPauseStartDate] = useState(getNextDay(today()));
  const [pauseEndDate, setPauseEndDate] = useState(getNextDay(today()));
  const [reduceResults, setReduceResults] = useState(null);
  const [submittingReduce, setSubmittingReduce] = useState(false);

  // === State สำหรับ "ย้ายช่องจอด" ===
  const [selectedChangeRow, setSelectedChangeRow] = useState(null);
  const [newLot, setNewLot] = useState("");
  const [newSlot, setNewSlot] = useState("");
  const [changeNewStartDate, setChangeNewStartDate] = useState(getNextDay(today()));
  const [changeNewEndDate, setChangeNewEndDate] = useState("");
  const [changeNewStartTime, setChangeNewStartTime] = useState("07:00");
  const [changeMessage, setChangeMessage] = useState(null);
  const [submittingChange, setSubmittingChange] = useState(false);
  const [moveAvailability, setMoveAvailability] = useState({});
  const [moveAvailabilityLoading, setMoveAvailabilityLoading] = useState(false);
  const [moveAvailabilityError, setMoveAvailabilityError] = useState("");

  // === State สำหรับ "ปรับวัน-เวลาจอง (ขยายเวลา/Extend)" ===
  const [selectedExtendRow, setSelectedExtendRow] = useState(null);
  const [extendStartDate, setExtendStartDate] = useState("");
  const [extendEndDate, setExtendEndDate] = useState("");
  const [extendStartTime, setExtendStartTime] = useState("07:00");
  const [extendMessage, setExtendMessage] = useState(null);
  const [submittingExtend, setSubmittingExtend] = useState(false);

  function slotLabel(booking) {
    const number = allSlots.find((slot) => slot.slotCode === booking.slot)?.number || "-";
    return `${displayLotName(booking.lot)} / ช่อง ${number}`;
  }

  function formatDate(dateStr) {
    const [year, month, day] = String(dateStr || "").split("-");
    return year && month && day ? `${day}/${month}/${year}` : "-";
  }

  function pauseNote(booking) {
    const periods = booking.pausePeriods || [];
    if (!periods.length) return "";
    return periods.map((period) => `พักการจอง: ${formatDate(period.startDate)} ถึง ${formatDate(period.endDate)}`).join(" · ");
  }

  // โหลดรายชื่อลูกค้าและข้อมูลช่องจอด
  function loadReferenceData() {
    fetch("/api/master").then((r) => r.json()).then(setCustomers);
    fetch("/api/slots")
      .then((r) => r.json())
      .then((data) => {
        const slotList = Array.isArray(data) ? data : (data.slots || []);
        const lotList = data.lots || Array.from(new Set(slotList.map((item) => item.lot).filter(Boolean))).sort();
        setAllSlots(slotList);
        setLots(lotList);
        if (lotList.length > 0) setNewLot((current) => current || lotList[0]);
      });
  }
  useEffect(() => { loadReferenceData(); }, []);

  function refreshBookingStatus() {
    loadReferenceData();
    if (customer) loadCustomerBookings(customer);
  }

  // โหลดรายการจองเมื่อเปลี่ยนลูกค้า
  useEffect(() => {
    if (!customer) {
      setBookings([]);
      setSelectedReduceRows([]);
      setSelectedChangeRow(null);
      setSelectedExtendRow(null);
      setReduceResults(null);
      setChangeMessage(null);
      setExtendMessage(null);
      return;
    }
    loadCustomerBookings(customer);
  }, [customer]);

  function loadCustomerBookings(custName) {
    setLoadingBookings(true);
    setSelectedReduceRows([]);
    setSelectedChangeRow(null);
    setSelectedExtendRow(null);
    setReduceResults(null);
    setChangeMessage(null);
    setExtendMessage(null);
    setNewSlot("");

    fetch(`/api/bookings?customer=${encodeURIComponent(custName)}`)
      .then((r) => r.json())
      .then((data) => {
        setBookings(Array.isArray(data) ? data : []);
      })
      .finally(() => setLoadingBookings(false));
  }

  // --- Handlers: ลดจำนวนช่อง ---
  function toggleRowSelection(rowNumber) {
    setSelectedReduceRows((prev) =>
      prev.includes(rowNumber) ? prev.filter((id) => id !== rowNumber) : [...prev, rowNumber]
    );
  }

  async function handleSubmitReduce(e) {
    e.preventDefault();
    if (selectedReduceRows.length === 0 || !reduceEndDate) return;
    setSubmittingReduce(true);
    setReduceResults(null);

    try {
      const res = await fetch("/api/bookings/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowNumbers: selectedReduceRows,
          endDate: reduceEndDate,
          pauseStartDate: reduceMode === "pause" ? pauseStartDate : "",
          pauseEndDate: reduceMode === "pause" ? pauseEndDate : "",
          reason: reduceMode === "pause" ? "พักการจอง" : "ยกเลิกการจอง",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการบันทึก");

      const outcomes = (data.outcomes || []).map((o) => {
        const target = bookings.find((b) => b.rowNumber === o.rowNumber);
        const slotDesc = target ? `${slotLabel(target)} (รอบ ${target.startTime || "-"} น.)` : `แถวที่ ${o.rowNumber}`;
        return { ...o, slotDesc };
      });
      setReduceResults(outcomes);
      loadCustomerBookings(customer);
    } catch (err) {
      setReduceResults([{ ok: false, error: err.message, slotDesc: "เกิดข้อผิดพลาด" }]);
    } finally {
      setSubmittingReduce(false);
    }
  }

  // --- Handlers: ย้ายช่องจอด ---
  function handleSelectOldChangeRow(b) {
    setSelectedChangeRow(b);
    setChangeMessage(null);
    if (b.lot) setNewLot(b.lot);
    setNewSlot("");
    const effectiveNewStartDate = laterDate(b.startDate || "", getNextDay(today()));
    setChangeNewStartDate(effectiveNewStartDate);
    setChangeNewEndDate(b.endDate || "");
    setChangeNewStartTime(b.startTime || "07:00");
  }

  const availableSlotsInLot = useMemo(() => {
    return allSlots.filter((s) => s.lot === newLot);
  }, [allSlots, newLot]);

  useEffect(() => {
    if (!selectedChangeRow || !newLot || !changeNewStartDate || !changeNewEndDate || !changeNewStartTime) {
      setMoveAvailability({});
      setMoveAvailabilityLoading(false);
      setMoveAvailabilityError("");
      return undefined;
    }
    let active = true;
    setMoveAvailabilityLoading(true);
    setMoveAvailabilityError("");
    fetch(`/api/booking-availability?lot=${encodeURIComponent(newLot)}&startDate=${changeNewStartDate}&endDate=${changeNewEndDate}&startTimes=${encodeURIComponent(changeNewStartTime)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "ตรวจสอบสถานะช่องไม่สำเร็จ");
        return data;
      })
      .then((data) => {
        if (!active) return;
        const nextAvailability = Object.fromEntries((data.availability || []).map((item) => [item.slotCode, item]));
        setMoveAvailability(nextAvailability);
        setNewSlot((selected) => {
          if (!selected || selected === selectedChangeRow.slot || nextAvailability[selected]?.blocked || !nextAvailability[selected]) return "";
          return selected;
        });
      })
      .catch((error) => active && setMoveAvailabilityError(error.message || "ตรวจสอบสถานะช่องไม่สำเร็จ"))
      .finally(() => active && setMoveAvailabilityLoading(false));
    return () => { active = false; };
  }, [selectedChangeRow?.rowNumber, selectedChangeRow?.slot, newLot, changeNewStartDate, changeNewEndDate, changeNewStartTime]);

  async function handleSubmitChange(e) {
    e.preventDefault();
    if (!selectedChangeRow || !newSlot || !changeNewStartDate || !changeNewEndDate || !changeNewStartTime) {
      return;
    }
    setSubmittingChange(true);
    setChangeMessage(null);

    try {
      const res = await fetch("/api/bookings/change-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldRowNumber: selectedChangeRow.rowNumber,
          customer,
          newLot,
          newSlot,
          newStartDate: changeNewStartDate,
          newEndDate: changeNewEndDate || "",
          newStartTime: changeNewStartTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "ย้ายช่องไม่สำเร็จ");
      }

      setChangeMessage({
        type: "success",
      text: `✓ ย้ายช่องสำเร็จ มีผลวันที่ ${formatDate(changeNewStartDate)} รอบ ${selectedChangeRow.startTime || changeNewStartTime} น. โดยคงวันสิ้นสุดเดิมไว้แล้ว`,
      });
      loadCustomerBookings(customer);
    } catch (err) {
      setChangeMessage({
        type: "error",
        text: `❌ ไม่สามารถย้ายช่องจอดได้: ${err.message}`,
      });
    } finally {
      setSubmittingChange(false);
    }
  }

  // --- Handlers: ปรับวัน-เวลาจอง (Extend) ---
  function handleSelectExtendRow(b) {
    setSelectedExtendRow(b);
    setExtendMessage(null);
    setExtendStartDate(b.startDate || today());
    setExtendEndDate(b.endDate || "");
    setExtendStartTime(b.startTime || "07:00");
  }

  async function handleSubmitExtend(e) {
    e.preventDefault();
    if (!selectedExtendRow || !extendStartDate || !extendStartTime) return;
    setSubmittingExtend(true);
    setExtendMessage(null);

    try {
      const res = await fetch("/api/bookings/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowNumber: selectedExtendRow.rowNumber,
          lot: selectedExtendRow.lot,
          slot: selectedExtendRow.slot,
          startDate: extendStartDate,
          endDate: extendEndDate || "",
          startTime: extendStartTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ปรับวัน-เวลาไม่สำเร็จ");

      setExtendMessage({
        type: "success",
        text: `✓ ปรับวันสิ้นสุดของ ${slotLabel(selectedExtendRow)} สำเร็จเรียบร้อยแล้ว`,
      });
      loadCustomerBookings(customer);
    } catch (err) {
      setExtendMessage({
        type: "error",
        text: `❌ ไม่สามารถปรับวัน-เวลาได้: ${err.message}`,
      });
    } finally {
      setSubmittingExtend(false);
    }
  }

  return (
    <div>
      <div className="top-bar">
        <div className="inner">
          <h1>พัก / ยกเลิกการจอง / ย้ายช่องจอด</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>
      <div className="page">
        <div className="card">
          <div className="section-heading-row">
            <label>ข้อมูลการจอง</label>
            <button type="button" className="btn btn-secondary" onClick={refreshBookingStatus}>↻ อัปเดตสถานะช่อง</button>
          </div>
          <CustomerPicker customers={customers} value={customer} onChange={setCustomer} />
        </div>

        {customer && (
          <div className="card">
            <label>ประเภทการเปลี่ยนแปลง</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", marginTop: "8px" }}>
              <div
                className={`nav-card ${changeType === "reduce" ? "selected-nav" : ""}`}
                style={{ cursor: "pointer", borderLeft: changeType === "reduce" ? "5px solid var(--navy)" : "1px solid var(--border)" }}
                onClick={() => setChangeType("reduce")}
              >
                <div className="title" style={{ fontSize: 15 }}>1. พัก / ยกเลิกการจอง</div>
                <div className="desc">เลือกทั้งช่องหรือเฉพาะรอบ แล้วกำหนดวันที่มีผล</div>
              </div>
              <div
                className={`nav-card ${changeType === "change" ? "selected-nav" : ""}`}
                style={{ cursor: "pointer", borderLeft: changeType === "change" ? "5px solid var(--navy)" : "1px solid var(--border)" }}
                onClick={() => setChangeType("change")}
              >
                <div className="title" style={{ fontSize: 15 }}>2. ย้ายช่องจอด</div>
                <div className="desc">เลือกทีละรอบ และกำหนดวันเริ่มใช้ช่องใหม่</div>
              </div>
            </div>
          </div>
        )}

        {loadingBookings && <div className="card"><p className="subtitle">กำลังโหลดรายการจองของลูกค้า...</p></div>}

        {customer && !loadingBookings && bookings.length === 0 && (
          <div className="card"><p className="subtitle">ลูกค้าคนนี้ไม่มีรายการจองที่ Active อยู่</p></div>
        )}

        {/* FLOW 1: ลดจำนวนช่อง / ยกเลิก */}
        {customer && !loadingBookings && bookings.length > 0 && changeType === "reduce" && (
          <form onSubmit={handleSubmitReduce}>
            <div className="card">
              <h2 style={{ fontSize: 16 }}>เลือกการจองที่ต้องการพักหรือยกเลิก</h2>
              <p className="subtitle">เลือกทุกรอบของช่องเดียวกันเพื่อทำทั้งช่อง หรือเลือกเฉพาะรอบที่ต้องการ</p>
              <div style={{ margin: "14px 0" }}>
                {bookings.map((b) => (
                  <div
                    key={b.rowNumber}
                    className={`booking-row ${selectedReduceRows.includes(b.rowNumber) ? "selected" : ""}`}
                    onClick={() => toggleRowSelection(b.rowNumber)}
                  >
                    <div>
                      <div className="slot-code">{slotLabel(b)}</div>
                      <div className="meta">
                        รอบ {b.startTime || "-"} น. | สิทธิ์เดิม: {b.startDate} ถึง {b.endDate || "ไม่มีกำหนด"}
                      </div>
                      {pauseNote(b) && <div className="booking-pause-note">{pauseNote(b)}</div>}
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedReduceRows.includes(b.rowNumber)}
                      onChange={() => {}}
                      style={{ width: 18, height: 18 }}
                    />
                  </div>
                ))}
              </div>

              <label>เลือกวิธีดำเนินการ</label>
              <div className="type-grid"><button type="button" className={`type-btn ${reduceMode === "permanent" ? "active" : ""}`} onClick={() => setReduceMode("permanent")}><strong>ยกเลิกการจอง</strong><small>กำหนดวันสุดท้ายที่ลูกค้ายังใช้ช่องได้ หลังจากวันนั้นสิทธิ์จะสิ้นสุดถาวร</small></button><button type="button" className={`type-btn ${reduceMode === "pause" ? "active" : ""}`} onClick={() => setReduceMode("pause")}><strong>พักการจองชั่วคราว</strong><small>ระบุช่วงวันที่ลูกค้าไม่ใช้ช่องนี้ เมื่อครบกำหนดจะกลับมาใช้สิทธิ์เดิมต่อ</small></button></div>
              {reduceMode === "permanent" ? <><label>วันสุดท้ายที่ยังใช้ช่องได้</label><input type="date" min={today()} value={reduceEndDate} onChange={(e) => setReduceEndDate(e.target.value)} /></> : <><label>เริ่มพักวันที่</label><input type="date" min={getNextDay(today())} value={pauseStartDate} required onChange={(e) => { const nextStartDate = e.target.value; setPauseStartDate(nextStartDate); setPauseEndDate((current) => current < nextStartDate ? nextStartDate : current); }} /><label>สิ้นสุดพักวันที่</label><input type="date" min={pauseStartDate} value={pauseEndDate} required onChange={(e) => setPauseEndDate(e.target.value)} /><p className="alert alert-warning">ระหว่างวันที่พัก ช่องนี้เปิดให้ลูกค้าคนอื่นจองได้ และจะกลับมาเป็นสิทธิ์เดิมหลังวันสิ้นสุดพัก</p></>}

              <div className="btn-row">
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={submittingReduce || selectedReduceRows.length === 0}
                >
                  {submittingReduce ? "กำลังบันทึก..." : `ยืนยัน${reduceMode === "pause" ? "พักการจอง" : "ยกเลิกการจอง"} (${selectedReduceRows.length} รายการ)`}
                </button>
              </div>
            </div>

            {reduceResults && (
              <div className="card">
                {reduceResults.map((r, i) => (
                  <div key={i} className={`alert ${r.ok ? "alert-success" : "alert-error"}`}>
                    {r.ok ? `✓ ${reduceMode === "pause" ? "พักการจองสำเร็จ" : "บันทึกวันสิ้นสุดสิทธิ์สำเร็จ"} (${r.slotDesc})` : `✗ ไม่สำเร็จ (${r.slotDesc}): ${r.error}`}
                  </div>
                ))}
                {reduceResults.some((result) => result.ok) && <Link className="btn btn-secondary" href={`/required-summary?customer=${encodeURIComponent(customer)}`}>พิมพ์สรุปให้ลูกค้า</Link>}
              </div>
            )}
          </form>
        )}

        {/* FLOW 2: ย้ายช่องจอด (Safe Move Slot) */}
        {customer && !loadingBookings && bookings.length > 0 && changeType === "change" && (
          <form onSubmit={handleSubmitChange}>
            <div className="card">
              <h2 style={{ fontSize: 16 }}>1. เลือกรายการเดิมที่จะย้าย</h2>
              <div style={{ margin: "14px 0" }}>
                {bookings.map((b) => (
                  <div
                    key={b.rowNumber}
                    className={`booking-row ${selectedChangeRow?.rowNumber === b.rowNumber ? "selected" : ""}`}
                    onClick={() => handleSelectOldChangeRow(b)}
                  >
                    <div>
                      <div className="slot-code">{slotLabel(b)}</div>
                      <div className="meta">
                        รอบ {b.startTime || "-"} น. | สิทธิ์เดิม: {b.startDate} ถึง {b.endDate || "ไม่มีกำหนด"}
                      </div>
                      {pauseNote(b) && <div className="booking-pause-note">{pauseNote(b)}</div>}
                    </div>
                    <input
                      type="radio"
                      name="oldRowRadio"
                      checked={selectedChangeRow?.rowNumber === b.rowNumber}
                      onChange={() => {}}
                    />
                  </div>
                ))}
              </div>
            </div>

            {selectedChangeRow && (
              <div className="card">
                <h2 style={{ fontSize: 16 }}>2. เลือกช่องใหม่</h2>
                <p className="subtitle">ย้ายเฉพาะรอบ {selectedChangeRow.startTime} น. ช่องเดิมจะใช้ถึงวันก่อนหน้า และช่องใหม่จะใช้ถึง {formatDate(changeNewEndDate)}</p>
                <label>ลานใหม่</label>
                <select value={newLot} onChange={(e) => { setNewLot(e.target.value); setNewSlot(""); }}>
                  {lots.map((l) => (
                    <option key={l} value={l}>{displayLotName(l)}</option>
                  ))}
                </select>

                <label>เริ่มใช้ช่องใหม่วันที่</label>
                <input type="date" min={laterDate(selectedChangeRow.startDate || "", getNextDay(today()))} max={changeNewEndDate || undefined} value={changeNewStartDate} onChange={(e) => { setChangeNewStartDate(e.target.value); setNewSlot(""); }} />

                <label>เลือกช่องใหม่</label>
                <p className="subtitle">ตรวจสถานะช่องสำหรับรอบ {selectedChangeRow.startTime} น. ตั้งแต่ {formatDate(changeNewStartDate)} ถึง {formatDate(changeNewEndDate)}</p>
                {moveAvailabilityLoading && <p className="subtitle">กำลังตรวจสอบช่องว่าง…</p>}
                {moveAvailabilityError && <div className="alert alert-error">{moveAvailabilityError}</div>}
                <div className="slot-grid">
                  {availableSlotsInLot.map((s) => {
                    const isSourceSlot = s.slotCode === selectedChangeRow.slot;
                    const availability = moveAvailability[s.slotCode];
                    const hasConflict = availability?.blocked && !isSourceSlot && s.status !== "ปิด" && !s.isRoad;
                    const disabled = isSourceSlot || s.status === "ปิด" || s.isRoad || hasConflict || moveAvailabilityLoading || Boolean(moveAvailabilityError);
                    const active = newSlot === s.slotCode;
                    const title = isSourceSlot
                      ? "ช่องเดิมที่เลือกย้ายออก"
                      : s.status === "ปิด" || s.isRoad
                        ? `ปิดใช้งาน: ${s.reason || (s.isRoad ? "ถนน/ไม่เปิดใช้งาน" : "สถานะพื้นฐานปิดใช้งาน")}`
                        : hasConflict
                          ? availability.reason || "มีการจองในช่วงวันที่เลือก"
                          : moveAvailabilityLoading
                            ? "กำลังตรวจสอบสถานะช่อง"
                            : moveAvailabilityError
                              ? "ยังตรวจสอบสถานะช่องไม่ได้"
                              : "ว่าง";
                    return (
                      <button
                        type="button"
                        key={s.slotCode}
                        className={`slot-btn ${isSourceSlot ? "move-source" : hasConflict || moveAvailabilityError ? "unavailable" : disabled ? "closed" : "open"} ${active ? "active" : ""}`}
                        disabled={disabled}
                        onClick={() => setNewSlot(s.slotCode)}
                        title={title}
                      >
                        ช่อง {s.number || "-"}
                      </button>
                    );
                  })}
                </div>

                <div className="btn-row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingChange || !newSlot || moveAvailabilityLoading || Boolean(moveAvailabilityError)}
                  >
                    {submittingChange ? "กำลังตรวจสอบและย้ายช่อง..." : `ยืนยันย้ายไปช่อง ${allSlots.find((slot) => slot.slotCode === newSlot)?.number || "(กรุณาเลือกช่อง)"}`}
                  </button>
                </div>
              </div>
            )}

            {changeMessage && (
              <div className={`alert ${changeMessage.type === "success" ? "alert-success" : "alert-error"}`}>
                {changeMessage.text} {changeMessage.type === "success" && <Link href={`/required-summary?customer=${encodeURIComponent(customer)}`}>พิมพ์สรุปให้ลูกค้า</Link>}
              </div>
            )}
          </form>
        )}

        {/* FLOW 3: ปรับวัน-เวลาจอง (Extend) */}
        {customer && !loadingBookings && bookings.length > 0 && changeType === "extend" && (
          <form onSubmit={handleSubmitExtend}>
            <div className="card">
              <h2 style={{ fontSize: 16 }}>1. เลือกรายการที่ต้องการปรับวันสิ้นสุด</h2>
              <div style={{ margin: "14px 0" }}>
                {bookings.map((b) => (
                  <div
                    key={b.rowNumber}
                    className={`booking-row ${selectedExtendRow?.rowNumber === b.rowNumber ? "selected" : ""}`}
                    onClick={() => handleSelectExtendRow(b)}
                  >
                    <div>
                      <div className="slot-code">{slotLabel(b)}</div>
                      <div className="meta">
                        รอบ {b.startTime || "-"} น. | สิทธิ์เดิม: {b.startDate} ถึง {b.endDate || "ไม่มีกำหนด"}
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="extendRowRadio"
                      checked={selectedExtendRow?.rowNumber === b.rowNumber}
                      onChange={() => {}}
                    />
                  </div>
                ))}
              </div>
            </div>

            {selectedExtendRow && (
              <div className="card">
                <h2 style={{ fontSize: 16 }}>
                  2. ปรับวันสิ้นสุดสำหรับ {slotLabel(selectedExtendRow)}
                </h2>

                <p className="subtitle">วันเริ่ม {selectedExtendRow.startDate} · รอบ {selectedExtendRow.startTime} · ข้อมูลอื่นคงเดิม</p>
                <EndDateField startDate={selectedExtendRow.startDate} value={extendEndDate} onChange={setExtendEndDate} label="วันสิ้นสุดใหม่" />

                <div className="btn-row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingExtend}
                  >
                    {submittingExtend ? "กำลังตรวจสอบและบันทึก..." : "ยืนยันปรับวันสิ้นสุด"}
                  </button>
                </div>
              </div>
            )}

            {extendMessage && (
              <div className={`alert ${extendMessage.type === "success" ? "alert-success" : "alert-error"}`}>
                {extendMessage.text} {extendMessage.type === "success" && <Link href={`/required-summary?customer=${encodeURIComponent(customer)}`}>พิมพ์สรุปให้ลูกค้า</Link>}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
