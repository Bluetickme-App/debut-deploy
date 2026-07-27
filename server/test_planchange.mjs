// Plan/disk change pricing + settlement. Run: node --test server/test_planchange.mjs
//
// Covers the three bugs planchange.js exists to close: a resize that never reached the
// container, a plan change that never reached Stripe, and a disk that was never billed.
process.env.DATABASE_FILE = ":memory:";
process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999";
process.env.COOLIFY_API_TOKEN = "test-token";

import { test } from "node:test";
import assert from "node:assert/strict";

const { db, createUser, ensureUserOrg } = await import("./db.js");
const { assign } = await import("./ownership.js");
const planchange = await import("./planchange.js");
const subscriptions = await import("./subscriptions.js");
const billing = await import("./billing.js");
const disks = await import("./disks.js");
const { STORAGE_PLAN, MAIL_PLANS, normalizeDiskGb, isResourcePlan, planPriceUsd } = await import("./plans.js");

let seq = 0;
function orgWithService(planId = null) {
  const u = createUser({ email: `pc${++seq}@x.com`, role: "customer" });
  const orgId = ensureUserOrg(u.id);
  const uuid = `svc-${seq}`;
  assign(uuid, "application", u.id);
  if (planId) db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE coolify_uuid = ?").run(planId, uuid);
  return { userId: u.id, orgId, uuid };
}

// --- catalog boundaries -----------------------------------------------------

test("disk-gb is priced but is NOT assignable as a resource tier", () => {
  assert.equal(planPriceUsd(STORAGE_PLAN.id), 0.125); // per GB / month
  assert.equal(isResourcePlan(STORAGE_PLAN.id), false);
  assert.equal(isResourcePlan("pro"), true);
});

test("normalizeDiskGb rejects sizes outside the offered range and non-integers", () => {
  assert.equal(normalizeDiskGb(10), 10);
  for (const bad of [0, -5, 501, 1.5, "big", null]) {
    assert.throws(() => normalizeDiskGb(bad), (e) => e.status === 400);
  }
});

// --- cycle + proration ------------------------------------------------------

test("wallet orgs prorate against the calendar month", async () => {
  const { orgId } = orgWithService("hobby");
  // 2026-07-16T00:00Z — 16 of 31 days remain (the 16th through the 31st).
  const cycle = await planchange.billingCycle(orgId, Date.UTC(2026, 6, 16));
  assert.equal(cycle.mode, "wallet");
  assert.equal(cycle.daysInPeriod, 31);
  assert.equal(cycle.daysRemaining, 16);
  assert.ok(Math.abs(cycle.remainingFraction - 16 / 31) < 1e-9);
});

test("preview prices an upgrade: monthly delta + prorated remainder + redeploy needed", async () => {
  const { orgId, uuid } = orgWithService("hobby");
  const p = await planchange.previewServicePlanChange({
    orgId, uuid, planId: "pro", nowMs: Date.UTC(2026, 6, 16),
  });
  assert.equal(p.from.id, "hobby");
  assert.equal(p.to.id, "pro");
  // GBP org: hobby $5 → 395p, pro $15 → 1185p at the default 0.79 rate.
  assert.equal(p.currency, "gbp");
  assert.equal(p.from.monthlyMinor, 395);
  assert.equal(p.to.monthlyMinor, 1185);
  assert.equal(p.deltaMinor, 790);
  assert.equal(p.prorationMinor, Math.round(790 * (16 / 31)));
  // The new tier's container limits, and the fact that applying them recreates it.
  assert.equal(p.to.cpus, "1");
  assert.equal(p.to.memory, "2G");
  assert.equal(p.effects.redeploy, true);
  assert.equal(p.effects.billingChange, true);
});

test("preview warns that a custom (unpriced) size blocks deploys", async () => {
  const { orgId, uuid } = orgWithService("pro");
  const p = await planchange.previewServicePlanChange({ orgId, uuid, planId: null, cpus: "0", memory: "0" });
  assert.equal(p.to.monthlyMinor, 0);
  assert.equal(p.deltaMinor, -1185);
  assert.ok(p.warnings.some((w) => /no free tier/i.test(w)));
});

test("preview warns when memory shrinks (OOM risk on restart)", async () => {
  const { orgId, uuid } = orgWithService("pro");
  const p = await planchange.previewServicePlanChange({ orgId, uuid, planId: "hobby" });
  assert.ok(p.warnings.some((w) => /OOM-killed/.test(w)));
});

test("unknown plan is rejected before anything is written", async () => {
  const { orgId, uuid } = orgWithService("hobby");
  await assert.rejects(
    () => planchange.previewServicePlanChange({ orgId, uuid, planId: "enterprise-mega" }),
    (e) => e.status === 400
  );
});

// --- apply ------------------------------------------------------------------

test("apply: writes the plan, settles the prorated delta on the wallet, and redeploys", async () => {
  const { orgId, uuid, userId } = orgWithService("hobby");
  const before = billing.walletBalance(orgId);
  const r = await planchange.applyServicePlanChange({
    orgId, uuid, planId: "pro", userId, nowMs: Date.UTC(2026, 6, 16),
  });

  const byStep = Object.fromEntries(r.steps.map((s) => [s.step, s]));
  assert.equal(byStep.limits.ok, true);
  assert.deepEqual(byStep.limits.detail, { cpus: "1", memory: "2G" });
  assert.equal(byStep.plan.ok, true);
  assert.equal(byStep.redeploy.ok, true, "the resize must reach the container, not just Coolify's config");

  const plan = db.prepare("SELECT plan_id FROM resource_ownership WHERE coolify_uuid = ?").get(uuid).plan_id;
  assert.equal(plan, "pro");

  // Wallet org: the upgrade is charged pro-rata now (this period was already billed
  // at the old price), so the balance drops by exactly the prorated delta.
  const proration = Math.round(790 * (16 / 31));
  assert.equal(billing.walletBalance(orgId), before - proration);
  assert.equal(r.billing.mode, "wallet");
});

test("apply: moving to an unpriced custom size records limits but refuses the redeploy", async () => {
  const { orgId, uuid, userId } = orgWithService("pro");
  // A custom size that genuinely differs from the live limits, so a redeploy IS required.
  const r = await planchange.applyServicePlanChange({
    orgId, uuid, planId: null, cpus: "2", memory: "1G", userId,
  });
  const byStep = Object.fromEntries(r.steps.map((s) => [s.step, s]));
  assert.equal(byStep.limits.ok, true);
  // Redeploying into a plan-less service would be free unmetered compute — there is no free tier.
  assert.equal(byStep.redeploy.ok, false);
  assert.equal(byStep.redeploy.detail.skipped, "plan_required");
  assert.equal(r.deployment, null);
});

test("apply: a comped org changes size but is never charged", async () => {
  const { orgId, uuid, userId } = orgWithService("hobby");
  const { setComp } = await import("./comp.js");
  setComp(orgId, { comp: true });
  const before = billing.walletBalance(orgId);
  const r = await planchange.applyServicePlanChange({ orgId, uuid, planId: "scale", userId });
  assert.equal(r.billing.skipped, "comped_org");
  assert.equal(billing.walletBalance(orgId), before);
});

// --- disks ------------------------------------------------------------------

test("disk preview prices per GB and prorates the rest of the cycle", async () => {
  const { orgId, uuid } = orgWithService("pro");
  const p = await planchange.previewDiskChange({
    orgId, uuid, sizeGb: 20, action: "add", nowMs: Date.UTC(2026, 6, 16),
  });
  // $0.125/GB/mo → 10p/GB/mo at the 0.79 rate; 20 GB = 200p/mo.
  assert.equal(p.unit.pricePerGbMinor, 10);
  assert.equal(p.deltaMinor, 200);
  assert.equal(p.prorationMinor, Math.round(200 * (16 / 31)));
  assert.equal(p.effects.redeploy, true);
  assert.equal(p.totals.orgGbAfter, 20);
});

test("a removal preview is a credit, and warns the data is destroyed", async () => {
  const { orgId, uuid } = orgWithService("pro");
  const p = await planchange.previewDiskChange({ orgId, uuid, sizeGb: 10, action: "remove" });
  assert.equal(p.deltaMinor, -100);
  assert.ok(p.warnings.some((w) => /cannot be undone/i.test(w)));
});

test("CRITICAL: an attached disk raises the monthly charge; detaching it stops the charge", async () => {
  const { orgId, uuid, userId } = orgWithService("pro");
  const base = billing.computeMonthlyCharge(orgId); // pro only
  const volumes = await import("./volumes.js");

  const added = await volumes.addVolume(uuid, { mountPath: "/data", sizeGb: 50, orgId, createdBy: userId });
  assert.equal(added.sizeGb, 50);
  assert.equal(disks.orgDiskGb(orgId), 50);
  assert.equal(billing.computeMonthlyCharge(orgId), base + 500); // 50 GB × 10p
  assert.equal(billing.diskMonthlyPence(orgId), 500);

  await volumes.deleteVolume(uuid, added.uuid);
  assert.equal(disks.orgDiskGb(orgId), 0);
  assert.equal(billing.computeMonthlyCharge(orgId), base);
});

test("a disk added with no explicit size still bills at the 1 GB floor (never free)", async () => {
  const { orgId, uuid } = orgWithService("hobby");
  const volumes = await import("./volumes.js");
  const added = await volumes.addVolume(uuid, { mountPath: "/var/lib/x", orgId });
  assert.equal(added.sizeGb, 1);
  assert.equal(disks.appDiskGb(uuid), 1);
});

test("disks appear as a per-GB subscription line so Stripe can invoice them", async () => {
  const { orgId, uuid } = orgWithService("pro");
  const volumes = await import("./volumes.js");
  await volumes.addVolume(uuid, { mountPath: "/data", sizeGb: 30, orgId });
  const lines = subscriptions.subscriptionLinesFor(orgId, "gbp");
  const disk = lines.find((l) => l.planId === STORAGE_PLAN.id);
  assert.ok(disk, "expected a disk-gb line");
  assert.equal(disk.quantity, 30);
  assert.equal(disk.unitAmountMinor, 10);
  assert.equal(subscriptions.subscriptionTotalMinor(lines), 1185 + 300);
});

// --- currency: UK bills GBP, rest of world USD ------------------------------

test("USD-native plans convert to GBP at the operator rate; ROW pays the list price", () => {
  assert.equal(subscriptions.planAmountMinor("pro", "usd"), 1500);  // $15.00
  assert.equal(subscriptions.planAmountMinor("pro", "gbp"), 1185);  // £11.85 at 0.79
  assert.equal(subscriptions.planAmountMinor(STORAGE_PLAN.id, "usd"), 13); // $0.125/GB → 13¢
  assert.equal(subscriptions.planAmountMinor(STORAGE_PLAN.id, "gbp"), 10); // 10p/GB
});

test("CRITICAL: email is dual-listed — £2.99 is quoted, never FX-derived", async () => {
  const { setSetting } = await import("./db.js");
  const mailId = MAIL_PLANS[0].id;
  assert.equal(subscriptions.planAmountMinor(mailId, "gbp"), 299); // £2.99
  assert.equal(subscriptions.planAmountMinor(mailId, "usd"), 378); // $3.78

  // Move the FX rate: USD-native prices follow it, the quoted £ email price does NOT.
  setSetting("usd_gbp_rate", "0.90");
  try {
    assert.equal(subscriptions.planAmountMinor("pro", "gbp"), 1350);      // 15 × 0.90 — moved
    assert.equal(subscriptions.planAmountMinor(mailId, "gbp"), 299);      // still exactly £2.99
    assert.equal(subscriptions.planAmountMinor(mailId, "usd"), 378);      // still exactly $3.78
  } finally {
    setSetting("usd_gbp_rate", "0.79");
  }
});

test("CRITICAL: mailboxes reach the subscription — the gap that billed subscribed orgs £0", async () => {
  const { orgId } = orgWithService("hobby");
  const { db: d } = await import("./db.js");
  const ins = d.prepare("INSERT INTO mail_mailboxes (address,domain,org_id,created_at) VALUES (?,?,?,?)");
  for (const a of ["s1@x.com", "s2@x.com"]) ins.run(a, "x.com", orgId, "2026-07-01T00:00:00Z");

  const gbp = subscriptions.subscriptionLinesFor(orgId, "gbp");
  const mailLine = gbp.find((l) => l.planId === MAIL_PLANS[0].id);
  assert.ok(mailLine, "expected a mailbox line on the subscription");
  assert.equal(mailLine.quantity, 2);
  assert.equal(mailLine.unitAmountMinor, 299);
  assert.equal(subscriptions.subscriptionTotalMinor(gbp), 395 + 598); // hobby + 2 mailboxes

  // Same org billed rest-of-world: every line switches to USD.
  const usd = subscriptions.subscriptionLinesFor(orgId, "usd");
  assert.equal(subscriptions.subscriptionTotalMinor(usd), 500 + 756); // $5 hobby + 2 × $3.78

  // And the wallet path (non-subscription orgs) still charges the quoted £2.99.
  assert.equal(billing.mailChargePence(orgId), 598);
});

test("a mailbox with no org_id is billed to nobody — the live production state", async () => {
  const { orgId } = orgWithService("hobby");
  const { db: d } = await import("./db.js");
  d.prepare("INSERT INTO mail_mailboxes (address,domain,org_id,created_at) VALUES (?,?,?,?)")
    .run("orphan@x.com", "unassigned.com", null, "2026-07-01T00:00:00Z");
  assert.equal(billing.mailChargePence(orgId), 0);
  assert.equal(subscriptions.subscriptionLinesFor(orgId, "gbp").find((l) => l.planId === MAIL_PLANS[0].id), undefined);
});

// --- the Stripe reconcile that was missing entirely -------------------------

test("CRITICAL: a plan change updates the live subscription's items", async () => {
  const { orgId, uuid } = orgWithService("hobby");
  const { setSetting } = await import("./db.js");
  setSetting("stripe_price_test_hobby_gbp", "price_hobby:395");
  setSetting("stripe_price_test_pro_gbp", "price_pro:1185");
  subscriptions.setSubState(orgId, { status: "active", subscriptionId: "sub_1" });

  let updated = null;
  billing.setStripeForTests({
    subscriptions: {
      retrieve: async () => ({
        status: "active", current_period_end: 1800000000, current_period_start: 1797408000,
        items: { data: [{ id: "si_1", price: { id: "price_hobby" }, quantity: 1 }] },
      }),
      update: async (id, body) => { updated = { id, body }; return { current_period_end: 1800000000 }; },
    },
  });

  db.prepare("UPDATE resource_ownership SET plan_id = 'pro' WHERE coolify_uuid = ?").run(uuid);
  const r = await subscriptions.syncSubscriptionItems(orgId);

  assert.equal(r.synced, true);
  assert.equal(r.changed, true);
  assert.equal(updated.id, "sub_1");
  assert.equal(updated.body.proration_behavior, "create_prorations");
  // The hobby item is removed and the pro item added — this is the step whose absence
  // meant upgrades were free and downgrades kept charging the old price.
  assert.deepEqual(
    updated.body.items.sort((a, b) => String(a.id || a.price).localeCompare(String(b.id || b.price))),
    [{ price: "price_pro", quantity: 1 }, { id: "si_1", deleted: true }]
      .sort((a, b) => String(a.id || a.price).localeCompare(String(b.id || b.price)))
  );
});

test("syncSubscriptionItems is a no-op for an org with no subscription", async () => {
  const { orgId } = orgWithService("pro");
  const r = await subscriptions.syncSubscriptionItems(orgId);
  assert.equal(r.synced, false);
  assert.equal(r.reason, "no_subscription");
});
