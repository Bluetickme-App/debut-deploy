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

// --- wallet ledger ----------------------------------------------------------

const nowIso = () => new Date().toISOString();

// Balance is always a live SUM — no cached column, nothing to drift.
export function walletBalance(orgId) {
  return db.prepare("SELECT COALESCE(SUM(amount_pence),0) b FROM credit_ledger WHERE org_id = ?").get(orgId).b;
}

// Single INSERT OR IGNORE. The UNIQUE(stripe_session_id)/(stripe_payment_intent_id)
// columns make a duplicate webhook delivery a silent no-op (idempotent crediting).
// Returns { inserted } so the webhook can tell a first delivery from a replay.
export function creditWallet({
  orgId, amountPence, type,
  stripeSessionId = null, stripePaymentIntentId = null, period = null, notes = null,
}) {
  const info = db.prepare(
    `INSERT OR IGNORE INTO credit_ledger
       (org_id, amount_pence, type, stripe_session_id, stripe_payment_intent_id, period, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(orgId, amountPence, type, stripeSessionId, stripePaymentIntentId, period, notes, nowIso());
  return { inserted: info.changes > 0 };
}

export const recentLedger = (orgId, limit = 20) =>
  db.prepare(
    "SELECT id, amount_pence, type, period, notes, created_at FROM credit_ledger " +
      "WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(orgId, limit);

// --- monthly hardware charge ------------------------------------------------

export const currentPeriod = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Sum the org's owned resources' plan price. Convert USD→pence once, after summing
// (round once, not per-resource). NULL plan_id → 0 (free until assigned).
export function computeMonthlyCharge(orgId) {
  const rows = db.prepare("SELECT plan_id FROM resource_ownership WHERE org_id = ?").all(orgId);
  const usd = rows.reduce((sum, r) => sum + planPriceUsd(r.plan_id), 0);
  return usdToPence(usd);
}

// Idempotent per (org, period). Debits the wallet (prepaid-only — NEVER calls Stripe).
// A negative resulting balance is tracked as arrears; the advisory banner asks the owner
// to top up. Nothing is suspended.
// better-sqlite3 is synchronous + single-connection, so the guard-check + insert below
// is race-free without an explicit BEGIN.
// ponytail: subsystem B usage drawdown lands here — an additional type='usage' debit
// computed from B's metering, same wallet, same shape. Wire after B ships.
export function chargeMonthlyHardware(orgId, period) {
  const already = db.prepare(
    "SELECT 1 FROM credit_ledger WHERE org_id = ? AND type = 'hardware_charge' AND period = ?"
  ).get(orgId, period);
  if (already) return { charged: 0, skipped: "already_charged" };

  const charge = computeMonthlyCharge(orgId);
  if (charge === 0) return { charged: 0, skipped: "no_priced_resources" };

  creditWallet({ orgId, amountPence: -charge, type: "hardware_charge", period, notes: `Hardware ${period}` });
  const status = walletBalance(orgId) < 0 ? "arrears" : "ok";
  db.prepare("UPDATE organizations SET billing_status = ? WHERE id = ?").run(status, orgId);
  return { charged: charge };
}
