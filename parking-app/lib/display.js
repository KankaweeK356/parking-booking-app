// Presentation helpers only.  The original master name is always retained for
// Sheet lookups and booking writes; this removes an import/order number from UI.
export function displayCustomerName(name) {
  const cleaned = String(name || "").replace(/^\s*\d+\s*/, "").trim();
  return cleaned || String(name || "").trim();
}

export function displayLotName(lot) {
  const value = String(lot || "").trim();
  return value.replace(/^ลาน\s*ลานจอด\s*/i, "ลานจอด ");
}

// Field staff / Security guard helper: extracts [number][prefix][first-name]
// e.g. "01คุณรุ่งเพชร นารัมย์" -> "01คุณรุ่งเพชร", "21Mr.Nary Troeng" -> "21Mr.Nary"
export function formatFieldCustomerName(name) {
  if (!name) return "";
  const trimmed = String(name).trim();

  // Foreign names with Mr. / Mrs. / Ms. / MR.
  const foreignMatch = trimmed.match(/^(\d+)?\s*(Mr\.|Mrs\.|Ms\.|MR\.)\s*([^\s]+)/i);
  if (foreignMatch) {
    const num = foreignMatch[1] || "";
    const prefix = foreignMatch[2];
    const firstWord = foreignMatch[3];
    return `${num}${prefix}${firstWord}`;
  }

  // Thai names: take first word (order number + prefix + first name)
  return trimmed.split(/\s+/)[0] || trimmed;
}
