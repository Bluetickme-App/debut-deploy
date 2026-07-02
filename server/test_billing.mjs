// Billing: ledger + idempotency + charge math. Run: node --test server/test_billing.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const db = await import("./db.js");
const { planPriceUsd } = await import("./plans.js");
const billing = await import("./billing.js");

test("planPriceUsd looks up compute + db catalogs; unknown → 0", () => {
  assert.equal(planPriceUsd("pro"), 15);
  assert.equal(planPriceUsd("db-pro"), 45);
  assert.equal(planPriceUsd("nope"), 0);
  assert.equal(planPriceUsd(null), 0);
});

test("usdToPence uses the configurable rate (default 0.79) and rounds", () => {
  // default rate 0.79: 15 USD → round(15*0.79*100) = round(1185) = 1185
  assert.equal(billing.usdToPence(15), 1185);
  db.setSetting("usd_gbp_rate", "0.80");
  assert.equal(billing.usdToPence(15), 1200); // round(15*0.80*100)
  db.setSetting("usd_gbp_rate", "0.79"); // restore for later tests
  assert.equal(billing.usdToPence(0), 0);
});

test("balance = SUM(amount_pence), integer pence, may go negative (arrears)", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Bal Co", "bal-co", now).lastInsertRowid;
  assert.equal(billing.walletBalance(org), 0); // empty ledger → £0
  billing.creditWallet({ orgId: org, amountPence: 1000, type: "topup", stripeSessionId: "cs_bal_1" }); // +£10
  billing.creditWallet({ orgId: org, amountPence: -300, type: "hardware_charge", period: "2026-07" }); // −£3
  assert.equal(billing.walletBalance(org), 700); // £7
  billing.creditWallet({ orgId: org, amountPence: -1000, type: "hardware_charge", period: "2026-08" }); // −£10
  assert.equal(billing.walletBalance(org), -300); // arrears, still integer
});

test("CRITICAL: crediting the same stripe_session_id twice inserts ONE row", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Idem Co", "idem-co", now).lastInsertRowid;
  const r1 = billing.creditWallet({ orgId: org, amountPence: 2500, type: "topup", stripeSessionId: "cs_dup" });
  const r2 = billing.creditWallet({ orgId: org, amountPence: 2500, type: "topup", stripeSessionId: "cs_dup" });
  assert.equal(r1.inserted, true);
  assert.equal(r2.inserted, false); // silent no-op on replay
  assert.equal(billing.walletBalance(org), 2500); // credited once, not twice
  const rows = db.db.prepare("SELECT COUNT(*) c FROM credit_ledger WHERE stripe_session_id='cs_dup'").get();
  assert.equal(rows.c, 1);
});
