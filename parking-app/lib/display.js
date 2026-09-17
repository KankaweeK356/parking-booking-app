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
