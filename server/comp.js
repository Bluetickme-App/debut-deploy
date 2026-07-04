// Per-org billing override: `comp` (100% free — skips the deploy gate and zeroes all
// charges) or a bounded `discountPct` (0–99; 100% free is expressed as comp, not a discount).
// State is a JSON blob in app_settings — no migration — mirroring getSubState in subscriptions.js.
import { getSetting, setSetting } from "./db.js";

const key = (orgId) => `org_comp_${orgId}`;

export function getComp(orgId) {
  try { return { comp: false, discountPct: 0, ...JSON.parse(getSetting(key(orgId)) || "{}") }; }
  catch { return { comp: false, discountPct: 0 }; }
}

// Patch comp and/or discountPct; each is optional so admins can set one without the other.
export function setComp(orgId, { comp, discountPct } = {}) {
  const next = { ...getComp(orgId) };
  if (comp !== undefined) next.comp = !!comp;
  if (discountPct !== undefined) {
    const n = Number(discountPct);
    if (!Number.isInteger(n) || n < 0 || n > 99) {
      throw Object.assign(new Error("discountPct must be an integer 0–99 (use comp for 100% free)"), { status: 400 });
    }
    next.discountPct = n;
  }
  setSetting(key(orgId), JSON.stringify(next));
  return next;
}

// The scale factor applied to computed charges: 0 when comped, else (1 − pct/100).
// Callers multiply their USD/minor amount by this before the single round.
export function compFactor(orgId) {
  const { comp, discountPct } = getComp(orgId);
  return comp ? 0 : 1 - discountPct / 100;
}
