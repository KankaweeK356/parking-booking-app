import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const LOTS = ["A", "B", "C", "D"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getNextDay(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function EditBooking() {
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState("");
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // ประเภทการเปลี่ยนแปลง: "reduce" (ลดช่อง / ยกเลิกบางช่วงเวลา) หรือ "change" (ย้ายช่องจอด)
  const [changeType, setChangeType] = useState("reduce");

  // === State สำหรับกรณี "ลดช่อง / ยกเลิกบางช่วงเวลา" ===
  const [selectedReduceRows, setSelectedReduceRows] = useState([]); // Array ของ rowNumber ที่เลือกปิด
  const [reduceEndDate, setReduceEndDate] = useState(today());
  const [reduceResults, setReduceResults] = useState(null); // [{ rowNumber, slotDesc, ok, error }]
  const [submittingReduce, setSubmittingReduce] = useState(false);

  // === State สำหรับกรณี "ย้ายช่องจอด" ===
  const [selectedChangeRow, setSelectedChangeRow] = useState(null); // แถวเดิมที่เลือกปิด (object)
  const [allSlots, setAllSlots] = useState([]);
  const [newLot, setNewLot] = useState("A");
  const [newSlot, setNewSlot] = useState("");
  const [changeOldEndDate, setChangeOldEndDate] = useState(today());
  const [changeNewStartDate, setChangeNewStartDate] = useState(getNextDay(today()));
  const [changeNewEndDate, setChangeNewEndDate] = useState("");
  const [changeNewStartTime, setChangeNewStartTime] = useState("07:00");
  const [changeMessage, setChangeMessage] = useState(null); // { type: 'success'|'error'|'warning', text: string }
  const [submittingChange, setSubmittingChange] = useState(false);

  // โหลดรายชื่อลูกค้าและข้อมูลช่องจอด
  useEffect(() => {
    fetch("/api/master").then((r) => r.json()).then(setCustomers);
    fetch("/api/slots").then((r) => r.json()).then(setAllSlots);
  }, []);

  // โหลดรายการจองเมื่อเปลี่ยนลูกค้า
  useEffect(() => {
    if (!customer) {
      setBookings([]);
      setSelectedReduceRows([]);
      setSelectedChangeRow(null);
      setReduceResults(null);
      setChangeMessage(null);
      return;
    }
    loadCustomerBookings(customer);
  }, [customer]);

  function loadCustomerBookings(custName) {
    setLoadingBookings(true);
    setSelectedReduceRows([]);
    setSelectedChangeRow(null);
    setReduceResults(null);
    setChangeMessage(null);
    setNewSlot("");

    fetch(`/api/bookings?customer=${encodeURIComponent(custName)}`)
      .then((r) => r.json())
      .then((data) => {
        setBookings(Array.isArray(data) ? data : []);
      })
      .finally(() => setLoadingBookings(false));
  }

  // จัดกลุ่ม bookings ตามช่อง สำหรับกรณี "ลดช่อง / ยกเลิกบางช่วงเวลา"
  const groupedBookings = useMemo(() => {
    const map = {};
    for (const b of bookings) {
      const key = b.slot || "ไม่ระบุช่อง";
      if (!map[key]) {
        map[key] = { slot: b.slot, lot: b.lot, items: [] };
      }
      map[key].items.push(b);
    }
    return Object.values(map);
  }, [bookings]);

  // สลับการเลือกทั้งช่อง (Select/Deselect All rows ในช่องนั้น)
  function toggleAllInSlot(slotItems) {
    const slotRowNumbers = slotItems.map((b) => b.rowNumber);
    const allSelected = slotRowNumbers.every((id) => selectedReduceRows.includes(id));
    if (allSelected) {
      setSelectedReduceRows((prev) => prev.filter((id) => !slotRowNumbers.includes(id)));
    } else {
      setSelectedReduceRows((prev) => Array.from(new Set([...prev, ...slotRowNumbers])));
    }
  }

  // สลับการเลือก 1 แถว ในกรณีลดจำนวนช่อง
  function toggleRowSelection(rowNumber) {
    setSelectedReduceRows((prev) =>
      prev.includes(rowNumber) ? prev.filter((id) => id !== rowNumber) : [...prev, rowNumber]
    );
  }

  // Submit กรณี "ลดช่อง / ยกเลิกบางช่วงเวลา"
  async function handleSubmitReduce(e) {
    e.preventDefault();
    if (selectedReduceRows.length === 0 || !reduceEndDate) return;
    setSubmittingReduce(true);
    setReduceResults(null);

    const outcomes = [];
    for (const rowNum of selectedReduceRows) {
      const target = bookings.find((b) => b.rowNumber === rowNum);
      const slotDesc = target ? `ลาน ${target.lot} / ช่อง ${target.slot} (รอบ ${target.startTime || "-"} น.)` : `รายการที่ ${rowNum}`;
      try {
        const res = await fetch("/api/bookings/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rowNumber: rowNum,
            endDate: reduceEndDate,
            reason: "ลดจำนวนช่อง-ช่วงเวลา",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการเชื่อมต่อ");
        outcomes.push({ rowNumber: rowNum, slotDesc, ok: true });
      } catch (err) {
        outcomes.push({ rowNumber: rowNum, slotDesc, ok: false, error: err.message });
      }
    }

    setReduceResults(outcomes);
    setSubmittingReduce(false);

    const succeededRowNumbers = outcomes.filter((o) => o.ok).map((o) => o.rowNumber);
    if (succeededRowNumbers.length > 0) {
      setBookings((prev) => prev.filter((b) => !succeededRowNumbers.includes(b.rowNumber)));
      setSelectedReduceRows((prev) => prev.filter((id) => !succeededRowNumbers.includes(id)));
    }
  }

  // เมื่อเลือกแถวเดิมในกรณี "ย้ายช่องจอด"
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

  // เมื่อแก้วันสิ้นสุดของช่องเดิม -> Auto คำนวณวันเริ่มช่องใหม่ให้เป็นวันถัดไป 1 วัน
  function handleOldEndDateChange(val) {
    setChangeOldEndDate(val);
    if (val) {
      setChangeNewStartDate(getNextDay(val));
    }
  }

  // สล็อตในลานที่เลือกสำหรับเปลี่ยนช่องใหม่
  const availableSlotsInLot = useMemo(() => {
    return allSlots.filter((s) => s.lot === newLot);
  }, [allSlots, newLot]);

  // Submit กรณี "ย้ายช่องจอด"
  async function handleSubmitChange(e) {
    e.preventDefault();
    if (!selectedChangeRow || !newSlot || !changeOldEndDate || !changeNewStartDate || !changeNewStartTime) {
      return;
    }
    setSubmittingChange(true);
    setChangeMessage(null);

    // ขั้นที่ 1: ปิดสิทธิ์ช่องเดิม
    try {
      const closeRes = await fetch("/api/bookings/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowNumber: selectedChangeRow.rowNumber,
          endDate: changeOldEndDate,
          reason: "เปลี่ยนช่อง",
        }),
      });
      const closeData = await closeRes.json();
      if (!closeRes.ok) {
        throw new Error(
          `❌ ปิดช่องเดิม (${selectedChangeRow.slot}) ไม่สำเร็จ ระบบจึงยังไม่ได้ทำการจองช่องใหม่ให้\n(สาเหตุ: ${closeData.error || "เกิดข้อผิดพลาดในการเชื่อมต่อ"})\n➔ คำแนะนำ: กรุณาลองกดบันทึกใหม่อีกครั้ง หรือตรวจสอบสถานะใน Google Sheet`
        );
      }
    } catch (closeErr) {
      setChangeMessage({ type: "error", text: closeErr.message });
      setSubmittingChange(false);
      return;
    }

    // ขั้นที่ 2: จองช่องใหม่ (เมื่อขั้นที่ 1 สำเร็จแล้วเท่านั้น)
    try {
      const createRes = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer,
          lot: newLot,
          slot: newSlot,
          startDate: changeNewStartDate,
          endDate: changeNewEndDate || "",
          startTime: changeNewStartTime,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        // ขั้น 1 สำเร็จแล้ว แต่ขั้น 2 จองช่องใหม่ไม่ได้
        setChangeMessage({
          type: "warning",
          text: `⚠️ ปิดสิทธิ์ช่องเดิม (${selectedChangeRow.slot}) สำเร็จแล้ว แต่จองช่องใหม่ (${newSlot}) ไม่สำเร็จ!\n(สาเหตุ: ${createData.error || "ช่วงเวลาชนกับการจองอื่นหรือช่องไม่ว่าง"})\n➔ สิ่งที่ต้องทำต่อ: ช่องเดิมถูกปิดไปแล้ว กรุณาไปที่หน้า "จองใหม่ / เพิ่มช่อง" เพื่อเลือกช่องอื่นหรือช่วงเวลาใหม่ให้ลูกค้าทันที`,
        });
        loadCustomerBookings(customer);
        setSubmittingChange(false);
        return;
      }

      // สำเร็จครบถ้วนทั้ง 2 ขั้นตอน
      setChangeMessage({
        type: "success",
        text: `✓ เปลี่ยนช่องจอดสำเร็จเรียบร้อย! ปิดสิทธิ์ช่องเดิม (${selectedChangeRow.slot}) ถึงวันที่ ${changeOldEndDate} และเปิดจองช่องใหม่ (${newSlot}) ตั้งแต่วันที่ ${changeNewStartDate} เรียบร้อยแล้ว`,
      });
      loadCustomerBookings(customer);
    } catch (createErr) {
      setChangeMessage({
        type: "warning",
        text: `⚠️ ปิดสิทธิ์ช่องเดิม (${selectedChangeRow.slot}) สำเร็จแล้ว แต่จองช่องใหม่ (${newSlot}) ไม่สำเร็จ!\n(สาเหตุ: ${createErr.message})\n➔ สิ่งที่ต้องทำต่อ: ช่องเดิมถูกปิดไปแล้ว กรุณาไปที่หน้า "จองใหม่ / เพิ่มช่อง" เพื่อเลือกช่องอื่นให้ลูกค้าทันที`,
      });
      loadCustomerBookings(customer);
    } finally {
      setSubmittingChange(false);
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
        <h2>ปรับ / ยกเลิกการจอง</h2>
        <p className="subtitle">เลือกลูกค้า เลือกประเภทการเปลี่ยนแปลง แล้วระบุรายละเอียดที่ต้องการดำเนินการ</p>

        {/* ขั้นตอนที่ 1: เลือกลูกค้า */}
        <div className="card">
          <label>1. เลือกลูกค้า</label>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">— เลือกลูกค้าที่ต้องการทำรายการ —</option>
            {customers.map((c) => (
              <option key={c.docId} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        {customer && (
          <>
            {/* ขั้นตอนที่ 2: เลือกประเภทการเปลี่ยนแปลง */}
            <div className="card">
              <label>2. เลือกประเภทรายการ</label>
              <div className="type-grid">
                <button
                  type="button"
                  className={`type-btn ${changeType === "reduce" ? "active" : ""}`}
                  onClick={() => {
                    setChangeType("reduce");
                    setReduceResults(null);
                    setChangeMessage(null);
                  }}
                >
                  📉 ลดช่องจอด / ยกเลิกบางช่วงเวลา
                </button>
                <button
                  type="button"
                  className={`type-btn ${changeType === "change" ? "active" : ""}`}
                  onClick={() => {
                    setChangeType("change");
                    setReduceResults(null);
                    setChangeMessage(null);
                  }}
                >
                  🔄 ย้ายช่องจอด (เปลี่ยนช่อง)
                </button>
              </div>
            </div>

            {loadingBookings && (
              <div className="card" style={{ textAlign: "center", padding: "30px" }}>
                <p className="subtitle" style={{ margin: 0 }}>กำลังดึงข้อมูลการจองของ คุณ{customer}...</p>
              </div>
            )}

            {!loadingBookings && bookings.length === 0 && (
              <div className="alert alert-warning">
                คุณ{customer} ไม่มีรายการจองที่เปิดใช้งานอยู่ในระบบขณะนี้
              </div>
            )}

            {/* ================= กรณีที่ 1: ลดช่องจอด / ยกเลิกบางช่วงเวลา ================= */}
            {!loadingBookings && bookings.length > 0 && changeType === "reduce" && (
              <form onSubmit={handleSubmitReduce}>
                <div className="card">
                  <label>3. เลือกช่อง / ช่วงเวลาที่ต้องการยกเลิก</label>
                  <p className="subtitle" style={{ marginBottom: "14px" }}>
                    (จัดกลุ่มตามช่อง สามารถเลือกยกเลิกทั้งช่อง หรือเลือกเฉพาะบางช่วงเวลาได้)
                  </p>

                  {groupedBookings.map((group) => {
                    const isAllSlotSelected = group.items.every((item) =>
                      selectedReduceRows.includes(item.rowNumber)
                    );
                    return (
                      <div key={group.slot} className="slot-group-card">
                        <div className="slot-group-header">
                          <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--navy)" }}>
                            🅿️ ลาน {group.lot} — ช่อง {group.slot} ({group.items.length} รายการจอง)
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                            onClick={() => toggleAllInSlot(group.items)}
                          >
                            {isAllSlotSelected ? "ยกเลิกการเลือกทั้งช่อง" : "✓ เลือกปิดทุกช่วงเวลาของช่องนี้"}
                          </button>
                        </div>

                        {group.items.map((item) => {
                          const isChecked = selectedReduceRows.includes(item.rowNumber);
                          return (
                            <div
                              key={item.rowNumber}
                              className={`timeblock-item ${isChecked ? "selected" : ""}`}
                              onClick={() => toggleRowSelection(item.rowNumber)}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}} // จัดการผ่านคลิกที่แถว
                                style={{ width: "18px", height: "18px", cursor: "pointer" }}
                              />
                              <div style={{ flex: 1, fontSize: "14px" }}>
                                <strong>รอบเวลา {item.startTime || "-"} น.</strong> (4 ชม.) • สิทธิ์เดิม: {item.startDate} ถึง {item.endDate || "ยังไม่มีกำหนด"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  <label>วันสุดท้ายที่ลูกค้ายังใช้งานได้ (มีผลกับทุกรายการที่เลือกด้านบน):</label>
                  <input
                    type="date"
                    value={reduceEndDate}
                    onChange={(e) => setReduceEndDate(e.target.value)}
                    required
                  />

                  <p className="subtitle" style={{ marginTop: "12px", marginBottom: "4px" }}>
                    📌 บันทึกเหตุผลอัตโนมัติ: <strong>ลดจำนวนช่อง-ช่วงเวลา</strong>
                  </p>
                </div>

                {reduceResults && (
                  <div className="card">
                    {reduceResults.map((r) => (
                      <div key={r.rowNumber} className={`alert ${r.ok ? "alert-success" : "alert-error"}`}>
                        {r.ok ? `✓ ${r.slotDesc}: ปิดรายการเรียบร้อยแล้ว` : `❌ ${r.slotDesc}: ${r.error}`}
                      </div>
                    ))}
                  </div>
                )}

                <div className="btn-row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submittingReduce || selectedReduceRows.length === 0 || !reduceEndDate}
                  >
                    {submittingReduce
                      ? "กำลังบันทึกข้อมูล..."
                      : `ยืนยันปิดรายการที่เลือก (${selectedReduceRows.length} รายการ)`}
                  </button>
                </div>
              </form>
            )}

            {/* ================= กรณีที่ 2: ย้ายช่องจอด (เปลี่ยนช่อง) ================= */}
            {!loadingBookings && bookings.length > 0 && changeType === "change" && (
              <form onSubmit={handleSubmitChange}>
                <div className="card">
                  <label>3. เลือกรายการเดิมที่ต้องการย้าย (เลือกได้ 1 รายการ):</label>
                  {bookings.map((b) => (
                    <div
                      key={b.rowNumber}
                      className={`booking-row ${selectedChangeRow?.rowNumber === b.rowNumber ? "selected" : ""}`}
                      onClick={() => handleSelectOldChangeRow(b)}
                    >
                      <div>
                        <div className="slot-code">ลาน {b.lot} — ช่อง {b.slot}</div>
                        <div className="meta">
                          รอบ {b.startTime || "-"} น. (4 ชม.) • สิทธิ์เดิม: {b.startDate} ถึง {b.endDate || "ยังไม่มีกำหนด"}
                        </div>
                      </div>
                      <input
                        type="radio"
                        checked={selectedChangeRow?.rowNumber === b.rowNumber}
                        readOnly
                      />
                    </div>
                  ))}
                </div>

                {selectedChangeRow && (
                  <div className="card">
                    <label>4. เลือกช่องจอดใหม่ที่ต้องการย้ายไป</label>
                    <p className="subtitle">
                      กำลังย้ายจาก: <strong>ลาน {selectedChangeRow.lot} / ช่อง {selectedChangeRow.slot}</strong>
                    </p>

                    <label>เลือกลานของช่องใหม่</label>
                    <select
                      value={newLot}
                      onChange={(e) => {
                        setNewLot(e.target.value);
                        setNewSlot("");
                      }}
                    >
                      {LOTS.map((l) => (
                        <option key={l} value={l}>ลาน {l}</option>
                      ))}
                    </select>

                    <label>เลือกช่องใหม่ (เฉพาะช่องที่ว่างและเปิดใช้งาน):</label>
                    <div className="slot-grid">
                      {availableSlotsInLot.map((s) => {
                        const disabled = s.status === "ปิด";
                        const active = newSlot === s.slotCode;
                        return (
                          <button
                            type="button"
                            key={s.slotCode}
                            className={`slot-btn ${disabled ? "closed" : "open"} ${active ? "active" : ""}`}
                            onClick={() => !disabled && setNewSlot(s.slotCode)}
                            disabled={disabled}
                            title={disabled ? `ปิดใช้งาน: ${s.reason || "ไม่ระบุเหตุผล"}` : "ว่างพร้อมจอง"}
                          >
                            {s.slotCode}
                          </button>
                        );
                      })}
                    </div>
                    {availableSlotsInLot.length === 0 && (
                      <p className="subtitle">ยังไม่มีข้อมูลช่องจอดในลานนี้</p>
                    )}
                    {newSlot && (
                      <p style={{ marginTop: "10px", fontSize: "14px", color: "var(--navy)", fontWeight: 700 }}>
                        ✓ ช่องใหม่ที่เลือก: ลาน {newLot} / ช่อง {newSlot}
                      </p>
                    )}

                    <hr style={{ margin: "20px 0", borderColor: "var(--border)", borderStyle: "solid" }} />

                    <label>วันสุดท้ายที่ยังใช้ช่องเดิม (ช่อง {selectedChangeRow.slot}):</label>
                    <input
                      type="date"
                      value={changeOldEndDate}
                      onChange={(e) => handleOldEndDateChange(e.target.value)}
                      required
                    />

                    <label>วันแรกที่เริ่มใช้ช่องใหม่ (คำนวณวันถัดไปให้อัตโนมัติ หรือเลือกวันอื่นได้):</label>
                    <input
                      type="date"
                      value={changeNewStartDate}
                      onChange={(e) => setChangeNewStartDate(e.target.value)}
                      required
                    />

                    <label>วันสิ้นสุดของช่องใหม่ (เว้นว่างได้ = ใช้ต่อเนื่องไม่มีกำหนด):</label>
                    <input
                      type="date"
                      value={changeNewEndDate}
                      onChange={(e) => setChangeNewEndDate(e.target.value)}
                    />

                    <label>เวลาเริ่มของช่องใหม่ (ค่าเริ่มต้นตามเวลาเดิม 4 ชม.):</label>
                    <input
                      type="time"
                      value={changeNewStartTime}
                      onChange={(e) => setChangeNewStartTime(e.target.value)}
                      required
                    />

                    <p className="subtitle" style={{ marginTop: "12px", marginBottom: "4px" }}>
                      📌 บันทึกเหตุผลอัตโนมัติ: <strong>เปลี่ยนช่อง</strong>
                    </p>
                  </div>
                )}

                {changeMessage && (
                  <div
                    className={`alert ${
                      changeMessage.type === "success"
                        ? "alert-success"
                        : changeMessage.type === "warning"
                        ? "alert-warning"
                        : "alert-error"
                    }`}
                    style={{ whiteSpace: "pre-line", lineHeight: "1.5" }}
                  >
                    {changeMessage.text}
                  </div>
                )}

                <div className="btn-row">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      submittingChange ||
                      !selectedChangeRow ||
                      !newSlot ||
                      !changeOldEndDate ||
                      !changeNewStartDate ||
                      !changeNewStartTime
                    }
                  >
                    {submittingChange
                      ? "กำลังดำเนินการ (ปิดช่องเดิม + เปิดจองช่องใหม่)..."
                      : selectedChangeRow && newSlot
                      ? `ยืนยันย้ายช่อง (${selectedChangeRow.slot} ➔ ${newSlot})`
                      : "กรุณาเลือกช่องเดิมและช่องใหม่ให้ครบถ้วน"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
