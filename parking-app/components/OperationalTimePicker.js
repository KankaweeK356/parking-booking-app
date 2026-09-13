import { OPERATIONAL_TIME_BLOCKS } from "../lib/operational-day";

export default function OperationalTimePicker({ value, onChange, label = "รอบเวลา", required = false }) {
  return (
    <div className="time-picker-group">
      <label>{label}{required ? " (จำเป็น)" : ""}</label>
      <div className="time-block-picker" role="radiogroup" aria-label={label}>
        {OPERATIONAL_TIME_BLOCKS.map((block) => (
          <button
            type="button"
            key={block.startTime}
            className={`time-block-btn ${value === block.startTime ? "selected" : ""}`}
            aria-pressed={value === block.startTime}
            onClick={() => onChange(block.startTime)}
          >
            {block.label}
          </button>
        ))}
      </div>
    </div>
  );
}
