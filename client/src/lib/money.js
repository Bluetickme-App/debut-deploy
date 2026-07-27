// Money + billing-date formatting. The API talks in MINOR units (pence/cents) and an
// org currency ('gbp' | 'usd'), so every amount the customer confirms is formatted
// through here — a float slipping into a price string is how "£4.5/mo" happens.

const SYMBOL = { gbp: "£", usd: "$" };

export const currencySymbol = (currency) => SYMBOL[String(currency || "gbp").toLowerCase()] || "£";

// 1185, 'gbp' → "£11.85". Negative amounts keep the sign in front of the symbol.
export function fmtMinor(minor, currency = "gbp") {
  const n = Number(minor) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}${currencySymbol(currency)}${(Math.abs(n) / 100).toFixed(2)}`;
}

// Same, with the sign always shown — for a delta the customer is agreeing to.
export function fmtDelta(minor, currency = "gbp") {
  const n = Number(minor) || 0;
  if (n === 0) return fmtMinor(0, currency);
  return `${n > 0 ? "+" : "−"}${fmtMinor(Math.abs(n), currency)}`;
}

// "2026-08-01T00:00:00.000Z" → "1 Aug 2026"
export function fmtBillingDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
