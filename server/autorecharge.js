// Off-session wallet auto-recharge. When the GBP overage wallet drops below the org's
// threshold, charge the card Stripe saved during subscription setup and credit the wallet.
// State is a JSON blob in app_settings (no migration), like getSubState / getComp.
//
// The wallet is GBP-only (createTopupSession hardcodes gbp), so this charges GBP too — the
// `...Pence` fields are literally pence. If the wallet ever goes multi-currency, this and
// createTopupSession change together.
import { getSetting, setSetting } from "./db.js";
import { walletBalance, creditWallet, stripeClient, getOrCreateStripeCustomer } from "./billing.js";
import { getComp } from "./comp.js";
import { recordSystem } from "./audit.js";

const DEFAULTS = { enabled: true, thresholdPence: 500, amountPence: 2500, consecutiveFails: 0, inflightToken: null };
const MAX_FAILS = 3; // disable after this many consecutive failures (card dead / needs 3DS)
const key = (orgId) => `org_autorecharge_${orgId}`;

export function getAutoRecharge(orgId) {
  try { return { ...DEFAULTS, ...JSON.parse(getSetting(key(orgId)) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function save(orgId, patch) {
  const next = { ...getAutoRecharge(orgId), ...patch };
  setSetting(key(orgId), JSON.stringify(next));
  return next;
}

// Client-editable fields only — never the internal counters/lock.
export function setAutoRecharge(orgId, { enabled, thresholdPence, amountPence } = {}) {
  const patch = {};
  if (enabled !== undefined) patch.enabled = !!enabled;
  if (thresholdPence !== undefined) {
    const n = Number(thresholdPence);
    if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error("thresholdPence must be a non-negative integer (pence)"), { status: 400 });
    patch.thresholdPence = n;
  }
  if (amountPence !== undefined) {
    const n = Number(amountPence);
    if (!Number.isInteger(n) || n < 100) throw Object.assign(new Error("amountPence must be an integer >= 100 (pence)"), { status: 400 });
    patch.amountPence = n;
  }
  // A manual re-enable clears the failure counter so a fixed card gets a fresh run.
  if (patch.enabled === true) patch.consecutiveFails = 0;
  return save(orgId, patch);
}

async function defaultPaymentMethod(stripe, customerId) {
  const cust = await stripe.customers.retrieve(customerId);
  return cust?.invoice_settings?.default_payment_method || null;
}

// Top up the wallet off-session when it's below threshold. Idempotent (Stripe key) and
// single-flight (a sync lock acquired before the first await). Never throws — returns a
// { charged } / { skipped } / { failed } summary. Safe to call opportunistically.
export async function maybeAutoRecharge(orgId) {
  const cfg = getAutoRecharge(orgId);
  // --- purely synchronous gate (better-sqlite3 is sync, so no interleave before the lock) ---
  if (!cfg.enabled) return { skipped: "disabled" };
  if (getComp(orgId).comp) return { skipped: "comp" };
  if (walletBalance(orgId) >= cfg.thresholdPence) return { skipped: "above_threshold" };
  if (cfg.inflightToken) return { skipped: "in_flight" };
  const stripe = stripeClient();
  if (!stripe) return { skipped: "stripe_unconfigured" };

  // Acquire the single-flight lock BEFORE any await — a concurrent call now sees inflightToken.
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  save(orgId, { inflightToken: token });

  try {
    const customer = await getOrCreateStripeCustomer(orgId);
    const pm = await defaultPaymentMethod(stripe, customer);
    if (!pm) { save(orgId, { inflightToken: null }); return { skipped: "no_card" }; }

    const pi = await stripe.paymentIntents.create(
      {
        amount: cfg.amountPence, currency: "gbp", customer, payment_method: pm,
        off_session: true, confirm: true,
        metadata: { type: "wallet_autorecharge", org_id: String(orgId) },
      },
      { idempotencyKey: `autorecharge-${orgId}-${token}` },
    );
    if (pi.status !== "succeeded") throw Object.assign(new Error(`payment_intent ${pi.status}`), { code: pi.status });

    // Credit via the shared ledger path — idempotent on the PI id (UNIQUE), so a webhook
    // backstop delivering the same PI is a no-op.
    creditWallet({ orgId, amountPence: cfg.amountPence, type: "topup", stripePaymentIntentId: pi.id, notes: "Auto top-up" });
    save(orgId, { consecutiveFails: 0, inflightToken: null });
    recordSystem("billing.autorecharge_succeeded", { metadata: { org_id: orgId, amount_pence: cfg.amountPence, pi: pi.id } });
    return { charged: cfg.amountPence };
  } catch (e) {
    const fails = cfg.consecutiveFails + 1;
    const disabled = fails >= MAX_FAILS;
    save(orgId, { consecutiveFails: fails, inflightToken: null, enabled: disabled ? false : cfg.enabled });
    // Advisory only — never blocks. recorded to the activity feed; a push/email hook can attach here.
    recordSystem("billing.autorecharge_failed", { metadata: { org_id: orgId, error: e.message, fails, disabled } });
    return { failed: true, fails, disabled };
  }
}
