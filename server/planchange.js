// Plan / resource / disk changes as a CONFIRMED, PRICED, APPLIED transaction.
//
// The bugs this module exists to close:
//   1. PATCH /resources only wrote limits_cpus/limits_memory into Coolify. Docker
//      applies cgroup limits when the container is CREATED, so the box kept running
//      the old CPU/RAM until somebody happened to redeploy — while the customer was
//      already being billed for the new tier.
//   2. Changing plan_id moved a row in SQLite and nothing else. An org on a Stripe
//      subscription kept being invoiced the line items captured at checkout, so
//      upgrades were free and downgrades kept charging the old price forever.
//   3. Adding a disk had no size, no price and no billing record at all.
//
// Everything here is preview-then-apply: preview() returns the exact numbers the
// confirmation dialog shows, apply() performs the same change in a fixed order and
// reports the outcome of every step (nothing is silently best-effort).
import * as coolify from "./coolify.js";
import * as subscriptions from "./subscriptions.js";
import { isResourcePlan, STORAGE_PLAN, computePlans, normalizeDiskGb } from "./plans.js";
import { creditWallet, walletBalance, stripeClient } from "./billing.js";
import { compFactor, getComp } from "./comp.js";
import { orgDiskGb, appDiskGb } from "./disks.js";
import { db } from "./db.js";

const DAY_MS = 86_400_000;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// --- billing cycle ----------------------------------------------------------

// The window a proration is measured against. Subscription orgs use Stripe's real
// cycle (cached on the sub state, refreshed from Stripe when we can reach it);
// wallet orgs use the calendar month, which is what chargeMonthlyHardware bills on.
export async function billingCycle(orgId, nowMs = Date.now()) {
  const st = subscriptions.getSubState(orgId);
  const onSubscription = !!st.subscriptionId || ["active", "trialing", "past_due"].includes(st.status);

  const now = new Date(nowMs);
  let start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  let source = "calendar";

  if (onSubscription) {
    if (st.currentPeriodEnd && st.currentPeriodEnd > nowMs) {
      start = st.currentPeriodStart || start;
      end = st.currentPeriodEnd;
      source = "stripe_cached";
    }
    // A cached boundary that has lapsed is worse than none — refresh it from Stripe.
    if (source === "calendar" && st.subscriptionId) {
      try {
        const stripe = stripeClient();
        const sub = stripe ? await stripe.subscriptions.retrieve(st.subscriptionId) : null;
        if (sub?.current_period_end) {
          start = (sub.current_period_start || 0) * 1000 || start;
          end = sub.current_period_end * 1000;
          source = "stripe";
          subscriptions.setSubState(orgId, { currentPeriodStart: start, currentPeriodEnd: end });
        }
      } catch { /* Stripe unreachable — the calendar month is a safe approximation */ }
    }
  }

  const span = Math.max(1, end - start);
  const msRemaining = Math.max(0, end - nowMs);
  return {
    mode: onSubscription ? "subscription" : "wallet",
    source,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    daysInPeriod: Math.max(1, Math.round(span / DAY_MS)),
    daysRemaining: Math.ceil(msRemaining / DAY_MS),
    remainingFraction: msRemaining / span,
  };
}

// --- pricing helpers --------------------------------------------------------

// A plan's monthly price for THIS org, in its currency's minor units, with any
// comp/discount already applied — i.e. what the customer is actually charged.
function monthlyMinor(orgId, planId, currency, quantity = 1) {
  if (!planId) return 0;
  return Math.round(subscriptions.planAmountMinor(planId, currency) * quantity * compFactor(orgId));
}

const ownershipRow = (uuid) =>
  db.prepare("SELECT org_id, plan_id, type FROM resource_ownership WHERE coolify_uuid = ?").get(uuid) || null;

// plan.ramGb → the Docker limits_memory string. Mirrors the client so a tier and its
// container limits can never disagree about what "512 MB" means.
export const ramToDocker = (gb) => (gb < 1 ? `${Math.round(gb * 1024)}M` : `${gb}G`);

const planSummary = (p) => (p ? {
  id: p.id, name: p.name, vcpu: p.vcpu, ram: p.ram, disk: p.disk,
  cpus: String(p.vcpuCount), memory: ramToDocker(p.ramGb),
} : null);

// --- compute plan / instance-size change ------------------------------------

// Everything the confirmation dialog needs: the spec it is moving between, the price
// before and after, the prorated settlement for the rest of this cycle, when the new
// rate starts, and the fact that applying it REDEPLOYS the service.
//
// `planId` null with explicit cpus/memory = a custom (unpriced) size.
export async function previewServicePlanChange({ orgId, uuid, planId = null, cpus, memory, nowMs = Date.now() }) {
  const own = ownershipRow(uuid);
  if (!own) throw bad("Service not found", 404);
  const org = orgId ?? own.org_id;
  if (planId && !isResourcePlan(planId)) throw bad("Unknown plan_id");

  const plans = computePlans();
  const toPlan = planId ? plans.find((p) => p.id === planId) : null;
  const fromPlan = own.plan_id ? plans.find((p) => p.id === own.plan_id) : null;

  // Live limits, so we can tell whether the container really needs recreating.
  let live = { cpus: "0", memory: "0" }, name = uuid, serverUuid = null, status = "unknown";
  try {
    const svc = await coolify.getService(uuid);
    if (svc) {
      live = { cpus: String(svc.resources?.cpus ?? "0"), memory: String(svc.resources?.memory ?? "0") };
      name = svc.name || uuid;
      serverUuid = svc.server || null;
      status = svc.status || "unknown";
    }
  } catch { /* unreachable Coolify must not block a preview — limits show as unknown */ }

  const target = toPlan
    ? { cpus: String(toPlan.vcpuCount), memory: ramToDocker(toPlan.ramGb) }
    : { cpus: String(cpus ?? live.cpus), memory: String(memory ?? live.memory) };

  const currency = subscriptions.orgCurrency(org);
  const cycle = await billingCycle(org, nowMs);
  const fromMinor = monthlyMinor(org, own.plan_id, currency);
  const toMinor = monthlyMinor(org, planId, currency);
  const deltaMinor = toMinor - fromMinor;
  const prorationMinor = Math.round(deltaMinor * cycle.remainingFraction);

  const limitsChange = target.cpus !== live.cpus || target.memory !== live.memory;
  const planChange = (planId || null) !== (own.plan_id || null);

  const warnings = [];
  if (!planId) {
    warnings.push("A custom size has no billed plan. Deploys are blocked for services without a plan — there is no free tier.");
  }
  if (deltaMinor < 0 && cycle.mode === "subscription") {
    warnings.push("Downgrades are credited against your next invoice, not refunded to your card.");
  }
  if (toPlan && fromPlan && toPlan.ramGb < fromPlan.ramGb) {
    warnings.push(`Memory drops from ${fromPlan.ram} to ${toPlan.ram}. A process using more than the new limit will be OOM-killed on restart.`);
  }
  const { comp, discountPct } = getComp(org);

  return {
    service: { uuid, name, serverUuid, status },
    from: { ...(planSummary(fromPlan) || { id: own.plan_id || null, name: "Custom" }), ...live, monthlyMinor: fromMinor },
    to: { ...(planSummary(toPlan) || { id: null, name: "Custom" }), ...target, monthlyMinor: toMinor },
    currency,
    deltaMinor,
    prorationMinor,
    cycle,
    effects: {
      // A limits change only reaches the container when Docker recreates it.
      redeploy: limitsChange,
      restartRequired: limitsChange,
      planChange,
      billingChange: deltaMinor !== 0 || planChange,
    },
    comp: { comp, discountPct },
    warnings,
  };
}

// Apply the change in the only order that is safe:
//   limits → plan record → billing → redeploy.
// Billing settles BEFORE the redeploy so a failed deploy still leaves the books
// correct for the size actually recorded; the redeploy is what makes the new cgroup
// limits real, and its outcome is reported rather than assumed.
export async function applyServicePlanChange({ orgId, uuid, planId = null, cpus, memory, userId = null, nowMs = Date.now() }) {
  const preview = await previewServicePlanChange({ orgId, uuid, planId, cpus, memory, nowMs });
  const org = orgId ?? ownershipRow(uuid)?.org_id;
  const steps = [];
  const step = (name, ok, detail = null) => { steps.push({ step: name, ok, ...(detail ? { detail } : {}) }); };

  // 1. Container limits. limits_memory_swap is pinned to the memory limit: leaving it
  //    unset lets a throttled container swap without bound, which reads as "the
  //    upgrade did nothing" on a busy host.
  const { cpus: newCpus, memory: newMem } = preview.to;
  await coolify.updateServiceResources(uuid, {
    cpus: newCpus,
    memory: newMem,
    ...(newMem !== "0" ? { memorySwap: newMem } : {}),
  });
  step("limits", true, { cpus: newCpus, memory: newMem });

  // 2. The billed plan.
  if (preview.effects.planChange) {
    db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE coolify_uuid = ?").run(planId || null, uuid);
    step("plan", true, { from: preview.from.id || null, to: planId || null });
  }

  // 3. Billing. Subscription orgs reconcile Stripe's items (Stripe prorates); wallet
  //    orgs settle the difference for the rest of this month on the ledger now.
  const billing = await settleBillingChange({
    orgId: org,
    cycle: preview.cycle,
    prorationMinor: preview.prorationMinor,
    notes: `Plan change ${preview.from.id || "custom"} → ${planId || "custom"} (${preview.service.name})`,
    userId,
  });
  step("billing", billing.ok, billing);

  // 4. Redeploy — the step that actually resizes the running container.
  //
  // Except into an unpriced size: "Custom / no limit" carries no plan, and there is no
  // free tier, so redeploying there would hand out unmetered compute. The limits are
  // still recorded; the deploy is refused with the same reason the deploy gate uses.
  let deployment = null;
  if (preview.effects.redeploy && !planId && compFactor(org) !== 0) {
    step("redeploy", false, { skipped: "plan_required" });
  } else if (preview.effects.redeploy) {
    try {
      deployment = await coolify.deployService(uuid);
      step("redeploy", true, deployment);
    } catch (e) {
      step("redeploy", false, { error: e.message });
      // Deliberate: limits + billing are already correct and consistent. Surface the
      // failure so the UI can offer a manual retry instead of rolling money back.
    }
  } else {
    step("redeploy", false, { skipped: "limits unchanged" });
  }

  return { ok: true, preview, steps, deployment, billing };
}

// --- persistent disks -------------------------------------------------------

// Priced preview for attaching/detaching a disk. Storage is a per-GB add-on billed
// monthly, so the numbers mirror a plan change: monthly rate, prorated settlement,
// and the cycle the new rate starts on.
export async function previewDiskChange({ orgId, uuid, sizeGb, action = "add", nowMs = Date.now() }) {
  const own = ownershipRow(uuid);
  if (!own) throw bad("Service not found", 404);
  const org = orgId ?? own.org_id;
  const gb = normalizeDiskGb(sizeGb);
  const signed = action === "remove" ? -gb : gb;

  let name = uuid;
  try { name = (await coolify.getService(uuid))?.name || uuid; } catch { /* name is cosmetic */ }

  const currency = subscriptions.orgCurrency(org);
  const cycle = await billingCycle(org, nowMs);
  const deltaMinor = monthlyMinor(org, STORAGE_PLAN.id, currency, signed);
  const prorationMinor = Math.round(deltaMinor * cycle.remainingFraction);
  const currentGb = orgDiskGb(org);

  return {
    action,
    service: { uuid, name },
    sizeGb: gb,
    unit: { pricePerGbMinor: monthlyMinor(org, STORAGE_PLAN.id, currency, 1), currency },
    currency,
    deltaMinor,
    prorationMinor,
    totals: {
      orgGbBefore: currentGb,
      orgGbAfter: Math.max(0, currentGb + signed),
      serviceGbBefore: appDiskGb(uuid),
    },
    cycle,
    effects: { redeploy: true, restartRequired: true, billingChange: deltaMinor !== 0 },
    warnings: action === "remove"
      ? ["Detaching a disk deletes the data on it. This cannot be undone."]
      : ["The service redeploys so Docker can mount the disk — expect a short restart.",
         "Size is the capacity you are billed for. Local Docker volumes are not hard-quota'd, so it is a commitment, not a filesystem cap."],
  };
}

// --- shared settlement ------------------------------------------------------

// Push a mid-cycle change through to money. Subscription orgs: reconcile Stripe's
// items and let Stripe compute the exact proration onto the next invoice. Wallet
// orgs: debit/credit the prorated difference on the ledger immediately, since the
// monthly sweep has already charged this period at the old price.
export async function settleBillingChange({ orgId, cycle, prorationMinor, notes, userId = null }) {
  if (!orgId) return { ok: true, mode: "unowned", skipped: "no_org" };
  if (compFactor(orgId) === 0) return { ok: true, mode: "comp", skipped: "comped_org" };

  if (cycle.mode === "subscription") {
    try {
      const r = await subscriptions.syncSubscriptionItems(orgId);
      return {
        ok: true, mode: "subscription", ...r,
        // Ours is an estimate; Stripe's invoice carries the authoritative figure.
        estimatedProrationMinor: prorationMinor,
      };
    } catch (e) {
      return { ok: false, mode: "subscription", error: e.message };
    }
  }

  if (!prorationMinor) return { ok: true, mode: "wallet", changed: false };
  creditWallet({
    orgId,
    amountPence: -prorationMinor, // positive proration = a charge = a negative ledger entry
    type: "adjustment",
    notes,
    createdBy: userId,
  });
  return { ok: true, mode: "wallet", changed: true, prorationMinor, balancePence: walletBalance(orgId) };
}
