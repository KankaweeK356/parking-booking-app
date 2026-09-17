import { OPERATIONAL_TIME_BLOCKS } from "../lib/operational-day";

export default function OperationalTimePicker({ value, values, onChange, label = "รอบเวลา", required = false, multiple = false, availableValues, onUnavailableSelect }) {
  const selectedValues = multiple ? (values || []) : [value];
  function selectTime(startTime) {
    if (!multiple) return onChange(startTime);
    onChange(selectedValues.includes(startTime) ? selectedValues.filter((time) => time !== startTime) : [...selectedValues, startTime]);
  }
  return (
    <div className="time-picker-group">
      <label>{label}{required ? " (จำเป็น)" : ""}</label>
      <div className="time-block-picker" role="radiogroup" aria-label={label}>
        {OPERATIONAL_TIME_BLOCKS.map((block) => {
          const unavailable = Array.isArray(availableValues) && !availableValues.includes(block.startTime);
          return (
          <button
            type="button"
            key={block.startTime}
            className={`time-block-btn ${selectedValues.includes(block.startTime) ? "selected" : ""} ${unavailable ? "unavailable" : ""}`}
            aria-pressed={selectedValues.includes(block.startTime)}
            aria-disabled={unavailable}
            title={unavailable ? "รอบนี้เริ่มไปแล้ว จึงบันทึกสิทธิ์ระหว่างวันไม่ได้" : ""}
            onClick={() => unavailable ? onUnavailableSelect?.(block) : selectTime(block.startTime)}
          >
            {block.label}
          </button>
          );
        })}
      </div>
    </div>
  );
}
