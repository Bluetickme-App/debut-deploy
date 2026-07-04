// Run: node --test server/autorecharge.test.js
// Off-session wallet auto-recharge: when to fire, currency, idempotency, failure handling.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
const { db, createUser, getUserByEmail, ensureUserOrg, getSetting, setSetting } = await import("./db.js");
const { walletBalance, creditWallet, setStripeForTests, handleWebhookEvent } = await import("./billing.js");
const { setComp } = await import("./comp.js");
const { getAutoRecharge, setAutoRecharge, maybeAutoRecharge } = await import("./autorecharge.js");

let seq = 0;
function mkOrg(balancePence = 0) {
  const email = `ar${++seq}@x.com`;
  createUser({ email, name: "ar", role: "admin" });
  const org = ensureUserOrg(getUserByEmail(email).id);
  db.prepare("UPDATE organizations SET stripe_customer_id = ? WHERE id = ?").run(`cus_${org}`, org);
  if (balancePence) creditWallet({ orgId: org, amountPence: balancePence, type: "topup", notes: "seed" });
  return org;
}

function stubStripe({ pm = "pm_1", piStatus = "succeeded", piError = null } = {}) {
  const calls = { pi: [] };
  setStripeForTests({
    calls,
    customers: { retrieve: async () => ({ invoice_settings: { default_payment_method: pm } }) },
    paymentIntents: {
      create: async (params, opts) => { calls.pi.push({ params, opts }); if (piError) throw piError; return { id: `pi_${calls.pi.length}`, status: piStatus }; },
    },
  });
  return calls;
}

test("skips when disabled / comped / already above threshold", async () => {
  const calls = stubStripe();
  const a = mkOrg(); setAutoRecharge(a, { enabled: false });
  assert.equal((await maybeAutoRecharge(a)).skipped, "disabled");

  const b = mkOrg(); setComp(b, { comp: true });
  assert.equal((await maybeAutoRecharge(b)).skipped, "comp");

  const c = mkOrg(600); // default threshold is 500 → 600 is above
  assert.equal((await maybeAutoRecharge(c)).skipped, "above_threshold");

  assert.equal(calls.pi.length, 0, "no charge attempted for any skip");
});

test("skips (no charge, lock released) when the customer has no card on file", async () => {
  stubStripe({ pm: null });
  const org = mkOrg();
  assert.equal((await maybeAutoRecharge(org)).skipped, "no_card");
  assert.equal(getAutoRecharge(org).inflightToken, null, "lock released so a later attempt can proceed");
});

test("charges the saved card in GBP off-session and credits the wallet once", async () => {
  const calls = stubStripe();
  const org = mkOrg();
  const r = await maybeAutoRecharge(org);
  assert.equal(r.charged, 2500);
  assert.equal(walletBalance(org), 2500);
  const { params, opts } = calls.pi[0];
  assert.equal(params.currency, "gbp");
  assert.equal(params.off_session, true);
  assert.equal(params.confirm, true);
  assert.equal(params.metadata.type, "wallet_autorecharge");
  assert.match(opts.idempotencyKey, new RegExp(`^autorecharge-${org}-`));
  assert.equal(getAutoRecharge(org).inflightToken, null, "lock released after success");
});

test("an in-flight lock makes a concurrent call skip", async () => {
  stubStripe();
  const org = mkOrg();
  setSetting(`org_autorecharge_${org}`, JSON.stringify({ ...getAutoRecharge(org), inflightToken: "held" }));
  assert.equal((await maybeAutoRecharge(org)).skipped, "in_flight");
});

test("a declined card counts a failure and disables after 3 consecutive fails", async () => {
  stubStripe({ piError: Object.assign(new Error("Your card was declined"), { code: "card_declined" }) });
  const org = mkOrg();

  let r = await maybeAutoRecharge(org);
  assert.equal(r.failed, true); assert.equal(getAutoRecharge(org).consecutiveFails, 1);
  assert.equal(getAutoRecharge(org).enabled, true, "still enabled after one fail");
  assert.equal(getAutoRecharge(org).inflightToken, null, "lock released on failure");

  await maybeAutoRecharge(org);
  r = await maybeAutoRecharge(org);
  assert.equal(r.disabled, true);
  assert.equal(getAutoRecharge(org).enabled, false, "auto-recharge disabled after 3 fails");
});

test("webhook backstop credits a wallet_autorecharge PI once (idempotent with the sync credit)", () => {
  const org = mkOrg();
  const evt = { type: "payment_intent.succeeded", data: { object: { id: "pi_wh1", amount: 2500, amount_received: 2500, metadata: { type: "wallet_autorecharge", org_id: String(org) } } } };
  assert.equal(handleWebhookEvent(evt).credited, true);
  assert.equal(walletBalance(org), 2500);
  assert.equal(handleWebhookEvent(evt).credited, false, "replay is a no-op");
  assert.equal(walletBalance(org), 2500);
});

test("webhook ignores a payment_intent that isn't an auto-recharge", () => {
  const evt = { type: "payment_intent.succeeded", data: { object: { id: "pi_other", amount: 999, metadata: {} } } };
  assert.equal(handleWebhookEvent(evt).credited, false);
});
