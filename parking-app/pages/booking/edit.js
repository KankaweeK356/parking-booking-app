import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import OperationalTimePicker from "../../components/OperationalTimePicker";
import EndDateField from "../../components/EndDateField";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getNextDay(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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
  const [reduceResults, setReduceResults] = useState(null);
  const [submittingReduce, setSubmittingReduce] = useState(false);

  // === State สำหรับ "ย้ายช่องจอด" ===
  const [selectedChangeRow, setSelectedChangeRow] = useState(null);
  const [newLot, setNewLot] = useState("");
  const [newSlot, setNewSlot] = useState("");
  const [changeOldEndDate, setChangeOldEndDate] = useState(today());
  const [changeNewStartDate, setChangeNewStartDate] = useState(getNextDay(today()));
  const [changeNewEndDate, setChangeNewEndDate] = useState("");
  const [changeNewStartTime, setChangeNewStartTime] = useState("07:00");
  const [changeMessage, setChangeMessage] = useState(null);
  const [submittingChange, setSubmittingChange] = useState(false);

  // === State สำหรับ "ปรับวัน-เวลาจอง (ขยายเวลา/Extend)" ===
  const [selectedExtendRow, setSelectedExtendRow] = useState(null);
  const [extendStartDate, setExtendStartDate] = useState("");
  const [extendEndDate, setExtendEndDate] = useState("");
  const [extendStartTime, setExtendStartTime] = useState("07:00");
  const [extendMessage, setExtendMessage] = useState(null);
  const [submittingExtend, setSubmittingExtend] = useState(false);

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
          reason: "ลดจำนวนช่อง-ช่วงเวลา",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการบันทึก");

      const outcomes = (data.outcomes || []).map((o) => {
        const target = bookings.find((b) => b.rowNumber === o.rowNumber);
        const slotDesc = target ? `ลาน ${target.lot} / ช่อง ${target.slot} (รอบ ${target.startTime || "-"} น.)` : `แถวที่ ${o.rowNumber}`;
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
    setChangeOldEndDate(today());
    setChangeNewStartDate(getNextDay(today()));
    setChangeNewEndDate(b.endDate || "");
    setChangeNewStartTime(b.startTime || "07:00");
  }

  function handleOldEndDateChange(val) {
    setChangeOldEndDate(val);
    if (val) {
      setChangeNewStartDate(getNextDay(val));
    }
  }

  const availableSlotsInLot = useMemo(() => {
    return allSlots.filter((s) => s.lot === newLot);
  }, [allSlots, newLot]);

  async function handleSubmitChange(e) {
    e.preventDefault();
    if (!selectedChangeRow || !newSlot || !changeOldEndDate || !changeNewStartDate || !changeNewEndDate || !changeNewStartTime) {
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
          oldEndDate: changeOldEndDate,
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
        text: `✓ เปลี่ยนช่องจอดสำเร็จเรียบร้อย! ปิดสิทธิ์ช่องเดิม (${selectedChangeRow.slot}) ถึงวันที่ ${changeOldEndDate} และเปิดจองช่องใหม่ (${newSlot}) ตั้งแต่วันที่ ${changeNewStartDate} เรียบร้อยแล้ว`,
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
        text: `✓ ปรับวัน-เวลาจองช่อง ${selectedExtendRow.slot} สำเร็จเรียบร้อยแล้ว`,
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
          <h1>ปรับ / ยกเลิกการจอง</h1>
          <Link href="/" className="back">← กลับหน้าหลัก</Link>
        </div>
      </div>
      <div className="page">
        <div className="card">
          <div className="section-heading-row">
            <label>เลือกลูกค้า</label>
            <button type="button" className="btn btn-secondary" onClick={refreshBookingStatus}>↻ Refresh สถานะช่อง</button>
          </div>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">— เลือกลูกค้า —</option>
            {customers.map((c) => (
              <option key={c.docId || c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
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
                <div className="title" style={{ fontSize: 15 }}>1. ลดช่อง / ยกเลิก</div>
                <div className="desc">ปิดบางช่องหรือบางช่วงเวลา</div>
              </div>
              <div
                className={`nav-card ${changeType === "change" ? "selected-nav" : ""}`}
                style={{ cursor: "pointer", borderLeft: changeType === "change" ? "5px solid var(--navy)" : "1px solid var(--border)" }}
                onClick={() => setChangeType("change")}
              >
                <div className="title" style={{ fontSize: 15 }}>2. ย้ายช่องจอด</div>
                <div className="desc">ตรวจช่องใหม่ก่อนปิดช่องเดิม</div>
              </div>
              <div
                className={`nav-card ${changeType === "extend" ? "selected-nav" : ""}`}
                style={{ cursor: "pointer", borderLeft: changeType === "extend" ? "5px solid var(--navy)" : "1px solid var(--border)" }}
                onClick={() => setChangeType("extend")}
              >
                <div className="title" style={{ fontSize: 15 }}>3. ปรับวัน-เวลา (ขยายเวลา)</div>
                <div className="desc">แก้ช่วงวันที่หรือรอบเวลาในช่องเดิม</div>
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
              <h2 style={{ fontSize: 16 }}>เลือกช่อง / ช่วงเวลาที่ต้องการยกเลิก</h2>
              <div style={{ margin: "14px 0" }}>
                {bookings.map((b) => (
                  <div
                    key={b.rowNumber}
                    className={`booking-row ${selectedReduceRows.includes(b.rowNumber) ? "selected" : ""}`}
                    onClick={() => toggleRowSelection(b.rowNumber)}
                  >
                    <div>
                      <div className="slot-code">ลาน {b.lot} / ช่อง {b.slot}</div>
                      <div className="meta">
                        รอบ {b.startTime || "-"} น. | สิทธิ์เดิม: {b.startDate} ถึง {b.endDate || "ไม่มีกำหนด"}
                      </div>
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

              <label>วันที่มีผลสิ้นสุดสิทธิ์ (วันสุดท้ายที่ยังมีสิทธิ์ใช้งาน)</label>
              <input
                type="date"
                value={reduceEndDate}
                onChange={(e) => setReduceEndDate(e.target.value)}
                required
              />

              <div className="btn-row">
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={submittingReduce || selectedReduceRows.length === 0}
                >
                  {submittingReduce ? "กำลังบันทึก..." : `ยืนยันยกเลิก (${selectedReduceRows.length} รายการ)`}
                </button>
              </div>
            </div>

            {reduceResults && (
              <div className="card">
                {reduceResults.map((r, i) => (
                  <div key={i} className={`alert ${r.ok ? "alert-success" : "alert-error"}`}>
                    {r.ok ? `✓ ยกเลิกสำเร็จ (${r.slotDesc})` : `✗ ไม่สำเร็จ (${r.slotDesc}): ${r.error}`}
                  </div>
                ))}
              </div>
            )}
          </form>
        )}

        {/* FLOW 2: ย้ายช่องจอด (Safe Move Slot) */}
        {customer && !loadingBookings && bookings.length > 0 && changeType === "change" && (
          <form onSubmit={handleSubmitChange}>
            <div className="card">
              <h2 style={{ fontSize: 16 }}>1. เลือกรายการเดิมที่จะย้ายออก</h2>
              <div style={{ margin: "14px 0" }}>
                {bookings.map((b) => (
                  <div
                    key={b.rowNumber}
                    className={`booking-row ${selectedChangeRow?.rowNumber === b.rowNumber ? "selected" : ""}`}
                    onClick={() => handleSelectOldChangeRow(b)}
                  >
                    <div>
                      <div className="slot-code">ลาน {b.lot} / ช่อง {b.slot}</div>
                      <div className="meta">
                        รอบ {b.startTime || "-"} น. | สิทธิ์เดิม: {b.startDate} ถึง {b.endDate || "ไม่มีกำหนด"}
                      </div>
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
                <h2 style={{ fontSize: 16 }}>2. เลือกช่องใหม่และช่วงเวลาที่จะย้ายไป</h2>
                <label>ลานใหม่</label>
                <select value={newLot} onChange={(e) => { setNewLot(e.target.value); setNewSlot(""); }}>
                  {lots.map((l) => (
                    <option key={l} value={l}>ลาน {l}</option>
                  ))}
                </select>

                <label>เลือกช่องใหม่</label>
                <div className="slot-grid">
                  {availableSlotsInLot.map((s) => {
                    const disabled = s.status === "ปิด" || s.isRoad;
                    const active = newSlot === s.slotCode;
                    return (
                      <button
                        type="button"
                        key={s.slotCode}
                        className={`slot-btn ${disabled ? "closed" : "open"} ${active ? "active" : ""}`}
                        disabled={disabled}
                        onClick={() => setNewSlot(s.slotCode)}
                        title={disabled ? `ปิดใช้งาน: ${s.reason || (s.isRoad ? "ถนน/ไม่เปิดใช้งาน" : "สถานะพื้นฐานปิดใช้งาน")}` : "ว่าง"}
                      >
                        ช่อง {s.number || "-"}
                      </button>
                    );
                  })}
                </div>

                <label>วันที่สิ้นสุดของช่องเดิม</label>
                <input
                  type="date"
                  value={changeOldEndDate}
                  onChange={(e) => handleOldEndDateChange(e.target.value)}
                  required
                />

                <label>วันที่เริ่มของช่องใหม่</label>
                <input
                  type="date"
                  value={changeNewStartDate}
                  onChange={(e) => setChangeNewStartDate(e.target.value)}
                  required
                />

                <EndDateField startDate={changeNewStartDate} value={changeNewEndDate} onChange={setChangeNewEndDate} label="วันที่สิ้นสุดของช่องใหม่" />

                <OperationalTimePicker value={changeNewStartTime} onChange={setChangeNewStartTime} label="เลือกรอบเวลาของช่องใหม่ (รอบละ 4 ชั่วโมง)" required />

                <div className="btn-row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingChange || !newSlot || !changeNewEndDate}
                  >
                    {submittingChange ? "กำลังตรวจสอบและย้ายช่อง..." : `ยืนยันย้ายไปช่อง ${newSlot || "(กรุณาเลือกช่อง)"}`}
                  </button>
                </div>
              </div>
            )}

            {changeMessage && (
              <div className={`alert ${changeMessage.type === "success" ? "alert-success" : "alert-error"}`}>
                {changeMessage.text}
              </div>
            )}
          </form>
        )}

        {/* FLOW 3: ปรับวัน-เวลาจอง (Extend) */}
        {customer && !loadingBookings && bookings.length > 0 && changeType === "extend" && (
          <form onSubmit={handleSubmitExtend}>
            <div className="card">
              <h2 style={{ fontSize: 16 }}>1. เลือกรายการที่ต้องการปรับวัน-เวลา (ขยายเวลา)</h2>
              <div style={{ margin: "14px 0" }}>
                {bookings.map((b) => (
                  <div
                    key={b.rowNumber}
                    className={`booking-row ${selectedExtendRow?.rowNumber === b.rowNumber ? "selected" : ""}`}
                    onClick={() => handleSelectExtendRow(b)}
                  >
                    <div>
                      <div className="slot-code">ลาน {b.lot} / ช่อง {b.slot}</div>
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
                  2. ปรับช่วงวันที่และเวลาสำหรับช่อง {selectedExtendRow.slot} (ลาน {selectedExtendRow.lot})
                </h2>

                <label>วันที่เริ่ม</label>
                <input
                  type="date"
                  value={extendStartDate}
                  onChange={(e) => setExtendStartDate(e.target.value)}
                  required
                />

                <label>วันที่สิ้นสุด (เว้นว่าง = ยังไม่มีกำหนด / ขยายไม่มีกำหนด)</label>
                <input
                  type="date"
                  value={extendEndDate}
                  onChange={(e) => setExtendEndDate(e.target.value)}
                />

                <OperationalTimePicker value={extendStartTime} onChange={setExtendStartTime} label="เลือกรอบเวลา (รอบละ 4 ชั่วโมง)" required />

                <div className="btn-row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingExtend}
                  >
                    {submittingExtend ? "กำลังตรวจสอบและบันทึก..." : "ยืนยันปรับวัน-เวลา"}
                  </button>
                </div>
              </div>
            )}

            {extendMessage && (
              <div className={`alert ${extendMessage.type === "success" ? "alert-success" : "alert-error"}`}>
                {extendMessage.text}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
