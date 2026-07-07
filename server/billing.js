// Stripe + prepaid credit wallet. All ledger + Stripe logic lives here so
// index.js routes stay thin. Money is integer pence; balance = SUM(ledger).
import Stripe from "stripe";
import { db, getSetting, setSetting } from "./db.js";
import { planPriceUsd, MAIL_PLANS } from "./plans.js";
import { recordSystem } from "./audit.js";
import { compFactor } from "./comp.js";

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
  stripeSessionId = null, stripePaymentIntentId = null, period = null, notes = null, createdBy = null,
}) {
  const info = db.prepare(
    `INSERT OR IGNORE INTO credit_ledger
       (org_id, amount_pence, type, stripe_session_id, stripe_payment_intent_id, period, notes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(orgId, amountPence, type, stripeSessionId, stripePaymentIntentId, period, notes, nowIso(), createdBy);
  return { inserted: info.changes > 0 };
}

// `by` is the actor's email for admin actions, null for system/webhook entries.
export const recentLedger = (orgId, limit = 20) =>
  db.prepare(
    "SELECT cl.id, cl.amount_pence, cl.type, cl.period, cl.notes, cl.created_at, u.email AS by " +
      "FROM credit_ledger cl LEFT JOIN users u ON u.id = cl.created_by " +
      "WHERE cl.org_id = ? ORDER BY cl.created_at DESC, cl.id DESC LIMIT ?"
  ).all(orgId, limit);

// --- monthly hardware charge ------------------------------------------------

export const currentPeriod = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Email hosting is priced natively in GBP pence per mailbox (not USD→GBP converted).
const MAILBOX_PENCE = MAIL_PLANS[0]?.pricePence || 299;

// Per-org email charge (pence): mailbox count (tracked in mail_mailboxes) × the rate.
export function mailChargePence(orgId) {
  return db.prepare("SELECT COUNT(*) c FROM mail_mailboxes WHERE org_id = ?").get(orgId).c * MAILBOX_PENCE;
}

// Sum the org's owned resources' plan price + its email mailboxes. Compute/DB convert
// USD→pence (round once); email is already GBP pence. comp/discount applies to both.
export function computeMonthlyCharge(orgId) {
  const rows = db.prepare("SELECT plan_id FROM resource_ownership WHERE org_id = ?").all(orgId);
  const usd = rows.reduce((sum, r) => sum + planPriceUsd(r.plan_id), 0);
  const factor = compFactor(orgId);
  const hardware = usdToPence(usd * factor);              // compute + DB (USD-priced)
  const mail = Math.round(mailChargePence(orgId) * factor); // email (GBP-native)
  return hardware + mail;
}

// Idempotent per (org, period). Debits the wallet (prepaid-only — NEVER calls Stripe).
// A negative resulting balance is tracked as arrears; the advisory banner asks the owner
// to top up. Nothing is suspended.
// better-sqlite3 is synchronous + single-connection, so the guard-check + insert below
// is race-free without an explicit BEGIN.
// ponytail: subsystem B usage drawdown lands here — an additional type='usage' debit
// computed from B's metering, same wallet, same shape. Wire after B ships.
export function chargeMonthlyHardware(orgId, period) {
  // Cutover: once an org is on a Stripe subscription, the fixed monthly service fee is
  // billed there — do NOT also debit the wallet for it (the wallet is usage-only now).
  // Read the subscription state directly from app_settings to avoid a circular import.
  let sub = {};
  try { sub = JSON.parse(getSetting(`org_sub_${orgId}`) || "{}"); } catch { sub = {}; }
  if (sub.subscriptionId || ["active", "trialing", "past_due"].includes(sub.status)) {
    return { charged: 0, skipped: "on_subscription" };
  }
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

// --- Stripe: mode-aware (test | live), switchable at runtime with NO restart ------
// The active mode is stored in app_settings; the operator flips it from the Stripe
// admin page. Keys come from env (never the DB): prefer mode-specific
// STRIPE_SECRET_KEY_{TEST,LIVE}; fall back to the single STRIPE_SECRET_KEY when its
// sk_test_/sk_live_ prefix matches the requested mode (back-compat with older .env).
function stripeKeyFor(mode) {
  const specific = mode === "live" ? process.env.STRIPE_SECRET_KEY_LIVE : process.env.STRIPE_SECRET_KEY_TEST;
  if (specific) return specific;
  const single = process.env.STRIPE_SECRET_KEY || "";
  if (single.startsWith(mode === "live" ? "sk_live_" : "sk_test_")) return single;
  return null;
}
export function stripeModeAvailable(mode) { return !!stripeKeyFor(mode); }

// Active mode: the stored setting, else inferred from whichever key exists (live wins).
export function stripeMode() {
  const m = getSetting("stripe_mode");
  if (m === "test" || m === "live") return m;
  return stripeModeAvailable("live") ? "live" : "test";
}

const _clients = new Map(); // mode -> Stripe | null (cached per mode; cleared on toggle)
export function stripeClient() {
  const mode = stripeMode();
  if (_clients.has(mode)) return _clients.get(mode);
  const key = stripeKeyFor(mode);
  const client = key ? new Stripe(key) : null;
  _clients.set(mode, client);
  return client;
}

// Flip test<->live at runtime. Refuses a mode with no key. Clears the client cache so
// the very next stripeClient() call talks to the newly-selected environment.
export function setStripeMode(mode) {
  if (mode !== "test" && mode !== "live") throw Object.assign(new Error("mode must be 'test' or 'live'"), { status: 400 });
  if (!stripeKeyFor(mode)) throw Object.assign(new Error(`No ${mode}-mode Stripe secret key is configured`), { status: 400 });
  setSetting("stripe_mode", mode);
  _clients.clear();
  return mode;
}

// Webhook signing secret for the active mode (mode-specific env, else the single secret).
export function stripeWebhookSecret() {
  const mode = stripeMode();
  return (mode === "live" ? process.env.STRIPE_WEBHOOK_SECRET_LIVE : process.env.STRIPE_WEBHOOK_SECRET_TEST)
    || process.env.STRIPE_WEBHOOK_SECRET || null;
}

// Tests inject a stub so no real Stripe call is made (money tests hit the ledger).
export function setStripeForTests(stub) { _clients.set(stripeMode(), stub); }

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
  // Off-session auto-recharge lands as a PaymentIntent (never a Checkout session), so credit it
  // here as a crash-safe backstop. Idempotent on the PI id — a no-op if the sync credit already ran.
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    if (pi?.metadata?.type !== "wallet_autorecharge") return { credited: false };
    const orgId = Number(pi.metadata.org_id);
    const amountPence = pi.amount_received ?? pi.amount;
    if (!orgId || !Number.isInteger(amountPence) || amountPence <= 0) return { credited: false };
    const { inserted } = creditWallet({ orgId, amountPence, type: "topup", stripePaymentIntentId: pi.id, notes: "Auto top-up" });
    if (inserted) recordSystem("billing.autorecharge_credited", { metadata: { org_id: orgId, amount_pence: amountPence, pi: pi.id } });
    return { credited: inserted };
  }
  if (event.type !== "checkout.session.completed") return { credited: false };
  const s = event.data.object;
  if (s.mode !== "payment" || s.payment_status !== "paid") return { credited: false };
  const orgId = Number(s.metadata?.org_id);
  const amountPence = s.amount_total; // authoritative charged amount (minor units); metadata is only what was requested
  if (!orgId || !Number.isInteger(amountPence) || amountPence <= 0) {
    recordSystem("billing.topup_skipped", { metadata: { reason: "bad_amount_total", session: s.id, amount_total: s.amount_total } });
    return { credited: false };
  }
  const { inserted } = creditWallet({
    orgId, amountPence, type: "topup", stripeSessionId: s.id, notes: "Stripe top-up",
  });
  if (inserted) recordSystem("billing.topup_credited", { metadata: { org_id: orgId, amount_pence: amountPence, session: s.id } });
  return { credited: inserted };
}
