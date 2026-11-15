import { useEffect, useMemo, useState } from "react";
import { displayCustomerName } from "../lib/display";

export default function CustomerPicker({ customers = [], value, onChange, label = "ค้นหาลูกค้า (ชื่อ หรือ รหัส)", required = false }) {
  const selected = customers.find((item) => item.name === value);
  const [query, setQuery] = useState(selected ? displayCustomerName(selected.name) : "");
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(selected ? displayCustomerName(selected.name) : ""); }, [value, selected?.name]);
  const choices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return customers.filter((item) => {
      if (!needle) return true;
      const formatted = displayCustomerName(item.name).toLocaleLowerCase();
      const raw = String(item.name || "").toLocaleLowerCase();
      const docId = String(item.docId || "").toLocaleLowerCase();
      return formatted.includes(needle) || raw.includes(needle) || docId.includes(needle);
    }).slice(0, 80);
  }, [customers, query]);

  return <div className="customer-picker">
    <label>{label}{required ? " *" : ""}</label>
    <input type="text" value={query} placeholder="พิมพ์ชื่อ หรือกดเพื่อเลือก" autoComplete="off"
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
