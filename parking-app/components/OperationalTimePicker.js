import { OPERATIONAL_TIME_BLOCKS } from "../lib/operational-day";

export default function OperationalTimePicker({ value, values, onChange, label = "รอบเวลา", required = false, multiple = false }) {
  const selectedValues = multiple ? (values || []) : [value];
  function selectTime(startTime) {
    if (!multiple) return onChange(startTime);
    onChange(selectedValues.includes(startTime) ? selectedValues.filter((time) => time !== startTime) : [...selectedValues, startTime]);
  }
  return (
    <div className="time-picker-group">
      <label>{label}{required ? " (จำเป็น)" : ""}</label>
      <div className="time-block-picker" role="radiogroup" aria-label={label}>
        {OPERATIONAL_TIME_BLOCKS.map((block) => (
          <button
            type="button"
            key={block.startTime}
            className={`time-block-btn ${selectedValues.includes(block.startTime) ? "selected" : ""}`}
            aria-pressed={selectedValues.includes(block.startTime)}
            onClick={() => selectTime(block.startTime)}
          >
            {block.label}
          </button>
        ))}
      </div>
    </div>
  );
}
