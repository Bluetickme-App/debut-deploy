// Subscription + usage-credit billing model — CONFIRMED 2026-07-03.
// This module is the PURE calculation + config layer only: it decides amounts,
// currencies, top-up minimums and suspension timing. It does NOT call Stripe and
// charges nobody — the Stripe lifecycle (create/sync subscriptions, webhooks,
// suspension) is built on top of these functions in a later, test-mode-first stage.
//
// Model:
//   • Fixed monthly service  -> a Stripe subscription, charged upfront, in the org's
//     currency (UK -> GBP, rest of world -> USD). Failed payment: 14 days grace, then suspend.
//   • Usage                  -> prepaid credit wallet (credit_ledger). The wallet may run
//     down to -£10 / -$10 (a small overdraft) before the account is suspended.
//   • Top-up minimum         -> £25/$25 for the first top-up; thereafter max(£25, last
//     month's usage). e.g. £75/mo usage -> £75 minimum, never below £25.
import { db, getSetting, setSetting } from "./db.js";
import { planPriceUsd, planPricePence, STORAGE_PLAN, MAIL_PLANS } from "./plans.js";
import { usdGbpRate, stripeClient, stripeMode, getOrCreateStripeCustomer, walletBalance } from "./billing.js";
import { priceIdFor } from "./stripecatalog.js";
import { getComp } from "./comp.js";
import { orgDiskGb } from "./disks.js";
import { orgMailboxCount } from "./db.js";

export const BASE_MIN_TOPUP_MINOR = 2500;       // £25 / $25 (minor units)
export const OVERDRAFT_ALLOWANCE_MINOR = 1000;  // wallet may reach -£10 / -$10 before suspend
export const SUBSCRIPTION_GRACE_DAYS = 14;      // grace after a failed subscription payment
const DAY_MS = 24 * 60 * 60 * 1000;

// UK bills in GBP, everyone else in USD. Source of truth, in order:
//   1. an explicit per-org override setting (org_currency_<id> = 'gbp'|'usd')
//   2. the org's billing country (GB/UK -> gbp)  [plug point — needs a country field]
//   3. default 'gbp'
// ponytail: the country lookup is a no-op until organizations carries a billing country;
// set the override per org, or wire it to Stripe customer.address.country at signup.
export function orgCurrency(orgId) {
  const override = getSetting(`org_currency_${orgId}`);
  if (override === "gbp" || override === "usd") return override;
  const country = (db.prepare("SELECT billing_country FROM organizations WHERE id = ?").get?.(orgId) || {}).billing_country;
  if (country) return /^(gb|uk)$/i.test(country) ? "gbp" : "usd";
  return "gbp";
}

// Operator override of a client's billing currency (UK £ vs ROW $).
export function setOrgCurrency(orgId, currency) {
  if (currency !== "gbp" && currency !== "usd") {
    throw Object.assign(new Error("currency must be 'gbp' or 'usd'"), { status: 400 });
  }
  setSetting(`org_currency_${orgId}`, currency);
  return currency;
}

// A plan's monthly price in the target currency's MINOR units — the amount a UK org is
// charged in pence, or a rest-of-world org in cents (orgCurrency picks which).
//
// Most plans are USD-native and their GBP figure converts at the operator FX rate.
// A dual-listed plan (email) carries an explicit price per currency, so its £ figure is
// returned as quoted and never moves when the rate does.
export function planAmountMinor(planId, currency) {
  if (currency === "gbp") {
    const pence = planPricePence(planId);
    if (pence != null) return pence;
  }
  const usd = planPriceUsd(planId);
  const value = currency === "gbp" ? usd * usdGbpRate() : usd;
  return Math.round(value * 100);
}

// Pure: given the plan_ids an org owns, the subscription line items (one per distinct
// plan, quantity = how many resources on it, amount = per-unit minor). Unpriced (null)
// plans are skipped — they contribute nothing to the subscription.
export function linesFromPlanIds(planIds, currency) {
  const counts = new Map();
  for (const id of planIds) {
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([planId, quantity]) => ({ planId, quantity, unitAmountMinor: planAmountMinor(planId, currency) }))
    .filter((l) => l.unitAmountMinor > 0)
    .sort((a, b) => a.planId.localeCompare(b.planId));
}

// The org's subscription lines from its owned, priced resources, PLUS one per-GB
// persistent-disk line (quantity = total attached GB). Disks are an add-on product,
// not a resource tier, so they never appear in resource_ownership.plan_id.
export function subscriptionLinesFor(orgId, currency = orgCurrency(orgId)) {
  const rows = db.prepare("SELECT plan_id FROM resource_ownership WHERE org_id = ?").all(orgId);
  const lines = linesFromPlanIds(rows.map((r) => r.plan_id), currency);
  const gb = orgDiskGb(orgId);
  if (gb > 0) {
    const unitAmountMinor = planAmountMinor(STORAGE_PLAN.id, currency);
    if (unitAmountMinor > 0) lines.push({ planId: STORAGE_PLAN.id, quantity: gb, unitAmountMinor });
  }
  // Mailboxes, same shape (quantity = seats). Without this line an org on a Stripe
  // subscription is invoiced £0 for email however many mailboxes it has: the monthly
  // wallet charge that DOES count them is skipped for subscription orgs.
  const mailPlan = MAIL_PLANS[0];
  const seats = mailPlan ? orgMailboxCount(orgId) : 0;
  if (seats > 0) {
    const unitAmountMinor = planAmountMinor(mailPlan.id, currency);
    if (unitAmountMinor > 0) lines.push({ planId: mailPlan.id, quantity: seats, unitAmountMinor });
  }
  return lines;
}

export const subscriptionTotalMinor = (lines) =>
  lines.reduce((sum, l) => sum + l.unitAmountMinor * l.quantity, 0);

// Minimum top-up in minor units: the base floor, or last month's usage if higher.
export function minTopUpMinor(lastMonthUsageMinor = 0) {
  return Math.max(BASE_MIN_TOPUP_MINOR, Math.round(lastMonthUsageMinor) || 0);
}

// Wallet suspends once the balance falls past the allowed overdraft (i.e. <= -allowance).
export const walletShouldSuspend = (balanceMinor) => balanceMinor <= -OVERDRAFT_ALLOWANCE_MINOR;

// Subscription grace: suspend once `now` is past 14 days after the first failed payment.
export function graceDeadlineMs(failedAtMs) { return failedAtMs + SUBSCRIPTION_GRACE_DAYS * DAY_MS; }
export function subscriptionShouldSuspend(failedAtMs, nowMs) {
  return failedAtMs != null && nowMs > graceDeadlineMs(failedAtMs);
}

// Pure deploy-gate decision for one application. Evaluates the SPECIFIC app's plan + the org's
// subscription — not just "does the org own priced resources" — so a plan-less app can't deploy
// for free (there is no £0 tier; the only free case is comp). Returns { allow } or
// { allow:false, status:402, code }. `code`: account_suspended | plan_required | billing_setup_required.
export function deployGateDecision({ comp, subStatus, failedAt = null, planId, nowMs }) {
  if (comp) return { allow: true };
  if (subStatus === "suspended") return { allow: false, status: 402, code: "account_suspended" };
  if (subStatus === "past_due" && subscriptionShouldSuspend(failedAt, nowMs)) {
    return { allow: false, status: 402, code: "account_suspended" };
  }
  if (!planId) return { allow: false, status: 402, code: "plan_required" };
  const live = subStatus === "active" || subStatus === "trialing" || subStatus === "past_due";
  if (!live) return { allow: false, status: 402, code: "billing_setup_required" };
  return { allow: true };
}

// --- Stage 3: subscription lifecycle (state in app_settings, Stripe checkout, ----
// webhooks, suspension sweep). Per-org billing state is a JSON blob in app_settings
// so this needs no schema migration:
//   { status:'active'|'past_due'|'suspended'|'canceled'|null, failedAt:ms|null,
//     suspendedAt:ms|null, reason:string|null, subscriptionId:string|null }
const subKey = (orgId) => `org_sub_${orgId}`;
const SUB_DEFAULTS = {
  status: null, failedAt: null, suspendedAt: null, reason: null, subscriptionId: null,
  // Cycle boundary (ms) cached from Stripe so previews can name the next billing date.
  currentPeriodStart: null, currentPeriodEnd: null,
};
export function getSubState(orgId) {
  try { return { ...SUB_DEFAULTS, ...JSON.parse(getSetting(subKey(orgId)) || "{}") }; }
  catch { return { ...SUB_DEFAULTS }; }
}
export function setSubState(orgId, patch) {
  const next = { ...getSubState(orgId), ...patch };
  setSetting(subKey(orgId), JSON.stringify(next));
  return next;
}

// Start a subscription for an org: a Stripe Checkout session in `subscription` mode
// (collects the card AND creates the subscription) from the org's plan price ids in
// its currency. The org must have priced services and a synced catalog.
export async function startSubscriptionCheckout(orgId, { successUrl, cancelUrl } = {}) {
  const stripe = stripeClient();
  if (!stripe) throw Object.assign(new Error("Stripe is not configured for this mode"), { status: 400 });
  const currency = orgCurrency(orgId);
  const mode = stripeMode();
  const lines = subscriptionLinesFor(orgId, currency);
  if (!lines.length) throw Object.assign(new Error("This client has no priced services to subscribe"), { status: 400 });
  const line_items = lines.map((l) => {
    const price = priceIdFor(mode, l.planId, currency);
    if (!price) throw Object.assign(new Error(`No ${currency.toUpperCase()} price for ${l.planId} — sync the plan catalog first`), { status: 400 });
    return { price, quantity: l.quantity };
  });
  const customer = await getOrCreateStripeCustomer(orgId);
  const { discountPct } = getComp(orgId);
  const discounts = discountPct > 0 ? [{ coupon: await couponFor(stripe, discountPct) }] : undefined;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items,
    discounts, // Stripe applies the percent-off coupon to the recurring invoice; comp orgs never get here
    metadata: { org_id: String(orgId), kind: "service_subscription" },
    subscription_data: { metadata: { org_id: String(orgId) } },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { url: session.url };
}

// A `percent_off … forever` coupon per discount level, looked-up-or-created (idempotent id).
// The only new Stripe object the discount feature introduces.
async function couponFor(stripe, pct) {
  const id = `dd-off-${pct}`;
  try { await stripe.coupons.retrieve(id); }
  catch { await stripe.coupons.create({ id, percent_off: pct, duration: "forever" }); }
  return id;
}

// How mid-cycle changes are settled. 'create_prorations' puts the credit/charge on the
// NEXT invoice (no surprise card charge the moment someone clicks Save) — which is what
// the confirmation dialog promises the customer. Switch to 'always_invoice' to bill the
// difference immediately; the dialog copy in ResourceChangeModal must change with it.
export const PRORATION_BEHAVIOR = "create_prorations";

// Reconcile the LIVE Stripe subscription's ITEMS to what the org actually owns.
// This is what makes a plan change cost money: without it, Stripe keeps invoicing the
// line items captured at the original checkout no matter what the customer resizes to.
//
// Returns { synced, changed, reason?, lines, subscriptionId }. Never throws for
// "there is no subscription" — a wallet-billed org settles plan changes on the ledger
// instead (see planchange.js).
export async function syncSubscriptionItems(orgId) {
  const stripe = stripeClient();
  if (!stripe) return { synced: false, changed: false, reason: "stripe_unconfigured" };
  const { subscriptionId } = getSubState(orgId);
  if (!subscriptionId) return { synced: false, changed: false, reason: "no_subscription" };

  const currency = orgCurrency(orgId);
  const mode = stripeMode();
  const want = subscriptionLinesFor(orgId, currency);

  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items"] });
  if (["canceled", "incomplete_expired"].includes(sub.status)) {
    return { synced: false, changed: false, reason: `subscription_${sub.status}` };
  }
  const have = sub.items?.data || [];

  // A subscription cannot have zero items. When the org drops to nothing priced we end
  // it at the period end (already paid for) rather than deleting the last item.
  if (!want.length) {
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    return { synced: true, changed: true, action: "cancel_at_period_end", lines: [], subscriptionId };
  }

  const updates = [];
  const keep = new Set();
  for (const l of want) {
    const price = priceIdFor(mode, l.planId, currency);
    if (!price) {
      throw Object.assign(
        new Error(`No ${currency.toUpperCase()} price for ${l.planId} — sync the plan catalog first`),
        { status: 400 }
      );
    }
    const existing = have.find((i) => i.price?.id === price);
    if (existing) {
      keep.add(existing.id);
      if (existing.quantity !== l.quantity) updates.push({ id: existing.id, quantity: l.quantity });
    } else {
      updates.push({ price, quantity: l.quantity });
    }
  }
  for (const i of have) if (!keep.has(i.id)) updates.push({ id: i.id, deleted: true });

  if (!updates.length) {
    rememberPeriodEnd(orgId, sub);
    return { synced: true, changed: false, lines: want, subscriptionId };
  }

  const next = await stripe.subscriptions.update(subscriptionId, {
    items: updates,
    proration_behavior: PRORATION_BEHAVIOR,
  });
  rememberPeriodEnd(orgId, next);
  return { synced: true, changed: true, lines: want, subscriptionId };
}

// Cache the cycle boundary so the confirmation dialog can name the next billing date
// without a Stripe round-trip on every preview.
function rememberPeriodEnd(orgId, sub) {
  const end = sub?.current_period_end;
  const start = sub?.current_period_start;
  if (end) setSubState(orgId, { currentPeriodEnd: end * 1000, currentPeriodStart: start ? start * 1000 : null });
}

// Reconcile a LIVE Stripe subscription to the org's current comp/discount, so the admin UI can
// never say one thing while Stripe bills another. No live subscription → no-op (the coupon is
// applied at the next startSubscriptionCheckout instead). Called from the admin comp route.
export async function syncSubscriptionDiscount(orgId) {
  const stripe = stripeClient();
  if (!stripe) return { synced: false, reason: "stripe_unconfigured" };
  const { subscriptionId } = getSubState(orgId);
  if (!subscriptionId) return { synced: false, reason: "no_subscription" };
  const { comp, discountPct } = getComp(orgId);
  if (comp) {
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    return { synced: true, action: "cancel_at_period_end" };
  }
  if (discountPct > 0) {
    await stripe.subscriptions.update(subscriptionId, { discounts: [{ coupon: await couponFor(stripe, discountPct) }] });
    return { synced: true, action: "discount", discountPct };
  }
  await stripe.subscriptions.update(subscriptionId, { discounts: [] });
  return { synced: true, action: "no_discount" };
}

// Resolve org id from an invoice: subscription metadata first, then the customer.
function orgFromInvoice(inv) {
  const meta = Number(inv?.subscription_details?.metadata?.org_id || inv?.metadata?.org_id);
  if (Number.isInteger(meta) && meta > 0) return meta;
  const cust = inv?.customer;
  if (cust) {
    const row = db.prepare("SELECT id FROM organizations WHERE stripe_customer_id = ?").get(cust);
    if (row) return row.id;
  }
  return null;
}

// Apply a Stripe subscription/invoice webhook to our per-org state. Idempotent.
export function applySubscriptionEvent(event) {
  const obj = event?.data?.object || {};
  switch (event?.type) {
    case "invoice.paid": {
      const orgId = orgFromInvoice(obj);
      if (orgId) {
        // Refresh the cached cycle boundary from the invoice's own line period so the
        // "next charge on …" copy stays right without polling Stripe.
        const line = obj.lines?.data?.[0]?.period;
        setSubState(orgId, {
          status: "active", failedAt: null, reason: null, suspendedAt: null,
          subscriptionId: obj.subscription || getSubState(orgId).subscriptionId,
          ...(line?.end ? { currentPeriodStart: (line.start || 0) * 1000, currentPeriodEnd: line.end * 1000 } : {}),
        });
      }
      return { handled: true, orgId };
    }
    case "invoice.payment_failed": {
      const orgId = orgFromInvoice(obj);
      if (orgId) {
        const st = getSubState(orgId);
        if (!st.failedAt) setSubState(orgId, { status: "past_due", failedAt: (event.created || 0) * 1000, subscriptionId: obj.subscription || st.subscriptionId });
      }
      return { handled: true, orgId };
    }
    case "customer.subscription.deleted": {
      const orgId = Number(obj.metadata?.org_id) || orgFromInvoice({ customer: obj.customer });
      if (orgId) setSubState(orgId, { status: "canceled" });
      return { handled: true, orgId };
    }
    default:
      return { handled: false };
  }
}

// Suspend orgs past the 14-day subscription grace OR past the -£10/-$10 wallet
// overdraft; un-suspend those whose conditions have cleared. Returns the changes.
// Marks state + returns list — the caller notifies/enforces (no destructive action here).
export function runSuspensionSweep(nowMs) {
  const changed = [];
  for (const { id } of db.prepare("SELECT id FROM organizations").all()) {
    const st = getSubState(id);
    const subDue = subscriptionShouldSuspend(st.failedAt, nowMs);
    const walletDue = walletShouldSuspend(walletBalance(id));
    if ((subDue || walletDue) && st.status !== "suspended") {
      const reason = subDue ? "subscription_unpaid" : "credit_overdrawn";
      setSubState(id, { status: "suspended", suspendedAt: nowMs, reason });
      changed.push({ orgId: id, action: "suspended", reason });
    } else if (st.status === "suspended" && !subDue && !walletDue) {
      setSubState(id, { status: "active", suspendedAt: null, reason: null });
      changed.push({ orgId: id, action: "restored" });
    }
  }
  return changed;
}
