# Stripe + Prepaid Credit Wallet Implementation Plan (Subsystem C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each org a **prepaid GBP credit wallet** backed by an append-only ledger. Owners top the wallet up via Stripe Checkout (test mode; card data never touches Express), credited idempotently by a signature-verified webhook. A monthly job debits each org's hardware cost (sum of its resources' plan price, USD→GBP at a configurable rate) from the wallet; a negative balance is tracked **arrears** with an advisory banner — nothing is suspended, no card is ever charged off-session.

**Architecture:** C is the **foundation** subsystem, built before B. A new migration (`user_version` 11) adds three billing columns to `organizations`, an append-only `credit_ledger` table (with `UNIQUE` idempotency columns), and `resource_ownership.plan_id`. All Stripe + ledger logic lives in a new `server/billing.js` (project convention: keep `index.js` thin). Balance is a live `SUM(amount_pence)` — no cached column, nothing to drift. Money is **integer pence** everywhere; `plans.js` floats are converted with `Math.round(usd * rate * 100)` at the `billing.js` boundary, where `rate` comes from `app_settings 'usd_gbp_rate'` (default `0.79`), via an exported `usdToPence()` helper that **B reuses**. Plan assignment lands on create (`plan_id` on `POST /api/apps` / `POST /api/databases`) and via `PATCH /api/services/:id/plan` + `PATCH /api/databases/:id/plan` (manage-gated). The monthly charge runs from an in-process hourly `setInterval` guarded by `(org, period)` idempotency, plus an admin cron endpoint. New billing routes + a `Billing.jsx` page + nav complete it.

**Tech Stack:** Node ESM, Express, better-sqlite3, Stripe SDK (`stripe`, new server dep, **stubbed in tests**), React + Vite + Tailwind v4. Tests use `node:test` + `node:assert/strict` against an in-memory / temp-file SQLite DB.

## Global Constraints

- **ESM everywhere** (`"type": "module"`); use `import`, not `require`.
- **Money is integer pence.** No `REAL`, no JS float arithmetic on money in the DB. The only float→int conversion is `Math.round(usd * rate * 100)` at the `plans.js`/`billing.js` boundary, marked `// ponytail:`.
- **Balance is the ledger.** `balance = SELECT COALESCE(SUM(amount_pence),0) FROM credit_ledger WHERE org_id = ?`. No cached balance column.
- **Idempotency at two layers:** Stripe idempotency keys on outbound calls, and `UNIQUE(stripe_session_id)` / `UNIQUE(stripe_payment_intent_id)` on the ledger so a webhook replay is a silent `INSERT OR IGNORE` no-op. The monthly charge is idempotent per `(org_id, period)`.
- **PREPAID-ONLY (spec §"Decisions resolved" #4, authoritative).** NO save-card, NO off-session `PaymentIntent`, NO `stripe_default_pm` column, NO 3DS/`requires_action` handling. **No Stripe charge is ever made without the owner present at Checkout.** The monthly charge simply debits the wallet; a negative balance is arrears. `billing_status IN ('ok','arrears')`; advisory banner, **no suspension**.
- **Currency = USD→GBP** via `app_settings` key `usd_gbp_rate` (default `0.79`, operator-editable). `plans.js` numbers stay USD. Same rate source as subsystem B.
- **Free until assigned.** `resource_ownership.plan_id` is nullable; `computeMonthlyCharge` sums only resources with a plan (`NULL` → £0).
- **Owner-only billing mutations; all members read.** Route chain matches Subsystem A's member routes: `requireAuth → mutateGuard (POST) → attachOrgContext → requireCapability(level) → h(handler)`.
- **Secrets in env, never in DB, never logged.** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` live in `server/.env` only. The `secretbox.js` encrypt path is deliberately not used (its key derives from `SESSION_SECRET`).
- **Reuse the existing raw-body pattern.** `req.rawBody` is already captured globally in the `express.json` verify callback (`server/index.js:86`); the Stripe webhook reads it directly for signature verification. The webhook is **outside** `requireAuth` and `mutateGuard`, like `/github/webhook`.
- Mark deliberate shortcuts with a `// ponytail:` comment (established convention; a `/ponytail-debt` tool harvests them — do not rename to `TODO`).
- Audit billing mutations via `record(req, action, …)`; the webhook uses `recordSystem()` (no `req.user`).
- Migrations run in a transaction and bump `user_version`; a new migration is a function appended to the `MIGRATIONS` array in `server/db.js` (position index = version).
- Run a single test file with: `node --test server/test_<name>.mjs`.
- **Stripe is stubbed in tests.** The money tests exercise the ledger + idempotency + charge math — where the money bugs live. Live Stripe is verified manually with the Stripe CLI in test mode.

---

### Task 1: Migration 11 — billing columns, credit_ledger, plan_id, validation

**Files:**
- Modify: `server/db.js` (append migration to `MIGRATIONS`)
- Test: `server/test_billing_migration.mjs` (new)

**Interfaces:**
- Consumes: existing `MIGRATIONS` array + `migrate()` machinery in `server/db.js` (currently ends at `user_version` 10 — see `server/db.js:152-207`).
- Produces: columns `organizations.stripe_customer_id`, `organizations.billing_status`; table `credit_ledger` with `UNIQUE(stripe_session_id)`, `UNIQUE(stripe_payment_intent_id)`, index `idx_credit_ledger_org`; column `resource_ownership.plan_id`.

- [ ] **Step 1: Write the failing migration test**

Create `server/test_billing_migration.mjs`. It builds a **v10-shaped** DB in a temp file (only the tables migration 11 touches), then imports `db.js` to trigger the 10→11 migration and asserts the new schema.

```javascript
// Migration 11: billing columns, credit_ledger, plan_id. Run: node --test server/test_billing_migration.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v10 DB with just the tables migration 11 reads/alters.
const file = path.join(os.tmpdir(), `dd-bill-mig-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE resource_ownership (
      coolify_uuid TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('application','database','service')),
      user_id INTEGER NOT NULL, org_id INTEGER, created_at TEXT NOT NULL,
      PRIMARY KEY (type, coolify_uuid)
    );
  `);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (?,?,?,?)").run(1, "Acme", "acme", now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,created_at) VALUES (?,?,?,?,?)")
    .run("app-1", "application", 1, 1, now);
  d.pragma("user_version = 10");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("organizations gains stripe_customer_id + billing_status default 'ok'", () => {
  const cols = db.prepare("PRAGMA table_info(organizations)").all().map((c) => c.name);
  assert.ok(cols.includes("stripe_customer_id"));
  assert.ok(cols.includes("billing_status"));
  const row = db.prepare("SELECT billing_status FROM organizations WHERE id=1").get();
  assert.equal(row.billing_status, "ok");
});

test("billing_status CHECK allows only ok/arrears", () => {
  assert.throws(() => db.prepare("UPDATE organizations SET billing_status='payment_failed' WHERE id=1").run());
  db.prepare("UPDATE organizations SET billing_status='arrears' WHERE id=1").run();
  db.prepare("UPDATE organizations SET billing_status='ok' WHERE id=1").run();
});

test("credit_ledger exists with UNIQUE idempotency columns", () => {
  db.prepare("INSERT INTO credit_ledger (org_id,amount_pence,type,stripe_session_id,created_at) VALUES (?,?,?,?,?)")
    .run(1, 1000, "topup", "cs_test_1", new Date().toISOString());
  assert.throws(() =>
    db.prepare("INSERT INTO credit_ledger (org_id,amount_pence,type,stripe_session_id,created_at) VALUES (?,?,?,?,?)")
      .run(1, 1000, "topup", "cs_test_1", new Date().toISOString())
  ); // UNIQUE(stripe_session_id) violated
});

test("credit_ledger type CHECK rejects unknown types", () => {
  assert.throws(() =>
    db.prepare("INSERT INTO credit_ledger (org_id,amount_pence,type,created_at) VALUES (?,?,?,?)")
      .run(1, 1, "bogus", new Date().toISOString())
  );
});

test("resource_ownership gains a nullable plan_id (NULL after ALTER)", () => {
  const cols = db.prepare("PRAGMA table_info(resource_ownership)").all().map((c) => c.name);
  assert.ok(cols.includes("plan_id"));
  const row = db.prepare("SELECT plan_id FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  assert.equal(row.plan_id, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/test_billing_migration.mjs`
Expected: FAIL — `no such table: credit_ledger` (migration 11 doesn't exist yet).

- [ ] **Step 3: Append migration 11 to the `MIGRATIONS` array**

In `server/db.js`, add this as the **last** element of `MIGRATIONS` (after the `// -> user_version 10` migration's closing `},` at `server/db.js:206`, before the array's closing `];`):

```javascript
  // -> user_version 11: org billing columns, credit ledger, resource plan_id
  (d) => {
    d.exec(`
      ALTER TABLE organizations ADD COLUMN stripe_customer_id TEXT;   -- cus_…, nullable until first top-up
      ALTER TABLE organizations ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'ok'
                                 CHECK(billing_status IN ('ok','arrears'));

      -- Append-only wallet ledger. balance = SUM(amount_pence). topup/refund rows
      -- are positive; hardware_charge/usage/adjustment rows may be negative.
      CREATE TABLE credit_ledger (
        id                       INTEGER PRIMARY KEY,
        org_id                   INTEGER NOT NULL REFERENCES organizations(id),
        amount_pence             INTEGER NOT NULL,        -- signed; GBP minor units
        type                     TEXT NOT NULL CHECK(type IN ('topup','hardware_charge','usage','refund','adjustment')),
        stripe_session_id        TEXT UNIQUE,             -- checkout.session.id; idempotency guard
        stripe_payment_intent_id TEXT UNIQUE,             -- pi_…; idempotency guard (unused in prepaid-only MVP; kept for refunds)
        period                   TEXT,                    -- 'YYYY-MM' for hardware_charge/usage; null otherwise
        notes                    TEXT,
        created_at               TEXT NOT NULL
      );
      CREATE INDEX idx_credit_ledger_org ON credit_ledger(org_id, created_at);

      -- Lets the monthly charge be computed without calling Coolify. NULL → £0 until set.
      ALTER TABLE resource_ownership ADD COLUMN plan_id TEXT;
    `);

    // Validation — throw (rolls back the migration transaction) if the ALTERs didn't apply.
    d.prepare("SELECT COUNT(*) FROM credit_ledger").get(); // table exists, 0 rows is fine
    const bad = d.prepare("SELECT COUNT(*) c FROM organizations WHERE billing_status NOT IN ('ok','arrears')").get().c;
    if (bad) throw new Error(`migration 11: ${bad} orgs with invalid billing_status`);
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test server/test_billing_migration.mjs`
Expected: PASS (5 tests). The temp file is `rmSync`'d at the start of each run.

- [ ] **Step 5: Verify existing migrations still pass (no regression)**

Run: `node --test server/test_orgs_migration.mjs server/test_isolation.mjs server/test_db.mjs`
Expected: PASS (migration 11 is additive; `:memory:` DBs migrate cleanly through 11).

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/test_billing_migration.mjs
git commit -m "feat(db): migration 11 — org billing columns, credit_ledger, resource plan_id"
```

---

### Task 2: `plans.js` lookup + `usdToPence` conversion helper (shared with B)

**Files:**
- Modify: `server/plans.js` (add a `planPriceUsd(planId)` lookup)
- Create: `server/billing.js` (module skeleton + `usdToPence`)
- Test: `server/test_billing.mjs` (new — starts with the conversion + lookup cases)

**Interfaces:**
- Consumes: `COMPUTE_PLANS`, `DB_PLANS` (`server/plans.js`); `getSetting` (`server/db.js:269`).
- Produces:
  - `server/plans.js` → `export function planPriceUsd(planId) → number` (USD/mo `priceMo` for a plan id across both catalogs; `0` for unknown/`null`).
  - `server/billing.js` → `export function usdGbpRate() → number` (reads `app_settings 'usd_gbp_rate'`, default `0.79`) and `export function usdToPence(usd) → integer` (`Math.round(usd * rate * 100)`). **B imports `usdToPence` — do not duplicate.**

- [ ] **Step 1: Write the failing tests**

Create `server/test_billing.mjs`:

```javascript
// Billing: ledger + idempotency + charge math. Run: node --test server/test_billing.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const db = await import("./db.js");
const { planPriceUsd } = await import("./plans.js");
const billing = await import("./billing.js");

test("planPriceUsd looks up compute + db catalogs; unknown → 0", () => {
  assert.equal(planPriceUsd("pro"), 15);
  assert.equal(planPriceUsd("db-pro"), 45);
  assert.equal(planPriceUsd("nope"), 0);
  assert.equal(planPriceUsd(null), 0);
});

test("usdToPence uses the configurable rate (default 0.79) and rounds", () => {
  // default rate 0.79: 15 USD → round(15*0.79*100) = round(1185) = 1185
  assert.equal(billing.usdToPence(15), 1185);
  db.setSetting("usd_gbp_rate", "0.80");
  assert.equal(billing.usdToPence(15), 1200); // round(15*0.80*100)
  db.setSetting("usd_gbp_rate", "0.79"); // restore for later tests
  assert.equal(billing.usdToPence(0), 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_billing.mjs`
Expected: FAIL — cannot find module `./billing.js` (and `planPriceUsd is not a function`).

- [ ] **Step 3: Add `planPriceUsd` to `server/plans.js`**

Append to `server/plans.js` (after the `dbPlans` export at line 29):

```javascript
// USD/mo customer price for a plan id, across both catalogs. Unknown/null → 0
// (a resource with no plan contributes £0 to the monthly charge — free until assigned).
export function planPriceUsd(planId) {
  if (!planId) return 0;
  const p = [...COMPUTE_PLANS, ...DB_PLANS].find((x) => x.id === planId);
  return p ? p.priceMo : 0;
}
```

- [ ] **Step 4: Create `server/billing.js` with the conversion helper**

Create `server/billing.js`:

```javascript
// Stripe + prepaid credit wallet. All ledger + Stripe logic lives here so
// index.js routes stay thin. Money is integer pence; balance = SUM(ledger).
import { db, getSetting } from "./db.js";
import { planPriceUsd } from "./plans.js";

const DEFAULT_USD_GBP_RATE = 0.79;

// USD→GBP rate from app_settings (operator-editable). Shared with subsystem B.
// ponytail: default 0.79; a real FX feed slots in here if the flat rate ever drifts.
export function usdGbpRate() {
  const raw = getSetting("usd_gbp_rate");
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_GBP_RATE;
}

// The one float→int money conversion. Math.round at the plans.js boundary.
// ponytail: integer pence in the DB from here on; never store the float.
export function usdToPence(usd) {
  return Math.round(Number(usd) * usdGbpRate() * 100);
}

export { planPriceUsd }; // re-export so callers get plan lookup + conversion from one module
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test server/test_billing.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add server/plans.js server/billing.js server/test_billing.mjs
git commit -m "feat(billing): plan price lookup + usdToPence conversion (shared with subsystem B)"
```

---

### Task 3: Wallet ledger — `walletBalance`, `creditWallet` (idempotent)

**Files:**
- Modify: `server/billing.js`
- Test: `server/test_billing.mjs` (add balance + idempotency cases)

**Interfaces:**
- Consumes: `db` (`server/db.js`).
- Produces:
  - `walletBalance(orgId) → integer pence` — `COALESCE(SUM(amount_pence),0)`.
  - `creditWallet({ orgId, amountPence, type, stripeSessionId?, stripePaymentIntentId?, period?, notes? }) → { inserted: boolean }` — single `INSERT OR IGNORE`; the `UNIQUE` guards make webhook replay a no-op.
  - `recentLedger(orgId, limit=20) → rows` — for the wallet view.

- [ ] **Step 1: Add the failing tests to `server/test_billing.mjs`**

Append:

```javascript
test("balance = SUM(amount_pence), integer pence, may go negative (arrears)", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Bal Co", "bal-co", now).lastInsertRowid;
  assert.equal(billing.walletBalance(org), 0); // empty ledger → £0
  billing.creditWallet({ orgId: org, amountPence: 1000, type: "topup", stripeSessionId: "cs_bal_1" }); // +£10
  billing.creditWallet({ orgId: org, amountPence: -300, type: "hardware_charge", period: "2026-07" }); // −£3
  assert.equal(billing.walletBalance(org), 700); // £7
  billing.creditWallet({ orgId: org, amountPence: -1000, type: "hardware_charge", period: "2026-08" }); // −£10
  assert.equal(billing.walletBalance(org), -300); // arrears, still integer
});

test("CRITICAL: crediting the same stripe_session_id twice inserts ONE row", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Idem Co", "idem-co", now).lastInsertRowid;
  const r1 = billing.creditWallet({ orgId: org, amountPence: 2500, type: "topup", stripeSessionId: "cs_dup" });
  const r2 = billing.creditWallet({ orgId: org, amountPence: 2500, type: "topup", stripeSessionId: "cs_dup" });
  assert.equal(r1.inserted, true);
  assert.equal(r2.inserted, false); // silent no-op on replay
  assert.equal(billing.walletBalance(org), 2500); // credited once, not twice
  const rows = db.db.prepare("SELECT COUNT(*) c FROM credit_ledger WHERE stripe_session_id='cs_dup'").get();
  assert.equal(rows.c, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_billing.mjs`
Expected: FAIL — `billing.walletBalance is not a function`.

- [ ] **Step 3: Add the ledger helpers to `server/billing.js`**

Append to `server/billing.js`:

```javascript
// --- wallet ledger ----------------------------------------------------------

const nowIso = () => new Date().toISOString();

// Balance is always a live SUM — no cached column, nothing to drift.
export function walletBalance(orgId) {
  return db.prepare("SELECT COALESCE(SUM(amount_pence),0) b FROM credit_ledger WHERE org_id = ?").get(orgId).b;
}

// Single INSERT OR IGNORE. The UNIQUE(stripe_session_id)/(stripe_payment_intent_id)
// columns make a duplicate webhook delivery a silent no-op (idempotent crediting).
// Returns { inserted } so the webhook can tell a first delivery from a replay.
export function creditWallet({
  orgId, amountPence, type,
  stripeSessionId = null, stripePaymentIntentId = null, period = null, notes = null,
}) {
  const info = db.prepare(
    `INSERT OR IGNORE INTO credit_ledger
       (org_id, amount_pence, type, stripe_session_id, stripe_payment_intent_id, period, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(orgId, amountPence, type, stripeSessionId, stripePaymentIntentId, period, notes, nowIso());
  return { inserted: info.changes > 0 };
}

export const recentLedger = (orgId, limit = 20) =>
  db.prepare(
    "SELECT id, amount_pence, type, period, notes, created_at FROM credit_ledger " +
      "WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"
  ).all(orgId, limit);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_billing.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/billing.js server/test_billing.mjs
git commit -m "feat(billing): wallet ledger — walletBalance + idempotent creditWallet"
```

---

### Task 4: Monthly charge — `computeMonthlyCharge` + idempotent `chargeMonthlyHardware`

**Files:**
- Modify: `server/billing.js`
- Test: `server/test_billing.mjs` (add charge-math + charge-idempotency + arrears cases)

**Interfaces:**
- Consumes: `db`, `planPriceUsd`, `usdToPence`, `walletBalance`, `creditWallet` (all in-module or `plans.js`).
- Produces:
  - `computeMonthlyCharge(orgId) → integer pence` — `Σ planPriceUsd(plan_id)` over the org's resources, converted once via `usdToPence` (round after summing USD, so pence rounds once).
  - `chargeMonthlyHardware(orgId, period) → { charged: pence, skipped?: reason }` — idempotent per `(org_id, period)`; debits the wallet; sets `billing_status='arrears'` when the debit drives the balance negative, else `'ok'`. **Never calls Stripe** (prepaid-only).
  - `currentPeriod() → 'YYYY-MM'`.

- [ ] **Step 1: Add the failing tests to `server/test_billing.mjs`**

Append:

```javascript
test("CRITICAL charge math: pro + db-pro, NULL plan contributes 0", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Charge Co", "charge-co", now).lastInsertRowid;
  const ins = db.db.prepare(
    "INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,plan_id,created_at) VALUES (?,?,?,?,?,?)"
  );
  ins.run("a-pro", "application", 1, org, "pro", now);      // $15
  ins.run("d-pro", "database", 1, org, "db-pro", now);      // $45
  ins.run("a-free", "application", 1, org, null, now);      // $0 (unassigned)
  // (15+45) USD * 0.79 * 100 = round(4740) = 4740 pence
  assert.equal(billing.computeMonthlyCharge(org), 4740);
});

test("CRITICAL: chargeMonthlyHardware is idempotent per (org, period)", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Month Co", "month-co", now).lastInsertRowid;
  db.db.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,plan_id,created_at) VALUES (?,?,?,?,?,?)")
    .run("m-pro", "application", 1, org, "pro", now); // round(15*0.79*100)=1185
  billing.creditWallet({ orgId: org, amountPence: 5000, type: "topup", stripeSessionId: "cs_month" });
  billing.chargeMonthlyHardware(org, "2026-07");
  billing.chargeMonthlyHardware(org, "2026-07"); // second call: no-op
  const rows = db.db.prepare(
    "SELECT COUNT(*) c FROM credit_ledger WHERE org_id=? AND type='hardware_charge' AND period='2026-07'"
  ).get(org);
  assert.equal(rows.c, 1); // exactly one charge for the period
  assert.equal(billing.walletBalance(org), 5000 - 1185);
});

test("charge drives negative balance → billing_status='arrears', no Stripe", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Arrears Co", "arrears-co", now).lastInsertRowid;
  db.db.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,org_id,plan_id,created_at) VALUES (?,?,?,?,?,?)")
    .run("ar-pro", "application", 1, org, "pro", now);
  // empty wallet → charge of 1185 pushes to −1185
  billing.chargeMonthlyHardware(org, "2026-07");
  assert.equal(billing.walletBalance(org), -1185);
  const st = db.db.prepare("SELECT billing_status FROM organizations WHERE id=?").get(org);
  assert.equal(st.billing_status, "arrears");
});

test("zero charge (no priced resources) inserts nothing", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Zero Co", "zero-co", now).lastInsertRowid;
  const res = billing.chargeMonthlyHardware(org, "2026-07");
  assert.equal(res.charged, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) c FROM credit_ledger WHERE org_id=?").get(org).c, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_billing.mjs`
Expected: FAIL — `billing.computeMonthlyCharge is not a function`.

- [ ] **Step 3: Add the charge logic to `server/billing.js`**

Append to `server/billing.js`:

```javascript
// --- monthly hardware charge ------------------------------------------------

export const currentPeriod = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Sum the org's owned resources' plan price. Convert USD→pence once, after summing
// (round once, not per-resource). NULL plan_id → 0 (free until assigned).
export function computeMonthlyCharge(orgId) {
  const rows = db.prepare("SELECT plan_id FROM resource_ownership WHERE org_id = ?").all(orgId);
  const usd = rows.reduce((sum, r) => sum + planPriceUsd(r.plan_id), 0);
  return usdToPence(usd);
}

// Idempotent per (org, period). Debits the wallet (prepaid-only — NEVER calls Stripe).
// A negative resulting balance is tracked arrears; the advisory banner asks the owner
// to top up. Nothing is suspended.
// better-sqlite3 is synchronous + single-connection, so the guard-check + insert below
// is race-free without an explicit BEGIN.
// ponytail: subsystem B usage drawdown lands here — an additional type='usage' debit
// computed from B's metering, same wallet, same shape. Wire after B ships.
export function chargeMonthlyHardware(orgId, period) {
  const already = db.prepare(
    "SELECT 1 FROM credit_ledger WHERE org_id = ? AND type = 'hardware_charge' AND period = ?"
  ).get(orgId, period);
  if (already) return { charged: 0, skipped: "already_charged" };

  const charge = computeMonthlyCharge(orgId);
  if (charge === 0) return { charged: 0, skipped: "no_priced_resources" };

  creditWallet({ orgId, amountPence: -charge, type: "hardware_charge", period, notes: `Hardware ${period}` });
  const status = walletBalance(orgId) < 0 ? "arrears" : "ok";
  db.prepare("UPDATE organizations SET billing_status = ? WHERE id = ?").run(status, orgId);
  return { charged: charge };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_billing.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/billing.js server/test_billing.mjs
git commit -m "feat(billing): monthly hardware charge — compute + idempotent debit (arrears, no suspension)"
```

---

### Task 5: `getOrCreateStripeCustomer` + Checkout top-up + webhook credit (Stripe stubbed)

**Files:**
- Modify: `server/billing.js` (Stripe client + `getOrCreateStripeCustomer`, `createTopupSession`, `handleWebhookEvent`)
- Test: `server/test_billing.mjs` (add customer-lazy-create + webhook-credit cases with a stub)

**Interfaces:**
- Consumes: `stripe` SDK (new dep), `db`, `creditWallet`, `recordSystem` (`server/audit.js`).
- Produces:
  - `stripeClient() → Stripe | null` — lazily constructed from `STRIPE_SECRET_KEY`; `null` when unset (so importing `billing.js` in tests without a key is safe). **Tests inject a stub via `setStripeForTests()`.**
  - `getOrCreateStripeCustomer(orgId) → cus_…` — reads `organizations.stripe_customer_id`; if null, creates via Stripe (idempotency key `create-customer-<orgId>`) using the org's primary owner email, writes `cus_…` back. Lazy (first top-up), not at signup.
  - `createTopupSession({ orgId, amountPence, successUrl, cancelUrl }) → { url }`.
  - `handleWebhookEvent(event) → { credited?: boolean }` — processes `checkout.session.completed` (mode `payment`, `payment_status==='paid'`) → idempotent `creditWallet({ type:'topup' })` + `recordSystem`. Ignores other events.

- [ ] **Step 1: Install the Stripe SDK**

Run: `npm install stripe --prefix server`
Expected: `stripe` added to `server/package.json` dependencies.

- [ ] **Step 2: Add the failing tests (with a Stripe stub) to `server/test_billing.mjs`**

Append:

```javascript
test("getOrCreateStripeCustomer creates once, then reuses cus_ from the row", async () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Cust Co", "cust-co", now).lastInsertRowid;
  const u = db.createUser({ email: "owner@cust.co", name: "Owner", role: "customer" });
  db.db.prepare("INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (?,?,?,?)")
    .run(u.id, org, "owner", now);

  let createCalls = 0;
  billing.setStripeForTests({
    customers: { create: async () => { createCalls += 1; return { id: "cus_stub_1" }; } },
  });
  const c1 = await billing.getOrCreateStripeCustomer(org);
  const c2 = await billing.getOrCreateStripeCustomer(org);
  assert.equal(c1, "cus_stub_1");
  assert.equal(c2, "cus_stub_1");
  assert.equal(createCalls, 1); // second call reuses the stored id
});

test("webhook credits a paid topup session once, idempotently", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Hook Co", "hook-co", now).lastInsertRowid;
  const event = {
    type: "checkout.session.completed",
    data: { object: { id: "cs_hook_1", mode: "payment", payment_status: "paid",
      metadata: { org_id: String(org), amount_pence: "5000" } } },
  };
  const r1 = billing.handleWebhookEvent(event);
  const r2 = billing.handleWebhookEvent(event); // replay
  assert.equal(r1.credited, true);
  assert.equal(r2.credited, false); // idempotent: INSERT OR IGNORE no-op
  assert.equal(billing.walletBalance(org), 5000);
});

test("webhook ignores unpaid / non-payment sessions", () => {
  const now = new Date().toISOString();
  const org = db.db.prepare("INSERT INTO organizations (name,slug,created_at) VALUES (?,?,?)")
    .run("Ign Co", "ign-co", now).lastInsertRowid;
  billing.handleWebhookEvent({ type: "checkout.session.completed",
    data: { object: { id: "cs_unpaid", mode: "payment", payment_status: "unpaid",
      metadata: { org_id: String(org), amount_pence: "999" } } } });
  billing.handleWebhookEvent({ type: "payment_intent.created", data: { object: {} } });
  assert.equal(billing.walletBalance(org), 0);
});
```

- [ ] **Step 3: Add the Stripe layer to `server/billing.js`**

At the top of `server/billing.js`, extend the imports:

```javascript
import Stripe from "stripe";
import { recordSystem } from "./audit.js";
```

Append to `server/billing.js`:

```javascript
// --- Stripe (test mode first; live keys are a config swap, not a code change) ---

let _stripe; // lazily constructed; null when no key (importing billing.js stays safe in tests)
export function stripeClient() {
  if (_stripe !== undefined) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  _stripe = key ? new Stripe(key) : null;
  return _stripe;
}
// Tests inject a stub so no real Stripe call is made (money tests hit the ledger).
export function setStripeForTests(stub) { _stripe = stub; }

// Org's stable primary-owner email — the Stripe customer's email.
function ownerEmail(orgId) {
  return db.prepare(
    "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id " +
      "WHERE m.org_id = ? AND m.role = 'owner' ORDER BY m.created_at LIMIT 1"
  ).get(orgId)?.email || null;
}

// Lazy: creates the Stripe customer on first top-up (a Stripe outage must not block
// org creation). stripe_customer_id (cus_…) is NOT a secret — stored plaintext.
export async function getOrCreateStripeCustomer(orgId) {
  const row = db.prepare("SELECT stripe_customer_id, name FROM organizations WHERE id = ?").get(orgId);
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const stripe = stripeClient();
  if (!stripe) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  const customer = await stripe.customers.create(
    { email: ownerEmail(orgId), name: row?.name, metadata: { org_id: String(orgId) } },
    { idempotencyKey: `create-customer-${orgId}` }
  );
  db.prepare("UPDATE organizations SET stripe_customer_id = ? WHERE id = ?").run(customer.id, orgId);
  return customer.id;
}

// Hosted Checkout — no card data touches Express. Inline price_data so any amount works;
// a nonce lets an owner top up twice in a day.
export async function createTopupSession({ orgId, amountPence, successUrl, cancelUrl }) {
  const stripe = stripeClient();
  if (!stripe) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
  const customer = await getOrCreateStripeCustomer(orgId);
  const nonce = Math.random().toString(36).slice(2, 10);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer,
      line_items: [{
        price_data: {
          currency: "gbp",
          unit_amount: amountPence,
          product_data: { name: "Account credit top-up" },
        },
        quantity: 1,
      }],
      metadata: { org_id: String(orgId), amount_pence: String(amountPence) },
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
    { idempotencyKey: `topup-session-${orgId}-${nonce}` }
  );
  return { url: session.url };
}

// Process a verified webhook event. Only paid, payment-mode Checkout sessions credit
// the wallet; the UNIQUE(stripe_session_id) guard makes a replay a silent no-op.
// ponytail: GBP cards are synchronous, so no async_payment_succeeded handling until BACS.
export function handleWebhookEvent(event) {
  if (event.type !== "checkout.session.completed") return { credited: false };
  const s = event.data.object;
  if (s.mode !== "payment" || s.payment_status !== "paid") return { credited: false };
  const orgId = Number(s.metadata?.org_id);
  const amountPence = Number(s.metadata?.amount_pence);
  if (!orgId || !Number.isFinite(amountPence)) return { credited: false };
  const { inserted } = creditWallet({
    orgId, amountPence, type: "topup", stripeSessionId: s.id, notes: "Stripe top-up",
  });
  if (inserted) recordSystem("billing.topup_credited", { metadata: { org_id: orgId, amount_pence: amountPence, session: s.id } });
  return { credited: inserted };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_billing.mjs`
Expected: PASS (11 tests). No real Stripe call is made (stub + ledger only).

- [ ] **Step 5: Commit**

```bash
git add server/billing.js server/test_billing.mjs server/package.json server/package-lock.json
git commit -m "feat(billing): Stripe customer + Checkout top-up + idempotent webhook credit"
```

---

### Task 6: Webhook + owner-only billing routes + plan assignment

**Files:**
- Modify: `server/index.js`
- Test: `server/test_billing_routes.mjs` (new — gating + plan-validation as pure assertions)

**Interfaces:**
- Consumes: `walletBalance`, `recentLedger`, `createTopupSession`, `handleWebhookEvent`, `getOrCreateStripeCustomer`, `stripeClient` (`server/billing.js`); `assertOwns`, `attachOrgContext`, `requireCapability`, `record`, `h`, `mutateGuard`, `clientOrigin`; `planPriceUsd` (`server/plans.js`).
- Produces routes:
  - `POST /api/stripe/webhook` — **no auth, no mutateGuard** — signature-verified; credits the ledger.
  - `GET  /api/billing/wallet` — `read` — `{ balance_pence, billing_status, recent_ledger[] }`.
  - `POST /api/billing/topup` — `owner` — `{ url }`.
  - `POST /api/billing/portal` — `owner` — `{ url }` (view Stripe-side history).
  - `PATCH /api/services/:id/plan` — `manage` — sets `resource_ownership.plan_id`.
  - `PATCH /api/databases/:id/plan` — `manage` — sets `resource_ownership.plan_id`.
  - `POST /api/admin/billing/run-monthly` — `requireAdmin` — idempotent external-cron entry point.

- [ ] **Step 1: Write the failing gating test**

Create `server/test_billing_routes.mjs`:

```javascript
// Billing route gating + plan validation. Run: node --test server/test_billing_routes.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCapability } from "./rbac.js";
import { planPriceUsd } from "./plans.js";

test("all members read the wallet; only owner mutates (topup/portal)", () => {
  assert.equal(hasCapability("viewer", "read"), true);
  assert.equal(hasCapability("deployer", "read"), true);
  assert.equal(hasCapability("manager", "read"), true);
  assert.equal(hasCapability("viewer", "owner"), false);
  assert.equal(hasCapability("deployer", "owner"), false);
  assert.equal(hasCapability("manager", "owner"), false);
  assert.equal(hasCapability("owner", "owner"), true);
});

test("plan assignment is manage-gated; unknown plan id is invalid (price 0)", () => {
  assert.equal(hasCapability("deployer", "manage"), false);
  assert.equal(hasCapability("manager", "manage"), true);
  assert.equal(planPriceUsd("pro") > 0, true);   // valid plan
  assert.equal(planPriceUsd("not-a-plan"), 0);   // route rejects (see handler)
});
```

- [ ] **Step 2: Run to verify it passes as a gating spec**

Run: `node --test server/test_billing_routes.mjs`
Expected: PASS (asserts the capability levels + plan lookup the routes rely on).

- [ ] **Step 3: Wire the imports + webhook + routes in `server/index.js`**

Add near the other imports (after `import { record, recordSystem } from "./audit.js";` at line 46):

```javascript
import {
  walletBalance, recentLedger, createTopupSession, handleWebhookEvent, stripeClient,
} from "./billing.js";
import { planPriceUsd } from "./plans.js";
```

Add the **webhook** route next to the GitHub webhook (`server/index.js:733`), **before** `requireAuth`-guarded routes. It reads `req.rawBody` (captured at `server/index.js:86`) and is not subject to `mutateGuard`:

```javascript
// Stripe webhook: inbound Stripe call, no session/cookie — outside requireAuth + mutateGuard,
// same as /github/webhook. Signature-verified against the exact raw bytes.
app.post("/api/stripe/webhook", (req, res) => {
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    recordSystem("billing.webhook_bad_signature", { metadata: { error: err.message } });
    return res.status(400).json({ error: "bad signature" });
  }
  try {
    handleWebhookEvent(event); // idempotent credit
  } catch (err) {
    console.error("stripe webhook:", err.message);
  }
  res.json({ received: true }); // respond 200 quickly
});
```

Add the **billing + plan routes** near the org routes (after the member routes ending ~`server/index.js:1380`):

```javascript
// --- billing (prepaid wallet) ---
app.get("/api/billing/wallet", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => {
    const org = db.prepare("SELECT billing_status FROM organizations WHERE id = ?").get(req.org.id);
    return {
      balance_pence: walletBalance(req.org.id),
      billing_status: org?.billing_status || "ok",
      recent_ledger: recentLedger(req.org.id),
    };
  })
);

app.post("/api/billing/topup", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h(async (req) => {
    const amountPence = Number(req.body?.amount_pence);
    if (!Number.isInteger(amountPence) || amountPence < 100) { // £1 minimum
      throw Object.assign(new Error("amount_pence must be an integer ≥ 100"), { status: 400 });
    }
    record(req, "billing.topup_initiated", { metadata: { org_id: req.org.id, amount_pence: amountPence } });
    return createTopupSession({
      orgId: req.org.id, amountPence,
      successUrl: `${clientOrigin}/billing?topup=success`,
      cancelUrl: `${clientOrigin}/billing?topup=cancel`,
    });
  })
);

app.post("/api/billing/portal", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h(async (req) => {
    const stripe = stripeClient();
    if (!stripe) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
    const { getOrCreateStripeCustomer } = await import("./billing.js");
    const customer = await getOrCreateStripeCustomer(req.org.id);
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${clientOrigin}/billing` });
    return { url: session.url };
  })
);

// Plan assignment — manage-gated. Sets resource_ownership.plan_id (drives the monthly charge).
function setResourcePlan(req, type) {
  const uuid = req.params.id;
  assertOwns(req.user, type, uuid); // org-scoped 404 on cross-org
  const planId = req.body?.plan_id === null ? null : String(req.body?.plan_id || "");
  if (planId && planPriceUsd(planId) === 0) {
    throw Object.assign(new Error("Unknown plan_id"), { status: 400 });
  }
  const changes = db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?")
    .run(planId || null, type, uuid).changes;
  if (!changes) throw Object.assign(new Error("Resource not found"), { status: 404 });
  record(req, "billing.plan_assigned", { resourceType: type, resourceUuid: uuid, metadata: { plan_id: planId || null } });
  return { ok: true, plan_id: planId || null };
}

app.patch("/api/services/:id/plan", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h((req) => setResourcePlan(req, "application")));

app.patch("/api/databases/:id/plan", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h((req) => setResourcePlan(req, "database")));

// Master-Admin external-cron entry point for the monthly charge. Idempotent per (org, period).
app.post("/api/admin/billing/run-monthly", requireAuth, requireAdmin, h(async () => {
  const { chargeMonthlyHardware, currentPeriod } = await import("./billing.js");
  const period = currentPeriod();
  const orgs = db.prepare("SELECT id FROM organizations").all();
  let charged = 0;
  for (const o of orgs) { if (chargeMonthlyHardware(o.id, period).charged > 0) charged += 1; }
  recordSystem("billing.run_monthly", { metadata: { period, orgs: orgs.length, charged } });
  return { period, orgs: orgs.length, charged };
}));
```

- [ ] **Step 4: Optional plan_id on create (additive)**

In `POST /api/apps` / the deploy-key create handler (`server/index.js:~608`) and `POST /api/databases` (`server/index.js:~446`), immediately after the existing `assign(uuid, type, userId)` call, accept an optional plan:

```javascript
    const planId = req.body?.plan_id ? String(req.body.plan_id) : null;
    if (planId && planPriceUsd(planId) > 0) {
      db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?")
        .run(planId, /* "application" | "database" */ type, uuid);
    }
```

(Use the literal `"application"` in the apps route and `"database"` in the databases route; there is no `type` var in the apps handler.)

- [ ] **Step 5: Boot check + gating test**

Run: `node --check server/index.js && node --test server/test_billing_routes.mjs`
Expected: no syntax errors; gating test PASS.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/test_billing_routes.mjs
git commit -m "feat(billing): stripe webhook + owner-only topup/portal/wallet routes + plan assignment"
```

---

### Task 7: Monthly-charge trigger (in-process hourly setInterval)

**Files:**
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `chargeMonthlyHardware`, `currentPeriod` (`server/billing.js`).
- Produces: an hourly `setInterval` (mirrors the health monitor at `server/index.js:1410`) that, for each org, calls `chargeMonthlyHardware(orgId, currentPeriod())`. Idempotent per `(org, period)` — a restart, or the hourly tick firing 24×/day, charges each org at most once per month.

- [ ] **Step 1: Add the trigger before `app.listen`**

Extend the billing import in `server/index.js` to add `chargeMonthlyHardware, currentPeriod`. Add this **after** the health-monitor block and **before** `const PORT = ...` (`server/index.js:1447`):

```javascript
// --- monthly hardware charge: hourly tick, idempotent per (org, period) ---
// ponytail: single-process setInterval; the (org, period) guard makes double-fire safe,
// but if the server is down for ALL of the billing day the charge is deferred until it
// next runs (any later tick in the same month still charges once). Reliable upgrade path:
// the admin POST /api/admin/billing/run-monthly hit by an external cron (Hetzner/GitHub Actions).
if (!demoMode && process.env.NODE_ENV !== "test") {
  const runMonthly = () => {
    const period = currentPeriod();
    for (const o of db.prepare("SELECT id FROM organizations").all()) {
      try { chargeMonthlyHardware(o.id, period); }
      catch (err) { console.error("monthly charge:", o.id, err.message); }
    }
  };
  const billingTimer = setInterval(runMonthly, 60 * 60_000); // hourly; guard makes it idempotent
  billingTimer.unref?.();
}
```

- [ ] **Step 2: Boot check**

Run: `node --check server/index.js`
Expected: no errors.

- [ ] **Step 3: Regression — billing suite still green**

Run: `node --test server/test_billing.mjs server/test_billing_routes.mjs server/test_billing_migration.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(billing): hourly monthly-charge tick (idempotent per org+period)"
```

---

### Task 8: Client — API methods, Billing page, nav gating

**Files:**
- Modify: `client/src/lib/api.js`
- Create: `client/src/pages/Billing.jsx`
- Modify: `client/src/App.jsx` (route + nav gating + page-title map)

**Interfaces:**
- Consumes: `/api/billing/wallet`, `/api/billing/topup`, `/api/billing/portal`, `/api/me` (returns `orgRole`).
- Produces: `api.wallet`, `api.topup`, `api.billingPortal`; a Billing page (balance + ledger for all members; top-up / portal for owners; arrears banner); a "Billing" nav entry.

- [ ] **Step 1: Add API methods**

In `client/src/lib/api.js`, add before the closing `};` of `export const api` (next to the Task-10 org methods from Subsystem A):

```javascript
  // Billing (prepaid wallet)
  wallet: () => req("/billing/wallet"),
  topup: (amount_pence) => req("/billing/topup", { method: "POST", body: { amount_pence } }),
  billingPortal: () => req("/billing/portal", { method: "POST" }),
```

- [ ] **Step 2: Create the Billing page**

Create `client/src/pages/Billing.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Wallet, CreditCard, ExternalLink, AlertTriangle } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.jsx";
import { PageHeader, Card, Spinner, timeAgo } from "../components/ui.jsx";

const PRESETS = [1000, 2500, 5000, 10000]; // pence: £10 / £25 / £50 / £100
const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;

export default function Billing() {
  const { user } = useAuth();
  const isOwner = user?.orgRole === "owner";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [amount, setAmount] = useState(2500); // pence
  const [busy, setBusy] = useState(false);

  const load = () => api.wallet().then(setData).catch(setError);
  useEffect(load, []);

  const topup = async (pence) => {
    setBusy(true);
    try { const { url } = await api.topup(pence); window.location.href = url; }
    catch (e) { setError(e); setBusy(false); }
  };
  const openPortal = async () => {
    setBusy(true);
    try { const { url } = await api.billingPortal(); window.location.href = url; }
    catch (e) { setError(e); setBusy(false); }
  };

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!data) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  return (
    <div className="page">
      <PageHeader title="Billing" subtitle="Your prepaid credit wallet." />

      {data.billing_status === "arrears" && (
        <Card className="mb-6" style={{ borderColor: "var(--err)" }}>
          <div className="flex items-center gap-2" style={{ color: "var(--err)" }}>
            <AlertTriangle size={16} />
            <span className="text-sm">Your balance is negative. Top up to clear arrears — no service is suspended.</span>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex items-center gap-2 mb-1" style={{ color: "var(--text-muted)" }}>
          <Wallet size={16} /><span className="text-sm">Wallet balance</span>
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, color: data.balance_pence < 0 ? "var(--err)" : "var(--text)" }}>
          {gbp(data.balance_pence)}
        </div>

        {isOwner && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2 items-center">
              {PRESETS.map((p) => (
                <button key={p} className={`btn ${amount === p ? "btn-primary" : ""}`} onClick={() => setAmount(p)}>{gbp(p)}</button>
              ))}
              <input className="input" type="number" min="1" step="1" style={{ width: 120 }}
                value={amount / 100} onChange={(e) => setAmount(Math.round(Number(e.target.value) * 100))} />
              <button className="btn btn-primary" disabled={busy || amount < 100} onClick={() => topup(amount)}>
                <CreditCard size={14} /> Top up
              </button>
              <button className="btn" disabled={busy} onClick={openPortal}><ExternalLink size={14} /> Manage in Stripe</button>
            </div>
          </div>
        )}
      </Card>

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Amount</th>
            <th className="px-4 py-3 font-semibold">Notes</th>
          </tr></thead>
          <tbody>
            {data.recent_ledger.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{timeAgo(r.created_at)}</td>
                <td className="px-4 py-3" style={{ color: "var(--text)" }}>{r.type}</td>
                <td className="px-4 py-3" style={{ color: r.amount_pence < 0 ? "var(--err)" : "var(--ok, var(--text))" }}>
                  {r.amount_pence < 0 ? "−" : "+"}{gbp(Math.abs(r.amount_pence))}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{r.notes || (r.period ? r.period : "—")}</td>
              </tr>
            ))}
            {data.recent_ledger.length === 0 && (
              <tr><td className="px-4 py-6" colSpan={4} style={{ color: "var(--text-muted)" }}>No transactions yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

Note: reuse existing UI classes (`input`, `btn`, `btn-primary`, `pill`, `mono`, `page`, `Card`, `PageHeader`, `Spinner`, `timeAgo`) exactly as `Team.jsx` (Subsystem A) does. If a CSS var (`--err`, `--ok`) is missing, match the closest one used in an existing page rather than inventing styles.

- [ ] **Step 3: Wire route + nav gating in `client/src/App.jsx`**

Add the import:

```jsx
import Billing from "./pages/Billing.jsx";
```

Add a Billing nav link — visible to all members (balance is read-only for non-owners), place it next to the Team link (around line 206):

```jsx
        {user?.orgRole && (
          <HoverNavLink to="/billing"><Wallet size={18} /><span>Billing</span></HoverNavLink>
        )}
```

(Import `Wallet` from `lucide-react` alongside the existing icon imports.)

Add the route (in the authed `<Routes>` block, next to `/team`, around line 476):

```jsx
            <Route path="/billing" element={<Billing />} />
```

Update the page-title map (around line 247) to add `"/billing": "Billing"`.

- [ ] **Step 4: Build the client to verify it compiles**

Run: `npm run build`
Expected: Vite build succeeds with no unresolved imports.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.js client/src/pages/Billing.jsx client/src/App.jsx
git commit -m "feat(ui): Billing page (wallet, top-up, arrears banner) + nav gating"
```

---

### Task 9: Env / secrets + Stripe CLI docs

**Files:**
- Modify: `server/.env.example`

**Interfaces:**
- Produces: documented `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` env vars.

- [ ] **Step 1: Append the Stripe keys to `server/.env.example`**

Add:

```
# --- Stripe (prepaid credit wallet) ---
# Test mode first: sk_test_… / whsec_… . Live is a config swap, not a code change.
# NEVER commit real keys; both are env-only, never in the DB, never logged.
STRIPE_SECRET_KEY=
# From `stripe listen --forward-to localhost:8787/api/stripe/webhook`, or Dashboard → Webhooks.
# A live key with a test webhook secret 400s every webhook and silently fails to credit wallets.
STRIPE_WEBHOOK_SECRET=
# Optional: override the USD→GBP rate at runtime via app_settings key 'usd_gbp_rate' (default 0.79).
```

- [ ] **Step 2: Commit**

```bash
git add server/.env.example
git commit -m "docs(billing): STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET env, Stripe CLI flow"
```

---

### Task 10: Full regression + spec-parity check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server test suite**

Run: `node --test server/`
Expected: all `test_*.mjs` PASS, including `test_billing.mjs`, `test_billing_migration.mjs`, `test_billing_routes.mjs`, and the Subsystem A suites (`test_isolation.mjs`, `test_orgs.mjs`, `test_orgs_migration.mjs`, `test_rbac.mjs`, `test_org_api.mjs`).

- [ ] **Step 2: Manual Stripe round-trip (test mode)**

Run: `stripe listen --forward-to localhost:8787/api/stripe/webhook` (copy the `whsec_…` into `server/.env`, restart the server), then `npm run dev`, sign in as an owner, hit **Top up £10**, complete Checkout with test card `4242 4242 4242 4242`, and confirm the wallet shows `£10.00` and one `topup` ledger row. Re-send the webhook (`stripe events resend <id>`) and confirm the balance is unchanged (idempotency).

- [ ] **Step 3: Commit any fixups, then finish the branch**

Use `superpowers:finishing-a-development-branch` to decide merge/PR.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-02-billing-wallet-stripe-design.md`, §"Decisions resolved" authoritative):
- Migration 11 — billing columns, `credit_ledger` (+ UNIQUE idempotency cols + index), `resource_ownership.plan_id`, in-transaction validation → Task 1. ✓
- `billing_status IN ('ok','arrears')` (CHECK updated per decision #4) → Task 1. ✓
- **PREPAID-ONLY** — no save-card, no off-session PaymentIntent, no `stripe_default_pm`, no 3DS/`requires_action` → **none built**; `stripe_payment_intent_id` kept only as a nullable UNIQUE column for future refunds, never charged. ✓
- USD→GBP via `app_settings 'usd_gbp_rate'` (default 0.79), exported `usdToPence` **reused by B** → Task 2. ✓
- Balance = `SUM(amount_pence)`, integer pence, no cached column → Tasks 2-3. ✓
- **CRITICAL money tests** — webhook idempotency (same `stripe_session_id` twice → one row), balance SUM, monthly-charge idempotency per (org, period), charge math (`pro`+`db-pro`, NULL→0) → Tasks 3, 4, 5. ✓
- Monthly charge debits wallet, negative = arrears, advisory banner, no suspension → Tasks 4, 8. ✓
- Free until assigned (NULL `plan_id` → £0) → Tasks 1, 2, 4. ✓
- Plan assignment (`PATCH /api/services/:id/plan` + `/api/databases/:id/plan`, manage-gated; optional `plan_id` on create) — **C owns this** → Task 6. ✓
- Stripe top-up Checkout + signature-verified webhook credit via `req.rawBody` → Tasks 5, 6. ✓
- `getOrCreateStripeCustomer` (lazy, plaintext `cus_…`) → Task 5. ✓
- Monthly-charge trigger (`setInterval` **and** admin cron endpoint) → Tasks 6, 7. ✓
- Owner-only mutations, all-members read; audit via `record()`/`recordSystem()` → Tasks 5, 6. ✓
- `Billing.jsx` + nav + arrears banner → Task 8. ✓
- Env → Task 9. ✓
- Stripe SDK **stubbed in tests** (`setStripeForTests`) → Tasks 5, 6. ✓

**Cross-subsystem ownership:** C owns migration 11, `billing.js`, the `usdToPence` GBP helper (exported for B), plan assignment, top-up + webhook, monthly charge, `Billing.jsx` + nav, env. C does **not** create `usage_events` (B, migration 12), the metering tick, `/api/org/usage`, or `Usage.jsx` — those are B and read C's `plan_id` + reuse `usdToPence`. No overlap.

**Deliberate omissions (`// ponytail:`, not gaps):** subsystem-B usage-drawdown seam marked in `chargeMonthlyHardware`; `async_payment_succeeded`/BACS not handled (GBP cards synchronous); FX is a flat operator-editable rate, not a live feed; single-process `setInterval` with the admin cron endpoint as the reliable upgrade path. The `stripe_payment_intent_id` UNIQUE column is retained (cheap, enables future refund idempotency) though prepaid-only never writes it.

**Type consistency:** `usdToPence`, `usdGbpRate`, `planPriceUsd`, `walletBalance`, `creditWallet`, `recentLedger`, `computeMonthlyCharge`, `chargeMonthlyHardware`, `currentPeriod`, `stripeClient`, `setStripeForTests`, `getOrCreateStripeCustomer`, `createTopupSession`, `handleWebhookEvent` are each defined once in `server/billing.js` and referenced with consistent names/signatures across Tasks 2-8. Money is integer pence at every DB boundary; the sole float→int conversion is `Math.round(usd * rate * 100)` in `usdToPence` (Task 2). `creditWallet` returns `{ inserted }`; `chargeMonthlyHardware` returns `{ charged, skipped? }`; `handleWebhookEvent` returns `{ credited }` — used consistently by the webhook route and tests.

**Placeholder scan:** No TBD/TODO; every code step shows complete runnable code. The `// ponytail:` markers are deliberate convention, not placeholders.
