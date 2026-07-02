// Usage metering: rate derivation (plans.js → GBP pence/hour) and rollups.
// Reuses subsystem C's usdToPence (the single USD→GBP rate source).
import { COMPUTE_PLANS, DB_PLANS } from "./plans.js";
import { usdToPence } from "./billing.js";
import { db } from "./db.js";

const ALL_PLANS = [...COMPUTE_PLANS, ...DB_PLANS];
const HOURS_PER_MONTH = 730.5; // 365.25/12 * 24

export const planById = (planId) => ALL_PLANS.find((p) => p.id === planId);

// Per-hour rate in integer pence. usdToPence converts priceMo (USD/mo) to GBP
// pence/mo; divide by hours/mo and round. ponytail: pence-integer, sub-penny
// rounding is fine at ~0.5-8.5p/hr rates; revisit if plans get sub-£1/mo.
export function planRatePencePerHour(planId) {
  const plan = planById(planId);
  if (!plan) return 0;
  return Math.round(usdToPence(plan.priceMo) / HOURS_PER_MONTH);
}

// Allocated storage in GB from the plan's "disk"/"storage" string (e.g. "80 GB").
export function planStorageGb(planId) {
  const plan = planById(planId);
  if (!plan) return 0;
  const raw = plan.disk || plan.storage || "";
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : 0;
}

// Ownership + plan for a resource. Returns undefined (⇒ skip) if there is no
// ownership row, no org_id (orphan), or no plan_id (free tier — no meter).
export function ownedPlan(uuid) {
  const row = db
    .prepare("SELECT org_id, plan_id FROM resource_ownership WHERE coolify_uuid = ?")
    .get(uuid);
  if (!row || row.org_id == null || row.plan_id == null) return undefined;
  return row;
}

// One usage row, with the GBP rate frozen at write time.
export function insertUsageEvent({ orgId, uuid, type, planId, sampledAt, intervalSec = 60 }) {
  db.prepare(
    "INSERT INTO usage_events (org_id, coolify_uuid, type, plan_id, price_pence_per_hour, sampled_at, interval_sec) " +
      "VALUES (?,?,?,?,?,?,?)"
  ).run(orgId, uuid, type, planId, planRatePencePerHour(planId), sampledAt, intervalSec);
}

// Pure core of the metering tick. `resources` = [{ uuid, type, status }].
// Writes one event per running + owned + planned resource; returns the count.
export function meterResources(resources, sampledAt, intervalSec = 60) {
  let inserted = 0;
  for (const r of resources) {
    if (r.status !== "running") continue;          // stopped ⇒ £0 compute
    const owned = ownedPlan(r.uuid);
    if (!owned) continue;                           // orphan or no plan ⇒ skip
    insertUsageEvent({
      orgId: owned.org_id, uuid: r.uuid, type: r.type,
      planId: owned.plan_id, sampledAt, intervalSec,
    });
    inserted += 1;
  }
  return inserted;
}
