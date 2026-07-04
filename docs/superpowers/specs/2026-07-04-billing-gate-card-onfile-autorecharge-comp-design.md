# Billing gate + card-on-file + auto-recharge + comp override

**Date:** 2026-07-04
**Status:** approved (design) — pending implementation plan
**Depends on:** the existing billing spine (`billing.js`, `subscriptions.js`, `stripecatalog.js`,
`metering.js`, Stripe Checkout subscription + wallet top-up, dunning + suspension sweep).

## Problem

Provisioning is currently free of any payment requirement: nothing forces a client to put a
card on file or start paying before they deploy. The billing machinery already exists
(subscription Checkout, £25 prepaid overage wallet, monthly charge, dunning, a suspension
sweep) but three things are missing:

1. **No gate.** `POST /api/services/:id/deploy` and `POST /api/apps` have zero billing check.
   The suspension sweep computes a `suspended` state but nothing enforces it.
2. **No auto-recharge.** Wallet top-ups are manual only.
3. **No comp/discount override.** A resource can be made free only by nulling its `plan_id`
   (which loses the plan association and still doesn't bypass any gate).

## Goals

- A client adding their **first priced server** must complete a one-time onboarding —
  **start the Server+DB subscription (saves a card) and seed a £25 overage-credit wallet** —
  before their first deploy is allowed.
- **Auto-recharge:** when the overage wallet runs low, charge the saved card off-session by a
  configurable amount at a configurable threshold (default: top up £25 when below £5), per-org
  editable, toggleable.
- **Admin override:** the operator can mark any org **comp** (100% free, skips the gate and
  zeroes subscription + monthly charges) or apply a **percentage discount** that keeps plans
  assigned. Covers "free for our own project" and "discount for client X".

## Non-goals

- No new database tables/migrations. All per-org state reuses the existing `app_settings`
  JSON-blob pattern (same as `org_sub_<id>`, `org_currency_<id>`).
- No big-bang onboarding wizard component; the onboarding panel wires **existing** endpoints
  (`startSubscriptionCheckout`, `createTopupSession`).
- No gate on lifecycle actions of already-paid resources (start/stop/restart) — only on
  **deploy** and **create-app**.
- No BACS/async payment methods, no new FX feed (flat `usd_gbp_rate` unchanged).

## Architecture

Three additive parts on the existing spine, built in dependency order. Each part is
independently shippable in this order.

```
Part 1  Comp/discount override        (independent)
Part 2  Deploy gate + onboarding      (independent)
Part 3  Auto-recharge                 (depends on Part 2 — needs the saved card)
```

Money stays integer pence throughout; discount rounds once at the compute boundary (matches
the single-round rule in `usdToPence`).

---

## Part 1 — Admin comp / discount override

**State.** New module `server/comp.js`:

```
getComp(orgId)  -> { comp: false, discountPct: 0, ...parsed app_settings["org_comp_<id>"] }
setComp(orgId, { comp, discountPct })   // validates discountPct ∈ [0,100]; comp is boolean
```

Mirrors `getSubState`/`setSubState` in `subscriptions.js`.

**Applied at three existing compute points:**

- `computeMonthlyCharge(orgId)` (`billing.js`) — multiply the summed USD by
  `(1 - discountPct/100)`; if `comp` → return 0.
- `planAmountMinor(planId, currency)` / `subscriptionLinesFor` (`subscriptions.js`) — apply
  the same factor so the displayed/charged subscription lines reflect the discount; `comp` → 0
  (org never goes to Stripe).
- The deploy gate (Part 2) treats `comp === true` as always-allowed.

**Stripe subscription discount.** A partial `discountPct` on the recurring **Stripe**
subscription is applied natively with a Stripe **coupon**: `startSubscriptionCheckout` passes
`discounts: [{ coupon }]`, where the coupon is looked-up-or-created once per percentage
(`dd-off-25`, `percent_off: 25, duration: forever`). Stripe then handles recurring proration.
`comp === true` orgs never reach `startSubscriptionCheckout` (the gate/onboarding skips them).
*(ponytail: coupon-per-pct is the only new Stripe object; native mechanism, no manual proration.)*

**Routes / UI.**

- `PATCH /api/admin/orgs/:id/comp` — `requireAuth, requireAdmin` — body `{ comp?, discountPct? }`.
- Admin-only controls on the org row in `Clients.jsx` (and surfaced on `StripeAdmin.jsx`): a
  "Comp (free)" toggle + a discount-% input. Non-admins never see these.

---

## Part 2 — Deploy gate + onboarding

**Middleware** `requireBillingActive` (new, in `index.js` near the other guards), inserted into
the **deploy** chain only — `POST /api/services/:id/deploy` at
[index.js:405](../../../server/index.js), after `requireCapability("deploy")`. Deploy is the
authoritative choke point ("before they can deploy"); it is what actually runs the container.
Gating `POST /api/apps` (create) as well would be a no-op — a brand-new org's first resource has
no plan yet, so the "no priced resources" allow-condition below always passes it — so create is
left ungated and deploy carries the enforcement. *(ponytail: one gate, at the point that matters.)*

**Allow if any:**
- `getComp(orgId).comp === true`, OR
- subscription `getSubState(orgId).status ∈ { active, trialing, past_due }`, OR
- the org owns **no priced resources** (`subscriptionLinesFor(orgId)` is empty → still on the
  free tier, nothing to gate).

**Deny:**
- status `suspended` → **HTTP 402** `{ code: "account_suspended" }`.
- otherwise (priced resources, no active subscription) → **HTTP 402**
  `{ code: "billing_setup_required" }`.

This also closes the existing dead-end: the suspension sweep's `suspended` state now actually
blocks deploys instead of only notifying.

**Onboarding flow (client).** A 3-step panel shown when the client hits
`billing_setup_required` (caught from the 402) or enters the "add first server" path:

1. **Assign Server + DB plans** — existing `PATCH /api/services/:id/plan`,
   `PATCH /api/databases/:id/plan`.
2. **Start subscription** — existing `POST` → `startSubscriptionCheckout` → Stripe Checkout in
   `subscription` mode (collects + **saves** the card; `invoice.paid` webhook flips
   `getSubState` to `active`).
3. **Seed £25 credit** — existing `createTopupSession` (£25 minimum) → wallet credited on the
   `checkout.session.completed` webhook.

All three call existing endpoints; the only new client code is the stepper + the 402 handler.
Deploy unlocks once step 2's subscription is `active` (step 3 credit is part of onboarding but
the gate keys on subscription state; a low/empty wallet is advisory, consistent with the
existing prepaid-advisory stance).

---

## Part 3 — Auto-recharge (configurable, off-session)

**Precondition:** the card is already on file (default payment method) after Part 2's
subscription Checkout — no separate SetupIntent needed.

**State.** `app_settings` `org_autorecharge_<id>` =
`{ enabled: true, thresholdPence: 500, amountPence: 2500, consecutiveFails: 0 }` (defaults:
on, top up £25 when balance < £5). Client-editable on `Wallet.jsx` via
`PATCH /api/billing/autorecharge`.

**Trigger.** After any wallet debit that lowers the balance — `chargeMonthlyHardware` and the
metering-tick drawdown — call `maybeAutoRecharge(orgId)`:

- Skip if `!enabled`, `comp`, balance `>= thresholdPence`, or a recharge is already in flight.
- `stripe.paymentIntents.create({ amount: amountPence, currency: orgCurrency, customer,
  payment_method: <default PM>, off_session: true, confirm: true }, { idempotencyKey })`.
- **Success** → the resulting `payment_intent.succeeded` / charge credits the wallet through the
  **existing** top-up crediting path (idempotent on the Stripe id). Reset `consecutiveFails`.
  *(ponytail: reuse the top-up webhook to credit — one crediting path, no second ledger writer.)*
- **Failure** (`card_declined`, or `authentication_required` needing 3DS) → increment
  `consecutiveFails`, notify the owner (advisory), and **disable** auto-recharge after 3
  consecutive fails. Never blocks anything.

## Data flow

```
add 1st server → assign plans → subscription Checkout (card saved) → seed £25 credit
                                        │                                 │
                                  invoice.paid webhook            checkout.completed webhook
                                        │                                 │
                              getSubState = active              creditWallet(+£25)
                                        │
                            requireBillingActive → deploy ALLOWED

usage debits wallet → balance < threshold → maybeAutoRecharge
                                                  │
                              off_session PaymentIntent on saved card
                                        success → creditWallet (existing path)
                                        fail(×3) → notify + disable

admin: PATCH /orgs/:id/comp → getComp applied in computeMonthlyCharge / planAmountMinor / gate
```

## Error handling

- Gate: structured **402** with a `code` the client maps to the onboarding panel
  (`billing_setup_required`) or a "suspended — contact billing" message (`account_suspended`).
- Auto-recharge failures are advisory + notified, never destructive (matches the existing
  "arrears = negative balance, don't suspend mid-action" stance).
- Stripe outages must not block org creation or reads — all Stripe calls stay best-effort/lazy
  as they already are.

## Testing

`node --test` only (no new frameworks), extending the existing 189-test suite; Stripe stubbed
via the existing `setStripeForTests`.

- `comp.js`: discount math (round-once), `comp` → 0, `discountPct` bounds validation.
- `requireBillingActive`: each branch — comp allow, active-sub allow, no-priced-resources
  allow, suspended → 402 `account_suspended`, priced-no-sub → 402 `billing_setup_required`.
- Auto-recharge: triggers below threshold, skips above / when disabled / when comp; success
  credits once (idempotent); 3 fails disable + notify.
- Regression: `computeMonthlyCharge` / subscription lines unchanged when `comp:false,
  discountPct:0`.

## Build order

1. **Part 1** — `comp.js` + apply in compute points + admin route + `Clients.jsx` controls.
2. **Part 2** — `requireBillingActive` middleware on deploy + create-app; onboarding stepper +
   402 handler in the client.
3. **Part 3** — auto-recharge state + `maybeAutoRecharge` + `Wallet.jsx` settings + failure
   handling.
