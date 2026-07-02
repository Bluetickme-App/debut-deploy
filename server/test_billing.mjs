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
