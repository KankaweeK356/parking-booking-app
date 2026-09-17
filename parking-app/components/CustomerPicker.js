import { useEffect, useMemo, useState } from "react";
import { displayCustomerName } from "../lib/display";

export default function CustomerPicker({ customers = [], value, onChange, label = "ระบุชื่อลูกค้า", required = false }) {
  const selected = customers.find((item) => item.name === value);
  const [query, setQuery] = useState(selected ? displayCustomerName(selected.name) : "");
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(selected ? displayCustomerName(selected.name) : ""); }, [value, selected?.name]);
  const choices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return customers.filter((item) => !needle || displayCustomerName(item.name).toLocaleLowerCase().includes(needle)).slice(0, 80);
  }, [customers, query]);

  return <div className="customer-picker">
    <label>{label}{required ? " (จำเป็น)" : ""}</label>
    <input value={query} placeholder="พิมพ์ชื่อ หรือกดเพื่อเลือกรายชื่อ" autoComplete="off"
      onFocus={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); if (value) onChange(""); setOpen(true); }}
      onBlur={() => setTimeout(() => setOpen(false), 150)} required={required} />
    {open && <div className="customer-options" role="listbox">
      {choices.length ? choices.map((item) => <button key={`${item.docId}-${item.name}`} type="button" className="customer-option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(item.name); setQuery(displayCustomerName(item.name)); setOpen(false); }}>
        {displayCustomerName(item.name)}
      </button>) : <p className="subtitle">ไม่พบชื่อลูกค้า</p>}
    </div>}
  </div>;
}
