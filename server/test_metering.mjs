// Metering rate + rollup. Run: node --test server/test_metering.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic imports so process.env.DATABASE_FILE is set before db.js opens.
const { planById, planRatePencePerHour, planStorageGb, ownedPlan, insertUsageEvent, meterResources, rollupCompute, usageSummary } = await import("./metering.js");
const { db, ensureUserOrg, createUser } = await import("./db.js");
const { assign } = await import("./ownership.js");

test("planById finds compute and db plans", () => {
  assert.equal(planById("pro")?.priceMo, 15);
  assert.equal(planById("db-pro")?.priceMo, 45);
  assert.equal(planById("nope"), undefined);
});

test("planRatePencePerHour: pro → round(usdToPence(15) / 730.5)", () => {
  // usdToPence(15) with default rate 0.79 = round(15 * 0.79 * 100) = 1185 pence/mo.
  // 1185 / 730.5 = 1.622… → round → 2 pence/hour.
  assert.equal(planRatePencePerHour("pro"), 2);
  assert.equal(planRatePencePerHour("unknown"), 0);
});

test("planStorageGb parses the plan storage string", () => {
  assert.equal(planStorageGb("pro"), 80);       // COMPUTE_PLANS pro: disk "80 GB"
  assert.equal(planStorageGb("db-pro"), 50);    // DB_PLANS db-pro: storage "50 GB"
  assert.equal(planStorageGb("unknown"), 0);
});

// Helper: assign ownership + a plan (C's plan_id lives on resource_ownership).
function own(uuid, type, userId, planId) {
  assign(uuid, type, userId); // stamps org_id (subsystem A)
  db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?")
    .run(planId, type, uuid);
}

test("ownedPlan returns org+plan only when both are present", () => {
  const u = createUser({ email: "meter1@x.com", role: "customer" });
  ensureUserOrg(u.id);
  own("app-run", "application", u.id, "pro");
  const got = ownedPlan("app-run");
  assert.equal(got.plan_id, "pro");
  assert.ok(got.org_id);

  assign("app-noplan", "application", u.id); // no plan_id set
  assert.equal(ownedPlan("app-noplan"), undefined);
  assert.equal(ownedPlan("app-orphan"), undefined); // no ownership row at all
});

test("meterResources writes one row per running+owned+planned resource, with frozen rate", () => {
  const u = createUser({ email: "meter2@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  own("svc-run", "application", u.id, "pro");
  own("svc-stopped", "application", u.id, "pro");
  own("svc-noplan", "application", u.id, null);
  const at = "2026-07-02T00:00:00.000Z";
  const inserted = meterResources(
    [
      { uuid: "svc-run", type: "application", status: "running" },
      { uuid: "svc-stopped", type: "application", status: "exited" },
      { uuid: "svc-noplan", type: "application", status: "running" }, // no plan → skip
      { uuid: "svc-orphan", type: "application", status: "running" }, // no ownership → skip
    ],
    at
  );
  assert.equal(inserted, 1);
  const rows = db.prepare("SELECT coolify_uuid, org_id, price_pence_per_hour FROM usage_events WHERE sampled_at = ?").all(at);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].coolify_uuid, "svc-run");
  assert.equal(rows[0].org_id, orgId);
  assert.equal(rows[0].price_pence_per_hour, 2); // pro, frozen
});

test("rollupCompute sums compute-hours and pence over a period", () => {
  const u = createUser({ email: "roll@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  own("roll-app", "application", u.id, "pro"); // 2 pence/hr
  // 60 ticks of 60s = 3600s = 1.0 compute-hour at 2p/hr = 2 pence.
  const base = Date.UTC(2026, 6, 5, 0, 0, 0); // 2026-07-05
  for (let i = 0; i < 60; i++) {
    insertUsageEvent({
      orgId, uuid: "roll-app", type: "application", planId: "pro",
      sampledAt: new Date(base + i * 60_000).toISOString(), intervalSec: 60,
    });
  }
  const [line] = rollupCompute(orgId, "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  assert.equal(line.coolify_uuid, "roll-app");
  assert.equal(Math.round(line.compute_hours), 1);
  assert.equal(Math.round(line.pence), 2);
});

test("mid-period plan change bills each segment at its own frozen rate", () => {
  const u = createUser({ email: "reprice@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  own("rp-app", "application", u.id, "pro");
  const base = Date.UTC(2026, 6, 10, 0, 0, 0);
  // 36 ticks on pro (rate 2), then 36 on scale (rate 12) — frozen per row.
  for (let i = 0; i < 36; i++)
    insertUsageEvent({ orgId, uuid: "rp-app", type: "application", planId: "pro",
      sampledAt: new Date(base + i * 60_000).toISOString(), intervalSec: 60 });
  for (let i = 36; i < 72; i++)
    insertUsageEvent({ orgId, uuid: "rp-app", type: "application", planId: "scale",
      sampledAt: new Date(base + i * 60_000).toISOString(), intervalSec: 60 });
  const lines = rollupCompute(orgId, "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  // Two lines: one per plan_id, each at its own frozen rate — proves no retroactive reprice.
  const byPlan = Object.fromEntries(lines.map((l) => [l.plan_id, l]));
  assert.ok(byPlan.pro && byPlan.scale);
  // 36 ticks × 60s = 0.6h each.
  // pro:   planRatePencePerHour = round(round(15*0.79*100)/730.5) = round(1185/730.5) = 2 p/hr → 0.6*2 = 1.2p
  // scale: planRatePencePerHour = round(round(85*0.79*100)/730.5) = round(6715/730.5) = 9 p/hr → 0.6*9 = 5.4p
  // SQL returns raw floats (SUM(interval_sec/3600.0 * price_pence_per_hour)); Math.round only at usageSummary boundary.
  assert.ok(Math.abs(byPlan.pro.pence - 1.2) < 0.01);   // frozen rate=2, 36×(60/3600×2)=1.2p
  assert.ok(Math.abs(byPlan.scale.pence - 5.4) < 0.01); // frozen rate=9, 36×(60/3600×9)=5.4p
  // Frozen rate implied by pence/compute_hours: pro→2p/hr, scale→9p/hr
  assert.ok(Math.abs(byPlan.pro.pence / byPlan.pro.compute_hours - 2) < 0.01);
  assert.ok(Math.abs(byPlan.scale.pence / byPlan.scale.compute_hours - 9) < 0.01);
  assert.ok(Math.round(byPlan.pro.compute_hours * 10) === 6);   // 0.6h
  assert.ok(Math.round(byPlan.scale.compute_hours * 10) === 6); // 0.6h
});

test("zero-usage org yields a £0 summary, not an error", () => {
  const u = createUser({ email: "zero@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  const s = usageSummary(orgId, "2026-07");
  assert.equal(s.totalPence, 0);
  assert.deepEqual(s.lines, []);
  assert.equal(s.currency, "GBP");
});
