import { useState } from "react";
import { formatBangkokTime, getPreviousOperationalBlock } from "../lib/operational-day";
import { formatFieldCustomerName } from "../lib/display";
import { bookingForBlock, getDashboardCellStatus } from "../lib/timeline-status";

const STATUS_LABELS = {
  booked: "จองแล้ว",
  vacant: "ว่าง",
  "ticket-check": "รอตรวจตั๋ว",
  "unpaid-booking": "ไม่ตีตั๋ว",
  expired: "หมดเวลาจอด",
  closed: "ปิดใช้งาน",
};

export default function MobileRoundSlotList({
  slots,
  bookings,
  unpaidBookings = [],
  underpaidCustomers = [],
  operationalDate,
  selectedLot,
  selectedRound,
  currentBlockStartTime,
  isLiveOperationalDate,
  onInspectionSaved,
}) {
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [draftUsed, setDraftUsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  // ผลที่เพิ่งบันทึกจากเครื่องนี้ ใช้แสดง "ตรวจแล้ว" ทันทีระหว่างรอข้อมูลใหม่จาก server
  const [localChecks, setLocalChecks] = useState({});
  const [lastSaved, setLastSaved] = useState(null);

  function inspectionKey(item) {
    return `${operationalDate}::${item.docId || item.customer}::${item.lot}::${item.startTime}`;
  }

  const roundCustomers = (underpaidCustomers || [])
    .filter((item) => item.lot === selectedLot && item.startTime === selectedRound)
    .map((item) => {
      const local = localChecks[inspectionKey(item)];
      if (!local || String(item.checkedAt || "") >= local.checkedAt) return item;
      return { ...item, hasOverride: true, roundActualUsed: local.used, checkedAt: local.checkedAt };
    });
  const pendingCustomers = roundCustomers.filter((item) => !item.hasOverride);
  const checkedCustomers = roundCustomers.filter((item) => item.hasOverride);
  const allChecked = roundCustomers.length > 0 && pendingCustomers.length === 0;
  const singleCustomer = roundCustomers.length === 1 ? roundCustomers[0] : null;
  const savedNotice =
    lastSaved && roundCustomers.some((item) => inspectionKey(item) === lastSaved.key)
      ? `✓ บันทึก ${lastSaved.name} แล้ว`
      : "";

  function openModal(item) {
    setPickingCustomer(false);
    setEditingCustomer(item);
    setDraftUsed(Number(item.roundActualUsed) || 0);
    setModalError("");
  }

  function openTopBarAction() {
    if (singleCustomer) {
      openModal(singleCustomer);
    } else if (roundCustomers.length > 1) {
      setEditingCustomer(null);
      setModalError("");
      setLastSaved(null);
      setPickingCustomer(true);
    }
  }

  function checkedDetail(item) {
    const time = formatBangkokTime(item.checkedAt);
    return `ใช้จริง ${item.roundActualUsed}/${item.roundContracted}${time ? ` · ${time} น.` : ""}`;
  }

  function renderPickerItem(item) {
    const checked = item.hasOverride;
    return (
      <div
        key={inspectionKey(item)}
        className={`inspection-picker-item${checked ? " is-checked" : ""}`}
        onClick={() => openModal(item)}
        role="button"
        tabIndex={0}
      >
        <div className="inspection-picker-info">
          <strong>{checked ? "✓ " : ""}{formatFieldCustomerName(item.customer)}</strong>
          <small>
            {checked
              ? checkedDetail(item)
              : `ตั๋วทั้งวัน ${item.dailyPaid}/${item.dailyContracted} · รอบนี้ ${item.roundActualUsed}/${item.roundContracted}`}
          </small>
        </div>
        <button
          type="button"
          className="btn-underpaid-edit"
          onClick={(e) => {
            e.stopPropagation();
            openModal(item);
          }}
        >
          {checked ? "แก้" : "ตรวจ"}
        </button>
      </div>
    );
  }

  function closeModal() {
    if (saving) return;
    setEditingCustomer(null);
    setPickingCustomer(false);
    setModalError("");
  }

  async function saveInspection() {
    if (!editingCustomer || saving) return;
    setSaving(true);
    setModalError("");
    try {
      const response = await fetch("/api/inspection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationalDate,
          docId: editingCustomer.docId,
          customer: editingCustomer.customer,
          lot: editingCustomer.lot,
          startTime: editingCustomer.startTime,
          contractedSlots: editingCustomer.roundContracted,
          actualUsedSlots: draftUsed,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "บันทึกไม่สำเร็จ");
      const key = inspectionKey(editingCustomer);
      setLocalChecks((current) => ({ ...current, [key]: { used: draftUsed, checkedAt: new Date().toISOString() } }));
      setLastSaved({ key, name: formatFieldCustomerName(editingCustomer.customer) });
      setEditingCustomer(null);
      if (roundCustomers.length > 1) setPickingCustomer(true);
      if (onInspectionSaved) await onInspectionSaved();
    } catch (err) {
      setModalError(err.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card mobile-round-slots">
      <h2>สถานะช่องรอบ {selectedRound}</h2>

      {roundCustomers.length > 0 && (
        <div className="underpaid-customer-list">
          {savedNotice && !pickingCustomer && !editingCustomer && (
            <div className="inspection-saved-note" role="status">{savedNotice}</div>
          )}
          <div
            className={`underpaid-customer-bar${allChecked ? " is-checked" : ""}`}
            onClick={openTopBarAction}
            role="button"
            tabIndex={0}
          >
            <span className="underpaid-customer-text">
              {singleCustomer ? (
                <>
                  <strong>
                    {allChecked ? "✓ ตรวจแล้ว" : "🟠 รอตรวจ"}: {formatFieldCustomerName(singleCustomer.customer)}
                  </strong>
                  <small>
                    {allChecked
                      ? checkedDetail(singleCustomer)
                      : `ตั๋ว ${singleCustomer.dailyPaid}/${singleCustomer.dailyContracted}`}
                  </small>
                </>
              ) : (
                <>
                  <strong>
                    {allChecked
                      ? `✓ ตรวจครบแล้ว ${checkedCustomers.length}/${roundCustomers.length}`
                      : `🟠 รอตรวจ ${pendingCustomers.length} ราย`}
                  </strong>
                  {!allChecked && <small>ตรวจแล้ว {checkedCustomers.length} จาก {roundCustomers.length}</small>}
                </>
              )}
            </span>
            <button
              type="button"
              className="btn-underpaid-edit"
              onClick={(e) => {
                e.stopPropagation();
                openTopBarAction();
              }}
            >
              {singleCustomer ? (allChecked ? "แก้" : "ตรวจ") : allChecked ? "ดู / แก้" : "เลือกชื่อ"}
            </button>
          </div>
        </div>
      )}

      <div className="mobile-slot-grid">
        {(slots || []).map((slot) => {
          const status = getDashboardCellStatus({
            slot,
            bookings,
            unpaidBookings,
            blockStartTime: selectedRound,
            currentBlockStartTime,
            isLiveOperationalDate,
          });
          const booking = bookingForBlock(bookings, slot.code, selectedRound);
          const unpaidBooking =
            status === "unpaid-booking"
              ? bookingForBlock(unpaidBookings, slot.code, selectedRound)
              : null;
          const fieldName = booking
            ? formatFieldCustomerName(booking.customer)
            : unpaidBooking
              ? formatFieldCustomerName(unpaidBooking.customer)
              : "";
          const savedAt = status === "ticket-check" ? formatBangkokTime(booking?.createdAt) : "";

          // สำหรับช่องหมดเวลาจอด (สีเหลือง): ดึงข้อมูลการจองของรอบก่อนหน้า
          const previousRound = status === "expired" ? getPreviousOperationalBlock(selectedRound) : null;
          const previousBooking = previousRound ? bookingForBlock(bookings, slot.code, previousRound.startTime) : null;
          const prevCustomer = previousBooking ? formatFieldCustomerName(previousBooking.customer) : "";

          let mainLabel = STATUS_LABELS[status];
          if (status === "booked" || status === "ticket-check" || status === "unpaid-booking") {
            mainLabel = fieldName || STATUS_LABELS[status];
          } else if (status === "expired") {
            mainLabel = prevCustomer || STATUS_LABELS[status];
          }

          const detail =
            status === "ticket-check"
              ? `รอตรวจตั๋ว${savedAt ? ` (${savedAt})` : ""}`
              : status === "unpaid-booking"
                ? "จองไว้แต่ไม่ตีตั๋ว"
                : status === "expired" && prevCustomer
                  ? "หมดเวลาจอด"
                  : "";

          const titleText =
            status === "expired" && previousBooking
              ? `${formatFieldCustomerName(previousBooking.customer)} — หมดเวลาจอด`
              : status === "unpaid-booking" && unpaidBooking
                ? `${formatFieldCustomerName(unpaidBooking.customer)} — จองไว้แต่ไม่ตีตั๋ว`
                : booking?.customer
                  ? formatFieldCustomerName(booking.customer)
                  : "";

          return (
            <div key={slot.code} className={`mobile-slot-card mobile-slot-${status}`} title={titleText}>
              <div className="mobile-slot-card-top">
                <strong>ช่อง {slot.number || "-"}</strong>
                {status === "unpaid-booking" && <span className="mobile-slot-badge-unpaid">ไม่ตีตั๋ว</span>}
              </div>
              <span className="mobile-slot-label">{mainLabel}</span>
              {detail && <small>{detail}</small>}
            </div>
          );
        })}
      </div>

      {pickingCustomer && !editingCustomer && roundCustomers.length > 1 && (
        <div className="inspection-modal-backdrop" onClick={closeModal}>
          <div className="inspection-modal" onClick={(e) => e.stopPropagation()}>
            <div className="inspection-modal-header">
              <strong>รอบ {selectedRound}</strong>
              <span>ตรวจแล้ว {checkedCustomers.length} จาก {roundCustomers.length}</span>
            </div>
            {savedNotice && <div className="inspection-saved-note" role="status">{savedNotice}</div>}
            <div className="inspection-picker-list">
              {pendingCustomers.length > 0 && (
                <div className="inspection-group-title">รอตรวจ ({pendingCustomers.length})</div>
              )}
              {pendingCustomers.map(renderPickerItem)}
              {checkedCustomers.length > 0 && (
                <div className="inspection-group-title is-checked">ตรวจแล้ว ({checkedCustomers.length})</div>
              )}
              {checkedCustomers.map(renderPickerItem)}
            </div>
            <div className="inspection-modal-actions" style={{ gridTemplateColumns: "1fr" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeModal}
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {editingCustomer && (
        <div className="inspection-modal-backdrop" onClick={closeModal}>
          <div className="inspection-modal" onClick={(e) => e.stopPropagation()}>
            {roundCustomers.length > 1 && (
              <button
                type="button"
                className="btn-back-picker"
                disabled={saving}
                onClick={() => {
                  setEditingCustomer(null);
                  setPickingCustomer(true);
                }}
              >
                ← เลือกชื่อลูกค้าอื่น
              </button>
            )}
            <div className="inspection-modal-header">
              <strong>{formatFieldCustomerName(editingCustomer.customer)}</strong>
              <span>(ตั๋ว {editingCustomer.dailyPaid}/{editingCustomer.dailyContracted})</span>
            </div>
            <div className="inspection-modal-body">
              <div className="inspection-stepper-label">ใช้จริงรอบนี้</div>
              <div className="inspection-stepper-controls">
                <button
                  type="button"
                  className="btn-stepper"
                  disabled={saving || draftUsed <= 0}
                  onClick={() => setDraftUsed((val) => Math.max(0, val - 1))}
                >
                  ➖
                </button>
                <div className="inspection-stepper-value">
                  {draftUsed} <span className="inspection-stepper-max">/ {editingCustomer.roundContracted}</span>
                </div>
                <button
                  type="button"
                  className="btn-stepper"
                  disabled={saving || draftUsed >= editingCustomer.roundContracted}
                  onClick={() =>
                    setDraftUsed((val) => Math.min(editingCustomer.roundContracted, val + 1))
                  }
                >
                  ➕
                </button>
              </div>
              {draftUsed >= editingCustomer.roundContracted && (
                <p className="inspection-limit-note">
                  ครบจำนวนที่จองไว้แล้ว หากต้องการช่องเพิ่ม กรุณาติดต่อ &ldquo;บริการลูกค้า&rdquo;
                </p>
              )}
              {modalError && <div className="alert alert-error">{modalError}</div>}
            </div>
            <div className="inspection-modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={closeModal}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={saveInspection}
              >
                {saving ? "กำลังบันทึก..." : "บันทึกผลตรวจ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
