# Subscription + usage-credit billing — spec

- **Date:** 2026-07-03
- **Status:** Confirmed model; foundation built (`server/subscriptions.js`, tested). Stripe lifecycle pending, test-mode first.

## The model (confirmed with operator)

Two separate money flows per client (org):

1. **Fixed monthly service → Stripe subscription, charged upfront.**
   Each owned resource has a plan (Pro Plus $45, DB Starter $12, …). The org's subscription
   has one item per distinct plan (quantity = number of resources on it). Stripe charges the
   saved card at the start of each period. Adding/removing a service updates the subscription.
2. **Usage → prepaid credit wallet** (existing `credit_ledger`, now usage-only).
   Metered usage draws the balance down.

### Confirmed rules
- **Currency:** UK clients bill in **GBP (£)**, rest of world in **USD ($)** — per client, from
  their country. Plans are priced in USD; GBP converts at the operator FX rate (`usdGbpRate`).
  Stripe needs a Price per plan in **both** currencies (a Price's currency is immutable).
- **Subscription dunning:** failed payment → **14 days grace**, then **suspend** the service.
- **Wallet overdraft:** the wallet may run to **−£10 / −$10** before the account is suspended
  (not a positive floor — a small allowed overdraft).
- **Top-up minimum:** **£25/$25** for the first top-up; thereafter **max(£25, last month's
  usage)**. e.g. £75/mo usage → £75 minimum, never below £25.

### Change to existing behaviour
Today `chargeMonthlyHardware` **debits the wallet** for the fixed monthly cost. Under this model
that fixed cost moves to the **subscription**, so the wallet becomes **usage-only**. The monthly
wallet-debit job is retired once subscriptions are live.

## Foundation (built — pure, charges nobody)

`server/subscriptions.js` + tests:
- `orgCurrency(orgId)` — GBP/USD (override setting → billing country → default GBP).
- `planAmountMinor(planId, currency)` — USD face value, or GBP at the FX rate, in minor units.
- `linesFromPlanIds` / `subscriptionLinesFor(orgId)` — subscription items from owned plans.
- `subscriptionTotalMinor`, `minTopUpMinor(lastMonthUsage)`, `walletShouldSuspend(balance)`,
  `subscriptionShouldSuspend(failedAt, now)` + `SUBSCRIPTION_GRACE_DAYS`, `OVERDRAFT_ALLOWANCE_MINOR`, `BASE_MIN_TOPUP_MINOR`.

## Staged build (each verified in Stripe TEST mode via the panel toggle before Live)

- **Stage 2 — Stripe catalog.** Idempotently ensure a Product + a GBP Price + a USD Price per
  plan. No charges. Store price ids (keyed by plan+currency).
- **Stage 3 — Subscription lifecycle.** `syncSubscription(orgId)`: create/update the org's
  subscription to match `subscriptionLinesFor`. Webhooks: `invoice.paid` → active;
  `invoice.payment_failed` → record failedAt + notify; a daily tick suspends past the 14-day
  grace. Wallet: enforce `minTopUpMinor` in the top-up route; suspend at the −£10 overdraft.
- **Stage 4 — UI.** Per-client subscription + credit management in the Stripe/Clients page;
  dynamic top-up minimum shown to the owner; suspend/resume controls.

## Open source-of-truth item
- **Client country** for GBP-vs-USD: currently defaults to GBP with a per-org override setting.
  Wire to Stripe `customer.address.country` (or ask at signup) so ROW clients auto-bill in USD.
