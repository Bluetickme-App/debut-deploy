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
- No gate on lifecycle actions of already-paid resources (start/stop/restart) or on create-app
  — only on **deploy** (the point that runs the container).
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
setComp(orgId, { comp, discountPct })   // validates discountPct ∈ [0,99]; comp is boolean
```

**Comp vs 100% discount are one concept, not two.** `discountPct` is capped at **99**; "make it
free" is expressed as `comp: true` (which skips Stripe and the gate). This avoids the ambiguous
overlap where a 100% discount would still create Stripe subscription objects for a free account.

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

**Changing comp/discount AFTER a subscription exists.** The admin route calls
`syncSubscriptionDiscount(orgId)` which reconciles the live Stripe subscription (if any, from
`getSubState(orgId).subscriptionId`) to match the new comp/discount — so the UI can never say one
thing while Stripe bills another:

| Admin action                      | Stripe reconciliation                                                        |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Set `comp: true`                  | `subscriptions.update(id, { cancel_at_period_end: true })` — no refund; free from next cycle. Monthly charge already returns 0; gate bypassed immediately by comp. |
| Remove `comp` (was comped)        | No Stripe action — org now has no live subscription, so the gate returns `billing_setup_required` and the client re-runs onboarding. |
| Change `discountPct` (e.g. 10→25) | `subscriptions.update(id, { discounts: [{ coupon: couponFor(25) }] })`.       |
| Set `discountPct: 0`              | `subscriptions.update(id, { discounts: [] })` — remove the coupon.            |

No live subscription → `syncSubscriptionDiscount` is a no-op (the coupon is applied at the next
`startSubscriptionCheckout` instead).

**Routes / UI.**

- `PATCH /api/admin/orgs/:id/comp` — `requireAuth, requireAdmin` — body `{ comp?, discountPct? }`.
  Calls `setComp` then `syncSubscriptionDiscount`, and **audits** the change
  (`record(req, "billing.comp_changed", { orgId, comp, discountPct })`) since it directly moves
  revenue.
- Admin-only controls on the org row in `Clients.jsx` (and surfaced on `StripeAdmin.jsx`): a
  "Comp (free)" toggle + a discount-% input (0–99). Non-admins never see these.

---

## Part 2 — Deploy gate + onboarding

**Middleware** `requireBillingActive` (new, in `index.js` near the other guards), inserted into
the **deploy** chain only — `POST /api/services/:id/deploy` at
[index.js:405](../../../server/index.js), after `requireCapability("deploy")`. Deploy is the
authoritative choke point ("before they can deploy"); it is what actually runs the container.
Gating `POST /api/apps` (create) as well would be a no-op — a brand-new org's first resource has
no plan yet, so the "no priced resources" allow-condition below always passes it — so create is
left ungated and deploy carries the enforcement. *(ponytail: one gate, at the point that matters.)*

The gate evaluates **the specific application being deployed**, not just org-level state — this
closes a bypass: a plan-less app must not deploy for free just because the org happens to own no
priced resources yet.

**Allow the deploy if:**
- `getComp(orgId).comp === true` (comped org — always allowed), OR
- the target app has a `plan_id` **AND** the org's subscription is **live**. "Live" =
  `getSubState(orgId).status ∈ { active, trialing }`, or `past_due` **still within grace** —
  checked directly with the existing pure `subscriptionShouldSuspend(failedAt, now) === false`
  (the 14-day `SUBSCRIPTION_GRACE_DAYS` window), **not** by trusting the periodic sweep to have
  already run.

**Deny (HTTP 402):**
- `getSubState(orgId).status === 'suspended'`, or `past_due` **past** grace →
  `{ code: "account_suspended" }`. (This closes the existing dead-end: the suspension state now
  actually blocks deploys instead of only notifying.)
- target app has **no `plan_id`** → `{ code: "plan_required" }` (assign a plan first).
- priced app, no live subscription → `{ code: "billing_setup_required" }` (run onboarding).

**No "no priced resources → allow" escape.** DebutDeploy has no £0 product tier (cheapest plan is
Hobby $5/mo), so a deployable app without a plan is unpaid hosting, not a free tier. The one
legitimately-free case — the operator's own project — is expressed with **comp**, never with a
plan-less deploy.

**Rollout note (live system).** Existing already-deployed apps may carry a NULL `plan_id` from
before billing. Before enabling the gate in production, assign those apps plans **or comp their
orgs**, so the gate doesn't lock out a running customer on their next deploy after release.

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

**Currency.** The overage wallet is **GBP-only** — `createTopupSession` hardcodes
`currency: "gbp"` ([billing.js](../../../server/billing.js)) and the ledger is `amount_pence`.
Auto-recharge tops up *that* wallet, so it charges **GBP** too (the subscription may be USD; the
credit wallet is not). Hence the `...Pence` field names below are literally pence.
*(ponytail: if the wallet ever goes multi-currency, manual `createTopupSession` and auto-recharge
change together — one place.)*

**State.** `app_settings` `org_autorecharge_<id>` =
`{ enabled: true, thresholdPence: 500, amountPence: 2500, consecutiveFails: 0, inflightToken: null }`
(defaults: on, top up £25 when balance < £5). Client-editable on `Wallet.jsx` via
`PATCH /api/billing/autorecharge`.

**Trigger.** After any wallet debit that lowers the balance — `chargeMonthlyHardware` and the
metering-tick drawdown — call `maybeAutoRecharge(orgId)`:

1. **Skip** if `!enabled`, `comp`, balance `>= thresholdPence`, or there's a card on file absent.
2. **Acquire the lock synchronously** — read state, and if `inflightToken` is unset, generate a
   nonce and write it back, all **before any `await`**. Under better-sqlite3's single sync
   connection this check-and-set is atomic w.r.t. other JS, so two debits in the same tick can't
   both proceed. If the token was already set, skip (a recharge is in flight).
3. `stripe.paymentIntents.create({ amount: amountPence, currency: "gbp", customer,
   payment_method: <default PM>, off_session: true, confirm: true,
   metadata: { type: "wallet_autorecharge", org_id } }, { idempotencyKey: "autorecharge-<orgId>-<inflightToken>" })`.
   The idempotency key is the crash-safe backstop: a retry after a crash reuses the same token →
   same key → Stripe dedups the charge.
4. **Success** (PI returns `status: "succeeded"` — off-session `confirm:true` resolves
   synchronously) → `creditWallet({ type: "topup", stripePaymentIntentId: pi.id })`, idempotent
   on the existing `UNIQUE(stripe_payment_intent_id)` column. Reset `consecutiveFails`, clear
   `inflightToken`.
5. **Failure** (`card_declined`, or `authentication_required` needing 3DS) → increment
   `consecutiveFails`, clear `inflightToken`, notify the owner (advisory), and **disable**
   auto-recharge after 3 consecutive fails. Never blocks anything.

**Webhook backstop.** The existing crediting path only handles `checkout.session.completed`
([billing.js](../../../server/billing.js)) — an off-session PaymentIntent never creates a
Checkout session, so it would otherwise go uncredited if the synchronous credit is lost. Extend
`handleWebhookEvent` with a `payment_intent.succeeded` branch that credits **only** PIs carrying
`metadata.type === "wallet_autorecharge"`, keyed on the PI id (same idempotency guard as the
synchronous credit — whichever lands first wins, the other is a no-op).

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

- `comp.js`: discount math (round-once), `comp` → 0, `discountPct` bounds validation (rejects
  100 and negatives).
- `requireBillingActive`: each branch — comp allow; active/trialing allow; `past_due` within
  grace allow **and** past grace → 402 `account_suspended`; `suspended` → 402
  `account_suspended`; priced app + no live sub → 402 `billing_setup_required`; **plan-less app
  → 402 `plan_required`** (the bypass regression).
- `syncSubscriptionDiscount`: comp → `cancel_at_period_end`; discount change → coupon updated;
  discount 0 → coupon removed; no live sub → no-op (all via the Stripe stub).
- Auto-recharge: triggers below threshold, skips above / when disabled / when comp / when no
  card; the sync lock prevents a double-charge when two debits fire in one tick; success credits
  once (idempotent on PI id); 3 fails disable + notify.
- Regression: `computeMonthlyCharge` / subscription lines unchanged when `comp:false,
  discountPct:0`.

## Build order

1. **Part 1** — `comp.js` + apply in compute points + `syncSubscriptionDiscount` + admin route
   (with audit) + `Clients.jsx` controls.
2. **Part 2** — `requireBillingActive` middleware on **deploy only**; onboarding stepper + the
   402 handler in the client (which shows *why* deploy is blocked, per the `code`).
3. **Part 3** — auto-recharge state + `maybeAutoRecharge` (GBP, sync lock, idempotency key) +
   `payment_intent.succeeded` webhook branch + `Wallet.jsx` settings + failure handling.
