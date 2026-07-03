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
import { db, getSetting } from "./db.js";
import { planPriceUsd } from "./plans.js";
import { usdGbpRate } from "./billing.js";

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

// A plan's monthly price in the target currency's MINOR units. Plans are priced in USD;
// GBP converts at the operator FX rate (same rate the wallet already uses).
export function planAmountMinor(planId, currency) {
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

// The org's subscription lines from its owned, priced resources.
export function subscriptionLinesFor(orgId, currency = orgCurrency(orgId)) {
  const rows = db.prepare("SELECT plan_id FROM resource_ownership WHERE org_id = ?").all(orgId);
  return linesFromPlanIds(rows.map((r) => r.plan_id), currency);
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
