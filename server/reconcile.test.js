// Run: node --test server/reconcile.test.js
// Webhook-miss backstop: paid Checkout top-ups get credited from a Stripe poll, idempotently.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
const { db, createUser, getUserByEmail, ensureUserOrg } = await import("./db.js");
const { walletBalance, reconcileTopups, setStripeForTests } = await import("./billing.js");

let seq = 0;
function mkOrg() {
  const email = `rc${++seq}@x.com`;
  createUser({ email, name: "rc", role: "admin" });
  const org = ensureUserOrg(getUserByEmail(email).id);
  db.prepare("UPDATE organizations SET stripe_customer_id = ? WHERE id = ?").run(`cus_${org}`, org);
  return org;
}

const paidSession = (org, id, amount) => ({
  id, mode: "payment", payment_status: "paid", amount_total: amount, metadata: { org_id: String(org) },
});

test("credits a paid session the webhook missed; replay is a no-op", async () => {
  const org = mkOrg();
  setStripeForTests({ checkout: { sessions: { list: async () => ({ data: [paidSession(org, "cs_1", 5000)] }) } } });
  assert.deepEqual(await reconcileTopups(org), { credited: 5000, sessions: 1 });
  assert.equal(walletBalance(org), 5000);
  assert.deepEqual(await reconcileTopups(org), { credited: 0, sessions: 1 }, "second run credits nothing");
  assert.equal(walletBalance(org), 5000);
});

test("skips unpaid, non-payment-mode, and other-org sessions", async () => {
  const org = mkOrg();
  setStripeForTests({
    checkout: { sessions: { list: async () => ({ data: [
      { ...paidSession(org, "cs_unpaid", 5000), payment_status: "unpaid" },
      { ...paidSession(org, "cs_sub", 5000), mode: "subscription" },
      paidSession(org + 999, "cs_other", 5000),
    ] }) } },
  });
  assert.equal((await reconcileTopups(org)).credited, 0);
  assert.equal(walletBalance(org), 0);
});

test("no Stripe customer yet is a clean zero, no Stripe call", async () => {
  const email = `rc${++seq}@x.com`;
  createUser({ email, name: "rc", role: "admin" });
  const org = ensureUserOrg(getUserByEmail(email).id); // no stripe_customer_id
  setStripeForTests({ checkout: { sessions: { list: async () => { throw new Error("must not be called"); } } } });
  assert.deepEqual(await reconcileTopups(org), { credited: 0, sessions: 0 });
});
