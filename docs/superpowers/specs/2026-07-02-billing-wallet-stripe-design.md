# Stripe + Prepaid Credit Wallet — Design Spec

**Date:** 2026-07-02
**Status:** Draft (design), pending your decisions on the open items below, then implementation plan
**Subsystem:** C of 3 (Org/Team RBAC · Usage Metering · Billing Engine)

> **Controller reconciliation (B↔C cross-cutting), 2026-07-02.** Confirmed: **C ships first and owns `resource_ownership.plan_id` + `user_version` 11.** B reads `plan_id` and takes migrations 12/13 (its proposed `service_plans` table is dropped). This spec is already consistent with that; the "Migration ordering" section below is now decided, not open.

## Context

DebutDeploy is a Render-style control panel proxying Coolify: React+Vite UI → Express proxy (`server/`) → Coolify REST API on Hetzner. Persistence is a single `better-sqlite3` file driven by a forward-only `MIGRATIONS` array in `server/db.js`, currently at `user_version` 10.

Subsystem A (org & team model) shipped: `organizations`, `memberships` (`user_id` PK = one-org-per-user; `role ∈ owner/manager/deployer/viewer`), and `org_invites`. `resource_ownership` gained `org_id`, which is now the **sole authorization field**; `server/ownership.js` is org-scoped. **The org is the billing entity.** Subsystem A's spec explicitly deferred "Any billing-related columns on `organizations` (added in spec C)" — that's this spec.

This subsystem gives each org a **prepaid GBP credit wallet**. Owners top the wallet up via Stripe (test mode first). A monthly job charges the org's hardware cost (sum of its resources' plan `costMo`/`priceMo` from `server/plans.js`) against the wallet, only reaching for Stripe when credit is short. Usage-based drawdown (subsystem B) is **wired last** — this design leaves one clearly marked seam where B's usage numbers debit the same ledger, and is fully buildable **now** without B.

### Decisions locked (from brainstorming + task brief)

- **Org is the billing entity.** One Stripe customer per org, not per user.
- **Owner-only billing.** Only the `owner` role manages billing; all members may *read* the balance.
- **Currency GBP; integer pence only.** No `REAL`, no JS float arithmetic on money. `priceMo`/`costMo` (floats in `plans.js`) are converted with `Math.round(x * 100)` before any DB write.
- **Stripe TEST mode first.** `sk_test_…` / `whsec_…`; live keys are a config swap, not a code change.
- **Prepaid-credit-first.** The monthly hardware charge debits the wallet directly when credit suffices; Stripe is hit only on explicit top-up, or for the *shortfall* when credit is insufficient.
- **Ledger is the balance.** `balance = SELECT COALESCE(SUM(amount_pence),0) FROM credit_ledger WHERE org_id=?`. No cached balance column — nothing to drift, nothing to reconcile. (Both research tracks converged here; the codebase track's alternative `org_wallets.balance_pence` cache is deliberately **not** taken — see Data model note.)
- **Idempotency at two layers:** Stripe idempotency keys on outbound calls, and `UNIQUE` columns (`stripe_session_id`, `stripe_payment_intent_id`) on the ledger so a webhook replay is a silent no-op via `INSERT OR IGNORE`.
- **Reuse the existing raw-body pattern.** `req.rawBody` is already captured in the `express.json` verify callback (`server/index.js:86`, used by the GitHub webhook); the Stripe webhook reads it directly for signature verification.
- **Secrets in env, never in DB.** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` live in `server/.env` only — avoiding the `SESSION_SECRET`-rotation-invalidates-all-ciphertexts risk that the `secretbox.js` shared-key derivation carries.

## Goals

1. Give each org a GBP credit wallet backed by an append-only ledger.
2. Owner-only top-up via Stripe Checkout (hosted UI, no card data in Express), credited idempotently by webhook.
3. A monthly hardware charge = sum of the org's owned resources' plan price, debited from the wallet; Stripe charged only for the shortfall.
4. Owner-only billing routes + a billing UI surface; read-only wallet view for all members.
5. Leave one marked seam for subsystem B's usage drawdown to debit the same ledger.

## Non-goals (explicit)

- **Usage metering / GB-hours / drawdown** (subsystem B). The ledger's `type` set and the monthly-charge module are the seam; B adds a `type='usage'` debit path. Marked `// ponytail:` at the seam.
- **Suspend-on-non-payment enforcement.** No existing code suspends services when a wallet hits zero and a card declines. This is a **Decision needed** (below), not built here.
- **VAT invoices / receipts.** Stripe can emit them (`invoice_creation.enabled`); deferred pending a **Decision needed**.
- **Email notifications** (SCA/3DS follow-up links, low-balance warnings, receipts). No email service exists in the codebase (Subsystem A's spec confirms this; invites are copy-paste links). A `// ponytail:` seam marks where email slots in; until then the app surfaces state in the UI.
- **Fixed-plan Stripe subscriptions / Products / Prices.** Top-ups use inline `price_data`; no pre-created Stripe Price objects.
- **Multi-currency.** GBP only; `currency='gbp'` is enforced at the application layer on every ledger insert and every Stripe call.

## Migration ordering (READ FIRST — flag)

The task notes that "the next `user_version` is 11 for whichever ships first — **both can't both be 11**." Subsystems B (usage metering) and C (this) each want migration 11. **They cannot both be 11.** This spec assumes **C ships before B**, so:

- **C takes `user_version` 11** (the migration below).
- **B takes `user_version` 12** when it lands.

If the build order flips (B first), renumber this migration to 12 and append it *after* B's in the `MIGRATIONS` array — the array is forward-only and position-indexed (`server/db.js:229`), so the array index **is** the version. **This is a decision for the orchestrator, not a guess:** confirm C-before-B before writing the migration. Nothing in C depends on B's schema, so either order is mechanically fine.

## Data model

New migration → `user_version` **11** in `server/db.js` (append one entry to `MIGRATIONS`; matches the migration-10 style — `d.exec` for DDL, then an in-transaction backfill, then validation that throws to roll back).

```sql
-- One Stripe customer per org. stripe_customer_id (cus_…) is NOT a secret
-- (Stripe's security model protects the secret key, not the customer id),
-- so it is stored plaintext — no hashToken, no encryptSecret.
ALTER TABLE organizations ADD COLUMN stripe_customer_id  TEXT;   -- cus_…, nullable until first billing action
ALTER TABLE organizations ADD COLUMN stripe_default_pm   TEXT;   -- pm_…, saved card for off-session shortfall charges (nullable)
ALTER TABLE organizations ADD COLUMN billing_status      TEXT NOT NULL DEFAULT 'ok'
                                     CHECK(billing_status IN ('ok','payment_failed'));

-- Append-only wallet ledger. Balance is always SUM(amount_pence). topup/refund
-- rows are positive; charge/usage/adjustment rows may be negative.
CREATE TABLE credit_ledger (
  id                       INTEGER PRIMARY KEY,
  org_id                   INTEGER NOT NULL REFERENCES organizations(id),
  amount_pence             INTEGER NOT NULL,               -- signed; GBP minor units
  type                     TEXT NOT NULL CHECK(type IN ('topup','hardware_charge','usage','refund','adjustment')),
  stripe_session_id        TEXT UNIQUE,                    -- checkout.session.id; idempotency guard (nullable)
  stripe_payment_intent_id TEXT UNIQUE,                    -- pi_…; idempotency guard for off-session charges (nullable)
  period                   TEXT,                           -- 'YYYY-MM' for hardware_charge/usage rows; null otherwise
  notes                    TEXT,
  created_at               TEXT NOT NULL
);

CREATE INDEX idx_credit_ledger_org ON credit_ledger(org_id, created_at);

-- Enables the hardware charge to be computed WITHOUT calling Coolify:
-- resource_ownership has no plan today. Backfill leaves existing rows NULL
-- (a NULL plan_id contributes £0 to the charge until set — see risks).
ALTER TABLE resource_ownership ADD COLUMN plan_id TEXT;      -- e.g. 'pro', 'db-pro'; maps to plans.js
```

Backfill inside the same transaction (mirrors migration 10's pattern):

```sql
-- Idempotency guard for the monthly charge: one hardware_charge per org per month.
-- Backfill nothing — existing orgs simply have no ledger rows yet (balance £0).
-- No per-org seeding needed because balance is a live SUM (empty set = £0).
```

**Validation** (in-transaction, throws to roll back — same shape as migration 10):

```sql
-- Assert the new columns exist and are queryable; cheap sanity that the ALTERs applied.
SELECT COUNT(*) FROM credit_ledger;          -- table exists, 0 rows is fine
SELECT COUNT(*) FROM organizations WHERE billing_status NOT IN ('ok','payment_failed'); -- must be 0
```

Notes:

- **No `org_wallets.balance_pence` cache column.** The codebase-integration research proposed a cached balance on `org_wallets`; this spec rejects it. A live `SUM` over an org's ledger is trivially cheap at this scale (one SQLite file, one Coolify instance) and removes an entire class of drift/reconciliation bugs. `// ponytail: balance = SUM(ledger); add a cached column only if a query profile ever shows the SUM is hot.`
- **Billing columns go on `organizations`, not a separate `org_wallets` table.** Three columns is not worth a table + its own migration; the org *is* the billing entity and these are org attributes. The ledger is separate because it's append-only row data, not a per-org attribute.
- **`plan_id` on `resource_ownership` is a blocking dependency** for the hardware charge (see Monthly charge + Risks). Existing rows are `NULL` after the `ALTER` and contribute £0 until set by the create routes / a backfill.
- **Money is integer pence everywhere.** `plans.js` `priceMo`/`costMo` are floats → convert with `Math.round(x * 100)` at read time. `// ponytail:` comment at the conversion site.
- The `stripe_default_pm` column caches the saved payment method so the monthly charge doesn't need an extra Stripe API round-trip per org at charge time.

## Currency: what gets charged (needs your confirmation)

`plans.js` prices are labelled USD (`priceMo: 15`, `costMo: 2.97`) but the wallet is GBP. This spec **treats the numeric `priceMo` as GBP pounds** and converts to pence — i.e. `pro` = £15.00 → `1500` pence charged to the wallet. `costMo` is the operator's Hetzner cost basis (shown on the existing admin `/api/billing` page, `server/index.js:554`) and is **not** what the wallet is charged; **`priceMo` is the customer charge.** This is the smallest assumption that ships. If the intent is a USD→GBP FX conversion or a separate GBP price catalog, that is a **Decision needed** — do not proceed on the FX path without it.

## `server/billing.js` (new module — keep `index.js` thin)

Per project convention ("Keep routes in `index.js` thin"), a new `server/billing.js` holds all Stripe + ledger logic. The `stripe` SDK is a new server dependency (`npm install stripe --prefix server`). Exports:

- **`getOrCreateStripeCustomer(orgId)`** — reads `organizations.stripe_customer_id`; if null, `stripe.customers.create({ email, name, metadata:{ org_id } }, { idempotencyKey: 'create-customer-'+orgId })` and writes `cus_…` back. **Lazy creation** (first top-up), not at org signup — a Stripe outage must not block org creation (Risks). Email = the org's stable primary owner: `SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=? AND m.role='owner' ORDER BY m.created_at LIMIT 1`.
- **`walletBalance(orgId)`** — `SELECT COALESCE(SUM(amount_pence),0) …`. One line.
- **`creditWallet({ orgId, amountPence, type, stripeSessionId, stripePaymentIntentId, period, notes })`** — single `INSERT OR IGNORE` into `credit_ledger`. The `UNIQUE` guard makes it idempotent under webhook replay.
- **`computeMonthlyCharge(orgId)`** — `SELECT plan_id, type FROM resource_ownership WHERE org_id=?`; map each `plan_id` to `priceMo` in `COMPUTE_PLANS`/`DB_PLANS`; return `Math.round(sum * 100)` pence. `plan_id NULL` → £0 for that resource.
- **`chargeMonthlyHardware(orgId, period)`** — idempotent per `period` (`'YYYY-MM'`). Inside one SQLite transaction (better-sqlite3 is synchronous + single-connection, so `SELECT SUM … INSERT` is race-free — see Risks):
  1. If a `hardware_charge` row already exists for `(org_id, period)` → return (already charged this month).
  2. `charge = computeMonthlyCharge(orgId)`; if 0 → insert nothing, return.
  3. `balance = walletBalance(orgId)`.
  4. If `balance >= charge` → insert one `hardware_charge` debit (`amount_pence = -charge`, `period`). Done, **no Stripe call**.
  5. Else `shortfall = charge - balance`. If `stripe_default_pm` is set → off-session `stripe.paymentIntents.create({ amount: shortfall, currency:'gbp', customer, payment_method, off_session:true, confirm:true }, { idempotencyKey: 'charge-'+orgId+'-'+period })`. On `succeeded` webhook → credit the shortfall then debit the full charge. On `requires_action` (SCA/3DS) or decline → set `organizations.billing_status='payment_failed'`, record audit, **do not debit** (wait for the webhook). If no saved card → set `payment_failed`, do not charge.

  `// ponytail: subsystem B usage drawdown lands here — an additional type='usage' debit computed from B's metering, same wallet, same transaction shape. Wire after B ships.`

## Top-up flow (Stripe Checkout)

`POST /api/billing/topup` — `requireCapability('owner')`. Body `{ amount_pence }`. Server:

1. `getOrCreateStripeCustomer(orgId)`.
2. `stripe.checkout.sessions.create({ mode:'payment', customer, line_items:[{ price_data:{ currency:'gbp', unit_amount: amount_pence, product_data:{ name:'Account credit top-up' } }, quantity:1 }], metadata:{ org_id, amount_pence }, success_url, cancel_url }, { idempotencyKey: 'topup-session-'+orgId+'-'+nonce })`. Inline `price_data` (not a pre-created Price) so any amount works. A nonce is required so an owner can top up twice in a day.
3. Return `{ url: session.url }`; the client redirects. **No card data touches Express** — Stripe hosts the card page.

`success_url`/`cancel_url` point back to the billing page (`<clientOrigin>/billing?topup=…`).

## Save-card flow (for off-session monthly shortfalls)

`POST /api/billing/save-card` — `requireCapability('owner')`. Creates a Checkout Session with `mode:'setup'`, `customer`, `setup_intent_data.metadata:{ org_id }`; returns `{ url }`. On the `checkout.session.completed` (setup mode) webhook: retrieve the SetupIntent, take `setup_intent.payment_method`, `stripe.customers.update(cus, { invoice_settings:{ default_payment_method: pm } })`, and write `pm_…` to `organizations.stripe_default_pm`. Without a saved card, monthly shortfalls cannot be auto-charged and land the org in `payment_failed`.

## Webhook endpoint (idempotent crediting)

`POST /api/stripe/webhook` — **outside** `requireAuth` and **outside** `mutateGuard` (it's an inbound Stripe call with no session/cookie), same as `/github/webhook`.

- Verify: `stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)`. `req.rawBody` is already populated globally (`server/index.js:86`). Return **400** on `SignatureVerificationError`.
- Respond **200 quickly**, process synchronously in-handler (same shape as the GitHub webhook). Log via `recordSystem()` (no `req.user`), not `record()`.
- Events:
  - `checkout.session.completed` with `session.payment_status === 'paid'` and `session.mode === 'payment'` → `creditWallet({ type:'topup', amountPence: metadata.amount_pence, stripeSessionId: session.id })`. Guard on `payment_status==='paid'` protects against async methods; `// ponytail:` note that GBP cards are synchronous, so also listen for `checkout.session.async_payment_succeeded` only if BACS is ever added.
  - `checkout.session.completed` with `session.mode === 'setup'` → save the payment method (Save-card flow above).
  - `payment_intent.succeeded` (off-session shortfall) → credit the shortfall (`stripe_payment_intent_id`) then debit the full `hardware_charge` for the period; clear `billing_status` back to `'ok'`.
- **Idempotency:** the `UNIQUE(stripe_session_id)` / `UNIQUE(stripe_payment_intent_id)` columns make duplicate deliveries a silent `INSERT OR IGNORE` no-op. This is correct behaviour, and is the one thing the money test below must assert.

## Monthly hardware charge — trigger

Two options; the reliable one is **Decision needed** (below). Default lazy path for the single-process architecture:

- A `setInterval` in `index.js` (mirrors the existing health-monitor at `server/index.js:~1411`) that wakes hourly, checks whether it is the 1st of the month, and for each org calls `chargeMonthlyHardware(orgId, currentPeriod)`. The `(org_id, period)` guard in the ledger makes it **idempotent** — a restart on the 1st, or the hourly tick firing 24×, charges each org at most once per month.

`// ponytail: single-process setInterval; charge is idempotent per (org, period) so double-fire is safe, but if the server is down for ALL of the 1st the charge is skipped until manually run. Upgrade path: an admin-only, idempotent POST /api/admin/billing/run-monthly hit by an external cron (Hetzner cron / GitHub Actions).` The admin endpoint is cheap to add and is the recommended production path for a billed SaaS.

## API surface (new)

- `GET  /api/billing/wallet` — `requireCapability('read')` — `{ balance_pence, recent_ledger[] }` for all members.
- `POST /api/billing/topup` — `requireCapability('owner')` — creates Checkout Session, returns `{ url }`.
- `POST /api/billing/save-card` — `requireCapability('owner')` — creates setup-mode Session, returns `{ url }`.
- `POST /api/billing/portal` — `requireCapability('owner')` — `stripe.billingPortal.sessions.create({ customer, return_url })`, returns `{ url }` (manage/replace card, view Stripe-side history).
- `POST /api/stripe/webhook` — **no auth, no mutateGuard** — signature-verified; credits/debits the ledger.
- *(optional, recommended)* `POST /api/admin/billing/run-monthly` — Master-Admin only, idempotent — external-cron entry point for the monthly charge.

Route chain for the authed billing routes matches the existing member-management pattern (`server/index.js:1308–1380`): `requireAuth → mutateGuard (POST) → attachOrgContext → requireCapability(level) → h(handler)`. All mutations call `record(req, action, { metadata })` into the existing `audit_events` table (no new audit table): `billing.topup_initiated`, `billing.topup_credited`, `billing.card_saved`, `billing.hardware_charged`, `billing.charge_failed`. The webhook uses `recordSystem()`.

The existing admin `GET /api/billing` (`server/index.js:554`) — Hetzner infra cost for the master admin — is **unrelated** and unchanged.

## UI

- **Billing page** (new `client/src/pages/Billing.jsx`): wallet balance (pence → £ formatted), recent ledger table (date, type, amount, notes), a **Top up** control (amount → redirect to Checkout), a **Save card for automatic charges** button, and a **Manage in Stripe** button (billing portal). A `payment_failed` banner when `organizations.billing_status='payment_failed'`.
- **Read vs mutate gating:** balance + ledger visible to all members (`read`); top-up / save-card / portal controls visible only to `owner` — same read/mutate split as the Team page in Subsystem A.
- **Nav:** "Billing" entry shown to `owner` (and optionally read-only to all members). Master Admin's client detail page (`/api/admin/orgs/:id`) can later surface an org's balance; not built here.
- **Top-up amount:** free-form pence vs fixed denominations (£10/£25/£50/£100) is a **Decision needed**; mechanically identical at the Checkout layer.

## Env / secrets

Add to `server/.env.example`:

```
STRIPE_SECRET_KEY=          # sk_test_… (test) / sk_live_… (prod)
STRIPE_WEBHOOK_SECRET=      # whsec_… — from `stripe listen --forward-to localhost:8787/api/stripe/webhook`, or Dashboard → Webhooks
```

- Both are **env-only, never in the DB, never logged.** The `secretbox.js` encrypt path is deliberately not used — its key derives from `SESSION_SECRET` with a shared baked-in salt (`'render-cred-v1'`), so rotating `SESSION_SECRET` would silently break webhook verification.
- No publishable key needed server-side (Checkout redirects to Stripe-hosted UI; no client-side Stripe.js).
- Test/live key/secret must match environments — a live key with a test webhook secret 400s every webhook and silently fails to credit wallets.

## Testing

One test file, in-memory DB, `assert`-based, matching `server/test_orgs.mjs` / `test_isolation.mjs`. `// ponytail:` — Stripe SDK calls are stubbed; these tests exercise **the ledger + idempotency + charge math**, which is where the money bugs live. Live Stripe is verified manually with the Stripe CLI in test mode.

**`server/test_billing.mjs`:**
- **Balance = SUM:** topup +£10, hardware_charge −£3 → balance £7 (700 pence). Integer pence throughout; no float.
- **Webhook idempotency (the critical money test):** crediting the same `stripe_session_id` twice inserts **one** row; balance unchanged on replay. Same for `stripe_payment_intent_id`.
- **Monthly charge idempotency:** `chargeMonthlyHardware(org, '2026-07')` twice → one `hardware_charge` row for the period.
- **Charge math:** an org owning `pro` + `db-pro` → charge = `Math.round((15+45)*100)` = 6000 pence; a `NULL plan_id` resource contributes 0.
- **Credit-sufficient path:** balance ≥ charge → debit only, no Stripe payment intent created (assert the stub was not called).
- **Shortfall path:** balance < charge with a saved card → shortfall computed correctly; without a saved card → `billing_status='payment_failed'`, no debit.
- **Owner-only gating (extend RBAC route tests):** `viewer`/`deployer`/`manager` can `GET /api/billing/wallet` but cannot `POST /api/billing/topup|save-card|portal`; `owner` can.

## Build sequence (for the implementation plan)

1. **Confirm migration ordering** (C = 11, B = 12) and the **currency assumption** (`priceMo` = GBP) with the user before writing DDL.
2. **Migration 11** — `organizations` billing columns, `credit_ledger` (+ UNIQUE idempotency columns + index), `resource_ownership.plan_id`; in-transaction validation.
3. **`server/billing.js`** — `walletBalance`, `creditWallet`, `getOrCreateStripeCustomer`, `computeMonthlyCharge`, `chargeMonthlyHardware`; pence conversion at the `plans.js` boundary. Add `stripe` to `server/package.json`.
4. **`test_billing.mjs`** (TDD) — ledger, idempotency, charge math.
5. **Webhook route** `POST /api/stripe/webhook` — signature verify via `req.rawBody`, idempotent credit, setup-mode card save.
6. **Owner-only routes** — `topup`, `save-card`, `portal`, read-only `wallet`; audit via `record()`.
7. **Monthly-charge trigger** — hourly `setInterval` guarded by `(org, period)`; optional admin cron endpoint.
8. **Client** — `Billing.jsx`, nav gating, `payment_failed` banner.
9. **Env** — `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` into `server/.env.example`; document the Stripe CLI test-mode flow.
10. **Tests green** — `test_billing.mjs` plus existing suites; manual Stripe-CLI top-up round-trip in test mode.

## Decisions needed from you

1. **Migration ordering.** Confirm C ships before B so C = `user_version` 11 and B = 12. If B is first, renumber this migration to 12. (Nothing in C depends on B.)
2. **Currency basis.** Confirm `plans.js` `priceMo` (e.g. `pro: 15`) is charged as **£15.00**, i.e. treat the number as GBP and `*100` to pence — vs a USD→GBP FX conversion or a separate GBP price catalog. This changes what `computeMonthlyCharge` returns.
3. **`plan_id` authorship.** The create routes (`POST /api/apps`, `POST /api/databases`) don't accept a `plan_id` today, and existing `resource_ownership` rows will be `NULL` (→ £0 charge). Who sets it — a plan-selection step at create time (and a plan-change/edit path), and/or a one-time backfill for existing resources? Without this, the monthly charge is £0 for existing orgs.
4. **Zero-balance / card-declined enforcement.** When credit hits zero and the Stripe shortfall charge fails, what happens? Currently the design just sets `billing_status='payment_failed'` and records it — **no suspension of services**. Do services get suspended/blocked from new creation, or is failure advisory-only for the MVP?
5. **SCA/3DS on off-session UK GBP cards.** Off-session PaymentIntents on UK cards can return `requires_action` (3DS), which cannot complete without user interaction — and there is **no email service** to send a hosted payment link. For the MVP: (a) accept prepaid-only (owner must keep credit topped up; no off-session charging), or (b) build off-session + surface the `requires_action` link only in-app on next login? Option (a) sidesteps the highest-risk item entirely and is the lazy default unless you say otherwise.
6. **Top-up UX.** Free-form pence amount, or fixed denominations (£10/£25/£50/£100)?
7. **Monthly-charge trigger.** In-process hourly `setInterval` (simple; skips if the server is down for the entire 1st) vs an admin-only idempotent endpoint hit by an external cron (reliable). Both are idempotent via the `(org, period)` guard.
8. **VAT invoices/receipts.** Needed at go-live? If yes, enable `invoice_creation` on the Checkout Session (small change, but a decision before launch).

**Confirmed from research (no decision needed):** webhook signing secret stays in **env**, not `app_settings` encrypted (avoids `SESSION_SECRET`-rotation invalidation); `stripe_customer_id` stored **plaintext** (not a secret); no `org_wallets.balance_pence` cache (balance is a live `SUM`).

---

Grounding notes: every schema element, file path, and integration point above is taken from the two research tracks and verified against `server/db.js` (migration-10 style, `user_version` 10), `server/plans.js` (`priceMo`/`costMo` floats), and the Subsystem A spec (`docs/superpowers/specs/2026-07-02-org-team-model-design.md`, which explicitly defers billing columns to spec C). Where research said a data source is unavailable — no email service, `plan_id` absent from `resource_ownership`, SCA/3DS off-session link delivery — I used the stated fallback (copy/in-app surface, add `plan_id`, prepaid-only option) and raised the rest under "Decisions needed" rather than inventing a mechanism.
