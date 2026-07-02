// Stripe + prepaid credit wallet. All ledger + Stripe logic lives here so
// index.js routes stay thin. Money is integer pence; balance = SUM(ledger).
import Stripe from "stripe";
import { db, getSetting } from "./db.js";
import { planPriceUsd } from "./plans.js";
import { recordSystem } from "./audit.js";

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

// --- Stripe (test mode first; live keys are a config swap, not a code change) ---

let _stripe; // lazily constructed; null when no key (importing billing.js stays safe in tests)
export function stripeClient() {
  if (_stripe !== undefined) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  _stripe = key ? new Stripe(key) : null;
  return _stripe;
}
// Tests inject a stub so no real Stripe call is made (money tests hit the ledger).
export function setStripeForTests(stub) { _stripe = stub; }

// Org's stable primary-owner email — the Stripe customer's email.
function ownerEmail(orgId) {
  return db.prepare(
    "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id " +
      "WHERE m.org_id = ? AND m.role = 'owner' ORDER BY m.created_at LIMIT 1"
  ).get(orgId)?.email || null;
}

// Lazy: creates the Stripe customer on first top-up (a Stripe outage must not block
// org creation). stripe_customer_id (cus_…) is NOT a secret — stored plaintext.
export async function getOrCreateStripeCustomer(orgId) {
  const row = db.prepare("SELECT stripe_customer_id, name FROM organizations WHERE id = ?").get(orgId);
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const stripe = stripeClient();
  if (!stripe) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  const customer = await stripe.customers.create(
    { email: ownerEmail(orgId), name: row?.name, metadata: { org_id: String(orgId) } },
    { idempotencyKey: `create-customer-${orgId}` }
  );
  db.prepare("UPDATE organizations SET stripe_customer_id = ? WHERE id = ?").run(customer.id, orgId);
  return customer.id;
}

// Hosted Checkout — no card data touches Express. Inline price_data so any amount works;
// a nonce lets an owner top up twice in a day.
export async function createTopupSession({ orgId, amountPence, successUrl, cancelUrl }) {
  const stripe = stripeClient();
  if (!stripe) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  const customer = await getOrCreateStripeCustomer(orgId);
  const nonce = Math.random().toString(36).slice(2, 10);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer,
      line_items: [{
        price_data: {
          currency: "gbp",
          unit_amount: amountPence,
          product_data: { name: "Account credit top-up" },
        },
        quantity: 1,
      }],
      metadata: { org_id: String(orgId), amount_pence: String(amountPence) },
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    { idempotencyKey: `topup-session-${orgId}-${nonce}` }
  );
  return { url: session.url };
}

// Process a verified webhook event. Only paid, payment-mode Checkout sessions credit
// the wallet; the UNIQUE(stripe_session_id) guard makes a replay a silent no-op.
// ponytail: GBP cards are synchronous, so no async_payment_succeeded handling until BACS.
export function handleWebhookEvent(event) {
  if (event.type !== "checkout.session.completed") return { credited: false };
  const s = event.data.object;
  if (s.mode !== "payment" || s.payment_status !== "paid") return { credited: false };
  const orgId = Number(s.metadata?.org_id);
  const amountPence = Number(s.metadata?.amount_pence);
  if (!orgId || !Number.isFinite(amountPence)) return { credited: false };
  const { inserted } = creditWallet({
    orgId, amountPence, type: "topup", stripeSessionId: s.id, notes: "Stripe top-up",
  });
  if (inserted) recordSystem("billing.topup_credited", { metadata: { org_id: orgId, amount_pence: amountPence, session: s.id } });
  return { credited: inserted };
}
