// Presentation helpers only. The original master name is always retained for
// Sheet lookups and booking writes; UI displays unified format e.g. "01รุ่งเพชร นารัมย์".
export function displayCustomerName(name) {
  if (!name) return "";
  const trimmed = String(name).trim();
  const match = trimmed.match(/^(\d+)?\s*(?:คุณ|นางสาว|น\.ส\.|นาย|นาง|Mr\.|Mrs\.|Ms\.)?\s*(.+)$/i);
  if (match) {
    const num = match[1] || "";
    const rest = (match[2] || "").trim().replace(/\s+/g, " ");
    return `${num}${rest}` || trimmed;
  }
  return trimmed;
}

export function displayLotName(lot) {
  const value = String(lot || "").trim();
  return value.replace(/^ลาน\s*ลานจอด\s*/i, "ลานจอด ");
}

export function formatFieldCustomerName(name) {
  return displayCustomerName(name);
}
