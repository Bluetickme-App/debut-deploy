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

// Allocated-disk rate: pence per GB-hour. No storage price in plans.js, so this is
// one documented constant. ponytail: flat allocated-disk rate; make per-plan if
// tiers get distinct storage pricing. ~ £0.10/GB-mo ≈ 10p/730.5h ≈ 0.0137p/GB-hr.
const DISK_PENCE_PER_GB_HOUR = 10 / HOURS_PER_MONTH; // pence per GB-hour (GBP)

// Bandwidth allowance per plan (GB/mo). plans.js has no field yet, so map by id.
// ponytail: flat allowance table; move onto plans.js when a bandwidth column lands.
const BANDWIDTH_GB = {
  hobby: 100, starter: 100, pro: 500, proplus: 1000, scale: 2000,
  "db-hobby": 50, "db-starter": 100, "db-pro": 250, "db-scale": 500,
};

export function rollupCompute(orgId, start, end) {
  return db.prepare(`
    SELECT coolify_uuid, plan_id,
           SUM(interval_sec) / 3600.0                        AS compute_hours,
           SUM(interval_sec / 3600.0 * price_pence_per_hour) AS pence
    FROM usage_events
    WHERE org_id = ? AND sampled_at >= ? AND sampled_at < ?
    GROUP BY coolify_uuid, plan_id
    ORDER BY coolify_uuid
  `).all(orgId, start, end);
}

// [start, end) for a YYYY-MM period. end = first day of the next month.
function periodBounds(period) {
  const [y, m] = String(period).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// Live hours of a resource within [start,end), from its created_at (clamped).
function resourceHoursInPeriod(createdAt, startMs, endMs, nowMs) {
  const born = createdAt ? Date.parse(createdAt) : startMs;
  const from = Math.max(born, startMs);
  const to = Math.min(endMs, nowMs);
  return from >= to ? 0 : (to - from) / 3_600_000;
}

// The Render-style per-org summary. Zero-usage ⇒ { lines: [], totalPence: 0 }.
export function usageSummary(orgId, period, name = null) {
  const { start, end } = periodBounds(period);
  const startMs = Date.parse(start), endMs = Date.parse(end), nowMs = Date.now();
  const lines = [];

  // Compute lines from metered uptime.
  for (const c of rollupCompute(orgId, start, end)) {
    lines.push({
      type: "compute",
      uuid: c.coolify_uuid,
      plan: c.plan_id,
      computeHours: +c.compute_hours.toFixed(2),
      pence: Math.round(c.pence),
    });
  }

  // Allocated-disk + bandwidth lines from currently-owned+planned resources.
  const owned = db.prepare(
    "SELECT coolify_uuid, type, plan_id, created_at FROM resource_ownership " +
      "WHERE org_id = ? AND plan_id IS NOT NULL"
  ).all(orgId);
  for (const r of owned) {
    const hours = resourceHoursInPeriod(r.created_at, startMs, endMs, nowMs);
    const gb = planStorageGb(r.plan_id);
    const diskPence = Math.round(gb * hours * DISK_PENCE_PER_GB_HOUR);
    if (gb > 0) {
      lines.push({ type: "disk", uuid: r.coolify_uuid, plan: r.plan_id, allocatedGb: gb, hours: +hours.toFixed(2), pence: diskPence });
    }
    lines.push({
      type: "bandwidth", uuid: r.coolify_uuid, plan: r.plan_id,
      allowanceGb: BANDWIDTH_GB[r.plan_id] ?? 0, usedGb: 0, pence: 0, // ponytail: bandwidth metering not implemented — flat allowance per plan.
    });
  }

  const totalPence = lines.reduce((sum, l) => sum + l.pence, 0);
  return { period, currency: "GBP", name, lines, totalPence };
}

// Pure core of the metering tick. `resources` = [{ uuid, type, status }].
// Writes one event per running + owned + planned resource; returns the count.
export function meterResources(resources, sampledAt, intervalSec = 60) {
  let inserted = 0;
  for (const r of resources) {
    // Defensive: Coolify status is compound ("running:healthy"); normalise at our
    // own boundary so a raw-status caller can't silently under-bill running resources.
    if ((r.status || "").split(":")[0] !== "running") continue;  // stopped ⇒ £0 compute
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
