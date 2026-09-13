import { addMonthsToIso } from "../lib/operational-day";

export default function EndDateField({ startDate, value, onChange, label = "วันที่สิ้นสุด", required = true }) {
  return (
    <div className="end-date-field">
      <label>{label}{required ? " (จำเป็น)" : ""}</label>
      <input
        type="date"
        value={value}
        min={startDate || undefined}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      <div className="date-shortcuts" aria-label="เลือกวันสิ้นสุดแบบรวดเร็ว">
        {[1, 2, 3].map((months) => (
          <button
            type="button"
            className="btn btn-secondary"
            key={months}
            disabled={!startDate}
            onClick={() => onChange(addMonthsToIso(startDate, months))}
          >
            +{months} เดือน
          </button>
        ))}
      </div>
    </div>
  );
}
