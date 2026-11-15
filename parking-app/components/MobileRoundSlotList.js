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
  const [draftUsed, setDraftUsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const roundCustomers = (underpaidCustomers || []).filter(
    (item) => item.lot === selectedLot && item.startTime === selectedRound
  );

  function openModal(item) {
    setEditingCustomer(item);
    setDraftUsed(Number(item.roundActualUsed) || 0);
    setModalError("");
  }

  function closeModal() {
    if (saving) return;
    setEditingCustomer(null);
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
      setEditingCustomer(null);
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
          {roundCustomers.map((item) => (
            <div
              key={`${item.docId || item.customer}-${item.lot}-${item.startTime}`}
              className="underpaid-customer-bar"
            >
              <span className="underpaid-customer-text">
                🟠 <strong>{formatFieldCustomerName(item.customer)}</strong> (ตั๋ว {item.dailyPaid}/{item.dailyContracted})
              </span>
              <button
                type="button"
                className="btn-underpaid-edit"
                onClick={() => openModal(item)}
              >
                แก้
              </button>
            </div>
          ))}
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

      {editingCustomer && (
        <div className="inspection-modal-backdrop" onClick={closeModal}>
          <div className="inspection-modal" onClick={(e) => e.stopPropagation()}>
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
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
