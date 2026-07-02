// Stripe + prepaid credit wallet. All ledger + Stripe logic lives here so
// index.js routes stay thin. Money is integer pence; balance = SUM(ledger).
import { db, getSetting } from "./db.js";
import { planPriceUsd } from "./plans.js";

const DEFAULT_USD_GBP_RATE = 0.79; // ponytail: flat rate; swap in FX feed if drift becomes material

// USD→GBP rate from app_settings (operator-editable). Shared with subsystem B.
// ponytail: default 0.79; a real FX feed slots in here if the flat rate ever drifts.
export function usdGbpRate() {
  const raw = getSetting("usd_gbp_rate");
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_GBP_RATE;
}

// The one float→int money conversion. Math.round at the plans.js boundary.
// ponytail: integer pence in the DB from here on; never store the float.
export function usdToPence(usd) {
  return Math.round(Number(usd) * usdGbpRate() * 100);
}

export { planPriceUsd }; // re-export so callers get plan lookup + conversion from one module
