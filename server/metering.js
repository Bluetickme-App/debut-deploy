// Usage metering: rate derivation (plans.js → GBP pence/hour) and rollups.
// Reuses subsystem C's usdToPence (the single USD→GBP rate source).
import { COMPUTE_PLANS, DB_PLANS } from "./plans.js";
import { usdToPence } from "./billing.js";

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
