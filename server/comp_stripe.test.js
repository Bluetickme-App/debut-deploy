// Run: node --test server/comp_stripe.test.js
// Reconciling an existing Stripe subscription to the org's comp/discount override.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
await import("./db.js");
const { setStripeForTests } = await import("./billing.js");
const { setComp } = await import("./comp.js");
const { setSubState, syncSubscriptionDiscount } = await import("./subscriptions.js");

// A Stripe stub that records the calls the reconciler makes.
function fakeStripe(existingCoupons = []) {
  const calls = { couponCreate: [], subUpdate: [] };
  return {
    calls,
    coupons: {
      retrieve: async (id) => {
        if (existingCoupons.includes(id)) return { id };
        throw Object.assign(new Error("No such coupon"), { statusCode: 404 });
      },
      create: async (params) => { calls.couponCreate.push(params); existingCoupons.push(params.id); return { id: params.id }; },
    },
    subscriptions: {
      update: async (id, params) => { calls.subUpdate.push({ id, params }); return { id, ...params }; },
    },
  };
}

test("no live subscription → reconciler is a no-op", async () => {
  const stub = fakeStripe(); setStripeForTests(stub);
  const r = await syncSubscriptionDiscount(101); // never subscribed
  assert.equal(r.synced, false);
  assert.equal(stub.calls.subUpdate.length, 0);
});

test("comp cancels the subscription at period end (no refund)", async () => {
  const stub = fakeStripe(); setStripeForTests(stub);
  setSubState(102, { status: "active", subscriptionId: "sub_102" });
  setComp(102, { comp: true });
  await syncSubscriptionDiscount(102);
  assert.deepEqual(stub.calls.subUpdate, [{ id: "sub_102", params: { cancel_at_period_end: true } }]);
});

test("a discount attaches a percent-off coupon, creating it once if absent", async () => {
  const stub = fakeStripe(); setStripeForTests(stub);
  setSubState(103, { status: "active", subscriptionId: "sub_103" });
  setComp(103, { discountPct: 25 });
  await syncSubscriptionDiscount(103);
  assert.deepEqual(stub.calls.couponCreate, [{ id: "dd-off-25", percent_off: 25, duration: "forever" }]);
  assert.deepEqual(stub.calls.subUpdate, [{ id: "sub_103", params: { discounts: [{ coupon: "dd-off-25" }] } }]);
});

test("clearing the discount removes the coupon from the subscription", async () => {
  const stub = fakeStripe(); setStripeForTests(stub);
  setSubState(104, { status: "active", subscriptionId: "sub_104" });
  setComp(104, { discountPct: 0 });
  await syncSubscriptionDiscount(104);
  assert.deepEqual(stub.calls.subUpdate, [{ id: "sub_104", params: { discounts: [] } }]);
});
