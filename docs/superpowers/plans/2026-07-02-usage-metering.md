# Usage Metering Implementation Plan (Subsystem B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter per-org resource usage into GBP cost numbers — a Render-style usage summary — without spending anything. Compute is metered by **actual uptime** through the existing health-monitor tick; disk and bandwidth are **plan-derived computed lines** (no host sampling). B produces the numbers; subsystem C debits the wallet against them.

**Architecture:** A single new migration (`user_version` 12) adds one table, `usage_events` — one row per running resource per monitor tick, carrying `org_id`, `plan_id`, and a **denormalised `price_pence_per_hour`** frozen at write time so a mid-period plan change bills each segment at its own rate. The metering write is bolted onto the existing 60-second monitor tick in `server/index.js` (`~line 1410`), which is extended to also poll `coolify.listDatabases()`. A rollup helper in `server/db.js` sums events for a period into compute line items; disk and bandwidth lines are computed deterministically from the resource's plan (`resource_ownership.plan_id`, owned by subsystem C) and its `created_at`. Three read routes (`GET /api/org/usage`, `GET /api/org/usage/current`, `GET /api/admin/orgs/:id/usage`) expose the summary; a `Usage.jsx` page + nav entry render it for any member.

**Tech Stack:** Node ESM, Express, better-sqlite3, React + Vite + Tailwind v4. Tests use `node:test` + `node:assert/strict` against an in-memory / temp-file SQLite DB. Money is **integer pence** end-to-end.

## Global Constraints

- **ESM everywhere** (`"type": "module"`); use `import`, not `require`.
- **Depends on subsystem C — assume C is already built and merged.** Specifically:
  - C's **migration 11** added `resource_ownership.plan_id TEXT` (nullable; `'pro'`, `'db-pro'`, … mapping to `server/plans.js`). B **reads** this column and never alters it. If, and only if, B is ever built before C, B's first migration must `ALTER TABLE resource_ownership ADD COLUMN plan_id TEXT` itself — but per this plan C ships first, so migration 12 does **not** touch `plan_id`.
  - C's **`server/billing.js`** exports the shared GBP conversion helper **`usdToPence(usd)`** — it reads `app_settings` key `usd_gbp_rate` (default `0.79`, a `// ponytail:` constant), and returns `Math.round(usd * rate * 100)`. **B imports and reuses this — one rate, one source.** B never re-reads the rate or re-implements the conversion.
- **Money is integer pence.** No `REAL` columns for money, no JS float arithmetic that lands in the DB. `plans.js` `priceMo` (float USD) is converted **once**, at the `plans.js`/`billing.js` boundary, via `usdToPence`. Sub-penny rounding at the per-hour rate is acceptable (`// ponytail:` at the site).
- **Org-attributed; orphans skipped.** Every `usage_events` row carries `org_id` resolved from `resource_ownership.org_id`. A resource with **no ownership row / no `org_id`** is skipped — never inserted with a null org.
- **No plan → no meter.** A resource whose `resource_ownership.plan_id` is `NULL` writes **no** `usage_events` row and contributes £0 (it's on the free tier until assigned). Plan **assignment** (`PATCH …/plan`, create-time `plan_id`) is owned by subsystem C — B does not build it; B only reads the assigned `plan_id`.
- **Metering is best-effort inside the health tick.** A failed metering write logs and skips one sample; it must never throw out of the health monitor (which also drives outage notifications). `// ponytail:` at the site.
- **Conservative accrual.** The tick's existing reentrancy guard skips a slow tick rather than doubling it — slight under-accrual on a missed tick, never over-bill.
- **Zero-usage is £0, not an error.** The tick is gated `!demoMode && NODE_ENV !== 'test'`, so **no usage rows exist in demo/test**. Every consumer (rollup, route, UI) must return a well-formed £0 summary for a zero-usage org.
- **Cross-org isolation = 404** (non-disclosure), same rule as subsystem A. `GET /api/admin/orgs/:id/usage` is `requireAdmin`.
- Mark deliberate shortcuts with a `// ponytail:` comment (established convention; do not rename to `TODO`).
- Audit is not required for read-only usage routes; no `record()` calls in this subsystem.
- Run a single test file with: `node --test server/test_<name>.mjs`.

---

### Task 1: Migration 12 — `usage_events`

**Files:**
- Modify: `server/db.js` (append one migration to `MIGRATIONS`)
- Test: `server/test_metering_migration.mjs` (new)

**Interfaces:**
- Consumes: the existing `MIGRATIONS` array + `migrate()` machinery in `server/db.js`; assumes `user_version` is at **11** (C shipped).
- Produces: table `usage_events` and index `idx_usage_events_org_period`; bumps `user_version` to **12**.

- [ ] **Step 1: Write the failing migration test**

Create `server/test_metering_migration.mjs`. It builds an 11-shaped DB in a temp file (only the tables migration 12 references: `organizations` for the FK, plus `usage_events`'s own prerequisites), imports `db.js` to run the 11→12 migration, and asserts the table + index exist and the version is 12.

```javascript
// Migration 12 (usage_events). Run: node --test server/test_metering_migration.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v11 DB with just what migration 12's FK needs (organizations).
const file = path.join(os.tmpdir(), `dd-mig12-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.pragma("foreign_keys = ON");
  d.exec(`
    CREATE TABLE organizations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
    );
  `);
  d.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?,?,?)")
    .run("Acme", "acme", new Date().toISOString());
  d.pragma("user_version = 11");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("migration bumped user_version to 12", () => {
  assert.equal(db.pragma("user_version", { simple: true }), 12);
});

test("usage_events table exists with the expected columns", () => {
  const cols = db.prepare("PRAGMA table_info(usage_events)").all().map((c) => c.name);
  for (const name of [
    "id", "org_id", "coolify_uuid", "type", "plan_id",
    "price_pence_per_hour", "sampled_at", "interval_sec",
  ]) {
    assert.ok(cols.includes(name), `missing column ${name}`);
  }
});

test("the org/period index exists", () => {
  const idx = db.prepare("PRAGMA index_list(usage_events)").all().map((i) => i.name);
  assert.ok(idx.includes("idx_usage_events_org_period"));
});

test("a usage_events row round-trips", () => {
  db.prepare(
    "INSERT INTO usage_events (org_id, coolify_uuid, type, plan_id, price_pence_per_hour, sampled_at, interval_sec) " +
      "VALUES (?,?,?,?,?,?,?)"
  ).run(1, "app-1", "application", "pro", 2, new Date().toISOString(), 60);
  const row = db.prepare("SELECT price_pence_per_hour, interval_sec FROM usage_events WHERE coolify_uuid='app-1'").get();
  assert.equal(row.price_pence_per_hour, 2);
  assert.equal(row.interval_sec, 60);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/test_metering_migration.mjs`
Expected: FAIL — `no such table: usage_events` (migration 12 doesn't exist yet), or the `user_version` assertion fails at 11.

- [ ] **Step 3: Append migration 12 to the `MIGRATIONS` array in `server/db.js`**

Add this as the **last** element of `MIGRATIONS` (after the `// -> user_version 11` migration that C added — the `plan_id` / billing one; append after it, do not renumber). If, in a stale checkout, the last element is still migration 10, that means C is NOT built — stop and build C first (this plan assumes 11 exists).

```javascript
  // -> user_version 12: usage_events (compute metering by uptime; denormalised rate)
  (d) => {
    d.exec(`
      CREATE TABLE usage_events (
        id                   INTEGER PRIMARY KEY,
        org_id               INTEGER NOT NULL REFERENCES organizations(id),
        coolify_uuid         TEXT NOT NULL,
        type                 TEXT NOT NULL CHECK(type IN ('application','database','service')),
        plan_id              TEXT NOT NULL,
        price_pence_per_hour INTEGER NOT NULL,   -- GBP rate frozen at write time (mid-period plan change bills each segment correctly)
        sampled_at           TEXT NOT NULL,
        interval_sec         INTEGER NOT NULL DEFAULT 60
      );
      CREATE INDEX idx_usage_events_org_period ON usage_events(org_id, sampled_at);
    `);
    // No backfill: there is no historical usage. No UNIQUE — the tick's reentrancy
    // guard is the duplicate-suppression, not the schema.
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test server/test_metering_migration.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify existing suites still pass (migration is additive)**

Run: `node --test server/test_orgs.mjs server/test_isolation.mjs`
Expected: PASS (migration 12 adds a table; `:memory:` DBs migrate cleanly through 12).

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/test_metering_migration.mjs
git commit -m "feat(db): migration 12 — usage_events (compute metering)"
```

---

### Task 2: Rate helper — `planRatePencePerHour` (plans.js → pence/hour via C's GBP helper)

**Files:**
- Create: `server/metering.js` (new module; keeps `index.js` thin, mirrors C's `server/billing.js` split)
- Test: `server/test_metering.mjs` (new — first test)

**Interfaces:**
- Consumes: `COMPUTE_PLANS`, `DB_PLANS` from `server/plans.js`; `usdToPence` from `server/billing.js` (C).
- Produces (exported from `server/metering.js`):
  - `planById(planId) → planObject | undefined` — looks up a plan in either catalog by `id`.
  - `planRatePencePerHour(planId) → integer` — the per-hour GBP rate in pence for a plan, or `0` if the plan is unknown. `pricePence = usdToPence(priceMo)`; hourly = `Math.round(pricePence / 730.5)` (730.5 = 365.25/12 × 24 hrs/mo).
  - `planStorageGb(planId) → number` — the plan's allocated storage in GB (parsed from `disk`/`storage` string, e.g. `"80 GB"` → `80`), or `0` if unknown.

- [ ] **Step 1: Write the failing rate test**

Create `server/test_metering.mjs`:

```javascript
// Metering rate + rollup. Run: node --test server/test_metering.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { planById, planRatePencePerHour, planStorageGb } from "./metering.js";

test("planById finds compute and db plans", () => {
  assert.equal(planById("pro")?.priceMo, 15);
  assert.equal(planById("db-pro")?.priceMo, 45);
  assert.equal(planById("nope"), undefined);
});

test("planRatePencePerHour: pro → round(usdToPence(15) / 730.5)", () => {
  // usdToPence(15) with default rate 0.79 = round(15 * 0.79 * 100) = 1185 pence/mo.
  // 1185 / 730.5 = 1.622… → round → 2 pence/hour.
  assert.equal(planRatePencePerHour("pro"), 2);
  assert.equal(planRatePencePerHour("unknown"), 0);
});

test("planStorageGb parses the plan storage string", () => {
  assert.equal(planStorageGb("pro"), 80);       // COMPUTE_PLANS pro: disk "80 GB"
  assert.equal(planStorageGb("db-pro"), 50);    // DB_PLANS db-pro: storage "50 GB"
  assert.equal(planStorageGb("unknown"), 0);
});
```

Note: this test depends on C's `usdToPence` defaulting to rate `0.79`. If C's default differs, update the expected pence (the arithmetic, not the shape, changes).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_metering.mjs`
Expected: FAIL — cannot find module `./metering.js`.

- [ ] **Step 3: Create `server/metering.js` with the rate helpers**

```javascript
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_metering.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/metering.js server/test_metering.mjs
git commit -m "feat(metering): plan → GBP pence/hour rate + allocated storage helpers"
```

---

### Task 3: `insertUsageEvent` + `meterTick` (the write path, pure & testable)

**Files:**
- Modify: `server/metering.js` (add the write helpers)
- Test: `server/test_metering.mjs` (add running/stopped/orphan/no-plan cases)

**Interfaces:**
- Consumes: `db` from `server/db.js`; `planRatePencePerHour` (Task 2).
- Produces (exported from `server/metering.js`):
  - `ownedPlan(uuid) → { org_id, plan_id } | undefined` — reads `resource_ownership`; returns undefined if no row, `org_id` null, or `plan_id` null (all "skip" cases collapse to undefined).
  - `insertUsageEvent({ orgId, uuid, type, planId, sampledAt, intervalSec }) → void` — freezes the current rate onto the row.
  - `meterResources(resources, sampledAt) → number` — iterates `[{ uuid, type, status }]`; for each **running** resource with an owned org **and** a plan, inserts one event; returns the count inserted. Stopped / orphan / no-plan resources are skipped. This is the pure core the monitor tick calls.

- [ ] **Step 1: Add the failing write tests to `server/test_metering.mjs`**

Append:

```javascript
import { db, ensureUserOrg, createUser } from "./db.js";
import { assign } from "./ownership.js";
import { ownedPlan, insertUsageEvent, meterResources } from "./metering.js";

// Helper: assign ownership + a plan (C's plan_id lives on resource_ownership).
function own(uuid, type, userId, planId) {
  assign(uuid, type, userId); // stamps org_id (subsystem A)
  db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?")
    .run(planId, type, uuid);
}

test("ownedPlan returns org+plan only when both are present", () => {
  const u = createUser({ email: "m1@x.com", role: "customer" });
  ensureUserOrg(u.id);
  own("app-run", "application", u.id, "pro");
  const got = ownedPlan("app-run");
  assert.equal(got.plan_id, "pro");
  assert.ok(got.org_id);

  assign("app-noplan", "application", u.id); // no plan_id set
  assert.equal(ownedPlan("app-noplan"), undefined);
  assert.equal(ownedPlan("app-orphan"), undefined); // no ownership row at all
});

test("meterResources writes one row per running+owned+planned resource, with frozen rate", () => {
  const u = createUser({ email: "m2@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  own("svc-run", "application", u.id, "pro");
  own("svc-stopped", "application", u.id, "pro");
  own("svc-noplan", "application", u.id, null);
  const at = "2026-07-02T00:00:00.000Z";
  const inserted = meterResources(
    [
      { uuid: "svc-run", type: "application", status: "running" },
      { uuid: "svc-stopped", type: "application", status: "exited" },
      { uuid: "svc-noplan", type: "application", status: "running" }, // no plan → skip
      { uuid: "svc-orphan", type: "application", status: "running" }, // no ownership → skip
    ],
    at
  );
  assert.equal(inserted, 1);
  const rows = db.prepare("SELECT coolify_uuid, org_id, price_pence_per_hour FROM usage_events WHERE sampled_at = ?").all(at);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].coolify_uuid, "svc-run");
  assert.equal(rows[0].org_id, orgId);
  assert.equal(rows[0].price_pence_per_hour, 2); // pro, frozen
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_metering.mjs`
Expected: FAIL — `ownedPlan is not a function` (or the named imports are undefined).

- [ ] **Step 3: Add the write helpers to `server/metering.js`**

Add the `db` import to the top of `server/metering.js`:

```javascript
import { db } from "./db.js";
```

Append:

```javascript
// Ownership + plan for a resource. Returns undefined (⇒ skip) if there is no
// ownership row, no org_id (orphan), or no plan_id (free tier — no meter).
export function ownedPlan(uuid) {
  const row = db
    .prepare("SELECT org_id, plan_id FROM resource_ownership WHERE coolify_uuid = ?")
    .get(uuid);
  if (!row || row.org_id == null || row.plan_id == null) return undefined;
  return row;
}

// One usage row, with the GBP rate frozen at write time.
export function insertUsageEvent({ orgId, uuid, type, planId, sampledAt, intervalSec = 60 }) {
  db.prepare(
    "INSERT INTO usage_events (org_id, coolify_uuid, type, plan_id, price_pence_per_hour, sampled_at, interval_sec) " +
      "VALUES (?,?,?,?,?,?,?)"
  ).run(orgId, uuid, type, planId, planRatePencePerHour(planId), sampledAt, intervalSec);
}

// Pure core of the metering tick. `resources` = [{ uuid, type, status }].
// Writes one event per running + owned + planned resource; returns the count.
export function meterResources(resources, sampledAt, intervalSec = 60) {
  let inserted = 0;
  for (const r of resources) {
    if (r.status !== "running") continue;          // stopped ⇒ £0 compute
    const owned = ownedPlan(r.uuid);
    if (!owned) continue;                           // orphan or no plan ⇒ skip
    insertUsageEvent({
      orgId: owned.org_id, uuid: r.uuid, type: r.type,
      planId: owned.plan_id, sampledAt, intervalSec,
    });
    inserted += 1;
  }
  return inserted;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_metering.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/metering.js server/test_metering.mjs
git commit -m "feat(metering): usage-event write path (running+owned+planned only)"
```

---

### Task 4: `rollupUsage` — compute line items + disk + bandwidth (the GBP summary)

**Files:**
- Modify: `server/metering.js` (add the rollup + summary builder)
- Test: `server/test_metering.mjs` (add rollup, mid-period reprice, zero-usage cases)

**Interfaces:**
- Consumes: `db`; `planById`, `planStorageGb`, `usdToPence` (via `billing.js`); resource ownership for disk hours.
- Produces (exported from `server/metering.js`):
  - `rollupCompute(orgId, start, end) → [{ coolify_uuid, plan_id, compute_hours, pence }]` — SQL `GROUP BY coolify_uuid, plan_id` summing `interval_sec/3600` and `interval_sec/3600 * price_pence_per_hour`.
  - `usageSummary(orgId, period) → { period, currency:'GBP', lines:[…], totalPence }` — the Render-style summary. `period` is `YYYY-MM`; the builder resolves `[start,end)`. Each **compute** line: `{ type:'compute', uuid, name?, plan, computeHours, pence }`. For every **currently-owned+planned** resource it also emits an **allocated-disk** line (`plan_storage_gb × resource_hours_in_period × disk_rate`) and a **bandwidth** line (`{ type:'bandwidth', allowanceGb, usedGb:0, pence:0 }`). `totalPence` = sum of line `pence`. **Zero-usage org → `{ lines:[], totalPence:0 }`, not an error.**

Notes on the disk line (allocated, per the spec's resolved decisions):
- Disk pence = `Math.round(planStorageGb(plan_id) × resourceHours × diskRatePencePerGbHour(plan_id))`, where `resourceHours` is the resource's live hours within `[start,end)` derived from `resource_ownership.created_at` clamped to the period, and `diskRatePencePerGbHour` is a modest allocated-disk rate. There is **no** storage line item price in `plans.js`, so the disk rate is a single documented constant (`// ponytail:`), not per-plan.

- [ ] **Step 1: Add the failing rollup + reprice + zero tests**

Append to `server/test_metering.mjs`:

```javascript
import { rollupCompute, usageSummary } from "./metering.js";

test("rollupCompute sums compute-hours and pence over a period", () => {
  const u = createUser({ email: "roll@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  own("roll-app", "application", u.id, "pro"); // 2 pence/hr
  // 60 ticks of 60s = 3600s = 1.0 compute-hour at 2p/hr = 2 pence.
  const base = Date.UTC(2026, 6, 5, 0, 0, 0); // 2026-07-05
  for (let i = 0; i < 60; i++) {
    insertUsageEvent({
      orgId, uuid: "roll-app", type: "application", planId: "pro",
      sampledAt: new Date(base + i * 60_000).toISOString(), intervalSec: 60,
    });
  }
  const [line] = rollupCompute(orgId, "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  assert.equal(line.coolify_uuid, "roll-app");
  assert.equal(Math.round(line.compute_hours), 1);
  assert.equal(Math.round(line.pence), 2);
});

test("mid-period plan change bills each segment at its own frozen rate", () => {
  const u = createUser({ email: "reprice@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  own("rp-app", "application", u.id, "pro");
  const base = Date.UTC(2026, 6, 10, 0, 0, 0);
  // 36 ticks on pro (rate 2), then 36 on scale (rate 12) — frozen per row.
  for (let i = 0; i < 36; i++)
    insertUsageEvent({ orgId, uuid: "rp-app", type: "application", planId: "pro",
      sampledAt: new Date(base + i * 60_000).toISOString(), intervalSec: 60 });
  for (let i = 36; i < 72; i++)
    insertUsageEvent({ orgId, uuid: "rp-app", type: "application", planId: "scale",
      sampledAt: new Date(base + i * 60_000).toISOString(), intervalSec: 60 });
  const lines = rollupCompute(orgId, "2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
  // Two lines: one per plan_id, each at its own frozen rate — proves no retroactive reprice.
  const byPlan = Object.fromEntries(lines.map((l) => [l.plan_id, l]));
  assert.ok(byPlan.pro && byPlan.scale);
  // 0.6h each; pro pence = 0.6*2=1.2, scale pence = 0.6*12=7.2 → summary rounds later.
  assert.ok(byPlan.scale.pence > byPlan.pro.pence);
});

test("zero-usage org yields a £0 summary, not an error", () => {
  const u = createUser({ email: "zero@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  const s = usageSummary(orgId, "2026-07");
  assert.equal(s.totalPence, 0);
  assert.deepEqual(s.lines, []);
  assert.equal(s.currency, "GBP");
});
```

Note: `planRatePencePerHour("scale")` must exceed `pro`'s — `scale` is `priceMo:85` vs `pro:15`, so this holds regardless of the exact rate.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_metering.mjs`
Expected: FAIL — `rollupCompute is not a function`.

- [ ] **Step 3: Add the rollup + summary to `server/metering.js`**

Add `planStorageGb` is already defined; add the imports needed for the disk rate (`usdToPence` already imported). Append:

```javascript
// Allocated-disk rate: pence per GB-hour. No storage price in plans.js, so this is
// one documented constant. ponytail: flat allocated-disk rate; make per-plan if
// tiers get distinct storage pricing. ~ £0.10/GB-mo ≈ 10p/730.5h ≈ 0.0137p/GB-hr.
const DISK_PENCE_PER_GB_HOUR = 10 / HOURS_PER_MONTH; // pence per GB-hour (GBP)

// Bandwidth allowance per plan (GB/mo). plans.js has no field yet, so map by id.
// ponytail: flat allowance table; move onto plans.js when a bandwidth column lands.
const BANDWIDTH_GB = {
  hobby: 100, starter: 100, pro: 500, proplus: 1000, scale: 2000,
  "db-hobby": 50, "db-starter": 100, "db-pro": 250, "db-scale": 500,
};

export function rollupCompute(orgId, start, end) {
  return db.prepare(`
    SELECT coolify_uuid, plan_id,
           SUM(interval_sec) / 3600.0                        AS compute_hours,
           SUM(interval_sec / 3600.0 * price_pence_per_hour) AS pence
    FROM usage_events
    WHERE org_id = ? AND sampled_at >= ? AND sampled_at < ?
    GROUP BY coolify_uuid, plan_id
    ORDER BY coolify_uuid
  `).all(orgId, start, end);
}

// [start, end) for a YYYY-MM period. end = first day of the next month.
function periodBounds(period) {
  const [y, m] = String(period).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// Live hours of a resource within [start,end), from its created_at (clamped).
function resourceHoursInPeriod(createdAt, startMs, endMs, nowMs) {
  const born = createdAt ? Date.parse(createdAt) : startMs;
  const from = Math.max(born, startMs);
  const to = Math.min(endMs, nowMs);
  return from >= to ? 0 : (to - from) / 3_600_000;
}

// The Render-style per-org summary. Zero-usage ⇒ { lines: [], totalPence: 0 }.
export function usageSummary(orgId, period, name = null) {
  const { start, end } = periodBounds(period);
  const startMs = Date.parse(start), endMs = Date.parse(end), nowMs = Date.now();
  const lines = [];

  // Compute lines from metered uptime.
  for (const c of rollupCompute(orgId, start, end)) {
    lines.push({
      type: "compute",
      uuid: c.coolify_uuid,
      plan: c.plan_id,
      computeHours: +c.compute_hours.toFixed(2),
      pence: Math.round(c.pence),
    });
  }

  // Allocated-disk + bandwidth lines from currently-owned+planned resources.
  const owned = db.prepare(
    "SELECT coolify_uuid, type, plan_id, created_at FROM resource_ownership " +
      "WHERE org_id = ? AND plan_id IS NOT NULL"
  ).all(orgId);
  for (const r of owned) {
    const hours = resourceHoursInPeriod(r.created_at, startMs, endMs, nowMs);
    const gb = planStorageGb(r.plan_id);
    const diskPence = Math.round(gb * hours * DISK_PENCE_PER_GB_HOUR);
    if (gb > 0) {
      lines.push({ type: "disk", uuid: r.coolify_uuid, plan: r.plan_id, allocatedGb: gb, hours: +hours.toFixed(2), pence: diskPence });
    }
    lines.push({
      type: "bandwidth", uuid: r.coolify_uuid, plan: r.plan_id,
      allowanceGb: BANDWIDTH_GB[r.plan_id] ?? 0, usedGb: 0, pence: 0, // ponytail: bandwidth metering not implemented — flat allowance per plan.
    });
  }

  const totalPence = lines.reduce((sum, l) => sum + l.pence, 0);
  return { period, currency: "GBP", name, lines, totalPence };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_metering.mjs`
Expected: PASS (8 tests). (The zero-usage org owns nothing with a plan, so `owned` is empty and `lines` is `[]`.)

- [ ] **Step 5: Commit**

```bash
git add server/metering.js server/test_metering.mjs
git commit -m "feat(metering): rollup + Render-style GBP summary (compute + allocated disk + bandwidth)"
```

---

### Task 5: Extend the monitor tick to write usage events

**Files:**
- Modify: `server/index.js` (the health-monitor `setInterval` at `~line 1410`)

**Interfaces:**
- Consumes: `coolify.listServices`, `coolify.listDatabases`, `meterResources` (Task 3).
- Produces: after each health snapshot, one `meterResources(...)` call over the combined application + database list; best-effort, never throws out of the tick.

- [ ] **Step 1: Import the metering core in `server/index.js`**

Add near the other `./` imports at the top:

```javascript
import { meterResources } from "./metering.js";
```

- [ ] **Step 2: Meter running resources inside the existing tick**

The tick already computes a health snapshot from `listServices()`. Extend it to also fetch databases and meter both. Replace the body of the `try` block inside the `setInterval` (the part after `runHealthCheck({...})` resolves) so that, after `healthSnapshot = snapshot;`, it meters:

```javascript
      healthSnapshot = snapshot;

      // --- usage metering (best-effort; must never crash the health monitor) ---
      // ponytail: metering INSERT is best-effort inside the health tick; a failed
      // write skips one sample, never throws. Compute-only (uptime); disk/bandwidth
      // are plan-derived at rollup, not sampled here.
      try {
        const [apps, dbs] = await Promise.all([
          coolify.listServices(),
          coolify.listDatabases(),
        ]);
        const resources = [
          ...apps.map((a) => ({ uuid: a.uuid, type: "application", status: a.status })),
          ...dbs.map((d) => ({ uuid: d.uuid, type: "database", status: d.status })),
        ];
        meterResources(resources, new Date().toISOString(), 60);
      } catch (meterErr) {
        console.error("usage metering:", meterErr.message);
      }
```

Note: `listServices` is called twice per tick now (once by `runHealthCheck`, once here). That's one extra Coolify call per minute — acceptable, and it keeps `runHealthCheck` unchanged. `// ponytail:` a shared fetch is a micro-optimisation; wire it only if the Coolify call cost shows up.

- [ ] **Step 3: Boot check**

Run: `node --check server/index.js`
Expected: no syntax errors.

- [ ] **Step 4: Verify the metering core still passes (no regression)**

Run: `node --test server/test_metering.mjs`
Expected: PASS (the tick reuses the same tested `meterResources`; nothing new to test at the interval level — the interval is `NODE_ENV !== 'test'`-gated and untestable directly, which is why the core is factored out and unit-tested).

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(metering): meter running apps + databases inside the health tick (best-effort)"
```

---

### Task 6: Usage API routes (`/api/org/usage`, `/current`, admin)

**Files:**
- Modify: `server/index.js` (add three routes)
- Test: `server/test_usage_api.mjs` (new — guard rules + summary shape the routes rely on)

**Interfaces:**
- Consumes: `usageSummary` (Task 4); `attachOrgContext`, `requireCapability`, `requireAdmin`, `h`, `getOrgDetail` (existing).
- Produces routes:
  - `GET /api/org/usage?period=YYYY-MM` (read; any member) → `usageSummary` for the caller's org. Defaults `period` to the current month if absent.
  - `GET /api/org/usage/current` (read) → month-to-date convenience (current month).
  - `GET /api/admin/orgs/:id/usage?period=YYYY-MM` (`requireAdmin`) → any org's summary; **404 if the org does not exist** (non-disclosure — same rule as cross-org access; a non-admin never reaches this route, and a member's own-org read is scoped to `req.org.id`, so cross-org reads are structurally impossible).

- [ ] **Step 1: Write the failing route-contract test**

Create `server/test_usage_api.mjs` — the interval is untestable in-process (demo/test gated), so assert the summary contract + the isolation rule the routes enforce, against the tested helpers directly.

```javascript
// Usage API contract + isolation. Run: node --test server/test_usage_api.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser, ensureUserOrg, getOrgDetail } from "./db.js";
import { usageSummary } from "./metering.js";

test("a member's usage read is scoped to their own org_id", () => {
  const a = createUser({ email: "ua@x.com", role: "customer" });
  const b = createUser({ email: "ub@x.com", role: "customer" });
  const orgA = ensureUserOrg(a.id);
  const orgB = ensureUserOrg(b.id);
  // The route computes usageSummary(req.org.id, …). Org A's summary never reads org B.
  assert.notEqual(orgA, orgB);
  assert.equal(usageSummary(orgA, "2026-07").totalPence, 0);
});

test("admin usage of a missing org is a 404 (getOrgDetail returns undefined)", () => {
  // The admin route guards on getOrgDetail before calling usageSummary.
  assert.equal(getOrgDetail(999999), undefined); // → route throws 404
});

test("current-month default resolves to a valid YYYY-MM period", () => {
  const period = new Date().toISOString().slice(0, 7); // the route's default
  assert.match(period, /^\d{4}-\d{2}$/);
  const u = createUser({ email: "cur@x.com", role: "customer" });
  const orgId = ensureUserOrg(u.id);
  assert.equal(usageSummary(orgId, period).period, period);
});
```

- [ ] **Step 2: Run to verify it passes as a spec of the guards**

Run: `node --test server/test_usage_api.mjs`
Expected: PASS (these assert the helper behaviour the routes wrap).

- [ ] **Step 3: Add the routes to `server/index.js`**

Import `usageSummary` (extend the metering import from Task 5):

```javascript
import { meterResources, usageSummary } from "./metering.js";
```

Add near the other `/api/org/*` routes (subsystem A's group):

```javascript
// --- usage metering (read-only; produced by the health tick) ---
const currentPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM

app.get("/api/org/usage", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => {
    // Admin has no single org; a targeted org must go through the admin route.
    if (req.user.role === "admin") {
      throw Object.assign(new Error("Use /api/admin/orgs/:id/usage"), { status: 400 });
    }
    const period = /^\d{4}-\d{2}$/.test(req.query.period) ? req.query.period : currentPeriod();
    return usageSummary(req.org.id, period);
  })
);

app.get("/api/org/usage/current", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => {
    if (req.user.role === "admin") {
      throw Object.assign(new Error("Use /api/admin/orgs/:id/usage"), { status: 400 });
    }
    return usageSummary(req.org.id, currentPeriod());
  })
);

app.get("/api/admin/orgs/:id/usage", requireAuth, requireAdmin, h((req) => {
  const detail = getOrgDetail(Number(req.params.id));
  if (!detail) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const period = /^\d{4}-\d{2}$/.test(req.query.period) ? req.query.period : currentPeriod();
  return usageSummary(Number(req.params.id), period, detail.org.name);
}));
```

- [ ] **Step 4: Boot check + tests**

Run: `node --check server/index.js && node --test server/test_usage_api.mjs`
Expected: no syntax errors; test PASS.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/test_usage_api.mjs
git commit -m "feat(api): usage summary routes (org read + admin per-org)"
```

---

### Task 7: Client — Usage page, API methods, nav, admin Usage tab

**Files:**
- Modify: `client/src/lib/api.js`
- Create: `client/src/pages/Usage.jsx`
- Modify: `client/src/App.jsx` (route + nav)
- Modify: `client/src/pages/Clients.jsx` (admin org Usage — subsystem A's page)

**Interfaces:**
- Consumes: `/api/org/usage`, `/api/admin/orgs/:id/usage`.
- Produces: `api.usage`, `api.usageCurrent`, `api.adminOrgUsage`; a Usage page (any member), a nav entry, and an admin per-org Usage view.

- [ ] **Step 1: Add API methods**

In `client/src/lib/api.js`, add before the closing `};` of `export const api`:

```javascript
  // Usage metering
  usage: (period) => req(`/org/usage${period ? `?period=${period}` : ""}`),
  usageCurrent: () => req("/org/usage/current"),
  adminOrgUsage: (id, period) => req(`/admin/orgs/${id}/usage${period ? `?period=${period}` : ""}`),
```

- [ ] **Step 2: Create the Usage page**

Create `client/src/pages/Usage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, EmptyState } from "../components/ui.jsx";

const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function Usage() {
  const [period, setPeriod] = useState(thisMonth());
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSummary(null);
    api.usage(period).then(setSummary).catch(setError);
  }, [period]);

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!summary) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  const compute = summary.lines.filter((l) => l.type === "compute");
  const disk = summary.lines.filter((l) => l.type === "disk");
  const bandwidth = summary.lines.filter((l) => l.type === "bandwidth");

  return (
    <div className="page">
      <PageHeader title="Usage" subtitle="Metered compute, allocated storage, and bandwidth for this period." />
      <div className="flex items-center gap-2 mb-4">
        <input type="month" className="input" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <div className="ml-auto text-sm" style={{ color: "var(--text-muted)" }}>
          Period total: <span className="font-semibold" style={{ color: "var(--text)" }}>{gbp(summary.totalPence)}</span>
        </div>
      </div>

      {summary.lines.length === 0 && (
        <EmptyState title="No usage yet" description="Assign a plan to a service or database to start metering. Free until assigned." />
      )}

      {summary.lines.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th className="px-4 py-3 font-semibold">Resource</th>
              <th className="px-4 py-3 font-semibold">Plan</th>
              <th className="px-4 py-3 font-semibold">Dimension</th>
              <th className="px-4 py-3 font-semibold">Usage</th>
              <th className="px-4 py-3 font-semibold">Cost</th>
            </tr></thead>
            <tbody>
              {compute.map((l, i) => (
                <tr key={`c${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 mono" style={{ color: "var(--text)" }}>{l.uuid}</td>
                  <td className="px-4 py-3">{l.plan}</td>
                  <td className="px-4 py-3">Compute</td>
                  <td className="px-4 py-3">{l.computeHours} hrs</td>
                  <td className="px-4 py-3">{gbp(l.pence)}</td>
                </tr>
              ))}
              {disk.map((l, i) => (
                <tr key={`d${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 mono" style={{ color: "var(--text)" }}>{l.uuid}</td>
                  <td className="px-4 py-3">{l.plan}</td>
                  <td className="px-4 py-3">Disk (allocated)</td>
                  <td className="px-4 py-3">{l.allocatedGb} GB · {l.hours} hrs</td>
                  <td className="px-4 py-3">{gbp(l.pence)}</td>
                </tr>
              ))}
              {bandwidth.map((l, i) => (
                <tr key={`b${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 mono" style={{ color: "var(--text)" }}>{l.uuid}</td>
                  <td className="px-4 py-3">{l.plan}</td>
                  <td className="px-4 py-3">Bandwidth</td>
                  <td className="px-4 py-3">{l.usedGb} of {l.allowanceGb} GB allowance</td>
                  <td className="px-4 py-3">{gbp(l.pence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
```

Note: reuse existing UI classes (`input`, `page`, `mono`, `PageHeader`, `Card`, `Spinner`, `EmptyState`) exactly as subsystem A's `Team.jsx` does. `<input type="month">` is the native platform month picker — no date library.

- [ ] **Step 3: Wire the route + nav in `client/src/App.jsx`**

Add the import:

```jsx
import Usage from "./pages/Usage.jsx";
```

Add a Usage nav link visible to **any** member (place it alongside the resource views, e.g. after the Team link, using the `Gauge` icon):

```jsx
        {user?.orgRole && (
          <HoverNavLink to="/usage"><Gauge size={18} /><span>Usage</span></HoverNavLink>
        )}
```

Import `Gauge` from `lucide-react` if not already imported. Add the route in the authed `<Routes>` block:

```jsx
            <Route path="/usage" element={<Usage />} />
```

Add `"/usage": "Usage"` to the page-title map.

- [ ] **Step 4: Add the admin per-org Usage view to `client/src/pages/Clients.jsx`**

In the Clients page, when an org row is expanded/selected, fetch and show its usage total. Minimal addition — a "Usage" cell/link per row that calls `api.adminOrgUsage(o.id)` and shows the period total. Add to the row (a new column or an expand handler):

```jsx
// In the <thead> row, add:
<th className="px-4 py-3 font-semibold">Usage (mo)</th>
// In each org <tr>, add a cell that lazy-loads the total on mount:
<td className="px-4 py-3"><OrgUsageCell id={o.id} /></td>
```

And define the small cell component at the bottom of `Clients.jsx`:

```jsx
function OrgUsageCell({ id }) {
  const [pence, setPence] = useState(null);
  useEffect(() => { api.adminOrgUsage(id).then((s) => setPence(s.totalPence)).catch(() => setPence(0)); }, [id]);
  return <span style={{ color: "var(--text-muted)" }}>{pence == null ? "…" : `£${(pence / 100).toFixed(2)}`}</span>;
}
```

Ensure `useEffect`/`useState` are imported in `Clients.jsx` (subsystem A already imports them).

- [ ] **Step 5: Build the client to verify it compiles**

Run: `npm run build`
Expected: Vite build succeeds with no unresolved imports.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/api.js client/src/pages/Usage.jsx client/src/App.jsx client/src/pages/Clients.jsx
git commit -m "feat(ui): Usage page + nav + admin per-org usage total"
```

---

### Task 8: Full regression + spec-parity check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server test suite**

Run: `node --test server/`
Expected: all `test_*.mjs` PASS, including `test_metering_migration.mjs`, `test_metering.mjs`, `test_usage_api.mjs`, and the pre-existing subsystem A suites (`test_isolation.mjs`, `test_orgs.mjs`, `test_rbac.mjs`, `test_org_api.mjs`).

- [ ] **Step 2: Manual smoke (demo mode)**

Run: `npm run dev`, sign in (demo = admin). Confirm `/usage` renders the £0 empty-state for a demo org (the tick is off in demo, so no rows) and does **not** error. Confirm the Clients page shows a `£0.00` usage cell per org.

- [ ] **Step 3: Confirm live metering seam (read-only inspection)**

Confirm the health tick at `server/index.js` now calls `meterResources(...)` after the health snapshot and is wrapped in its own `try/catch`. No live Coolify run required for the plan — the metering core is unit-tested.

- [ ] **Step 4: Commit any fixups, then finish the branch**

Use `superpowers:finishing-a-development-branch` to decide merge/PR.

---

## Self-Review

**Spec coverage (against "Decisions resolved" — the authoritative block):**
- **One migration, `usage_events` only (migration 12)** → Task 1. ✓ No `usage_samples`, no migration 13, no `service_plans` (plan home is C's `resource_ownership.plan_id`). ✓
- **Compute metered by actual uptime via the existing monitor tick** → Tasks 3, 5. Stopped resource accrues £0 (skipped by `status !== 'running'`). ✓
- **Denormalised `price_pence_per_hour`; mid-period plan change bills each segment at its frozen rate** → Task 1 (column), Task 3 (write freezes rate), Task 4 (rollup groups by `plan_id`, test asserts two-segment reprice). ✓
- **Allocated disk (no host-SSH sampler)** → Task 4: disk line = `plan_storage_gb × resource_hours × disk_rate`, `resource_hours` from `resource_ownership.created_at`. No `du`/`pg_database_size`, no SSH. ✓
- **Bandwidth = flat per-plan allowance, £0 line** → Task 4 (`BANDWIDTH_GB` table, `pence:0`). ✓
- **GBP integer pence; `Math.round` at the plans.js boundary; reuse C's rate helper** → Task 2 (`planRatePencePerHour` calls C's `usdToPence`; `Math.round` in the rate + at every summary line). No floats reach the DB (only `sampled_at`/`interval_sec`/`price_pence_per_hour` integers are stored; hours are computed at query time). ✓
- **Reads `resource_ownership.plan_id`; does NOT build plan assignment** → Task 3 (`ownedPlan` reads `plan_id`); assignment is explicitly C's (stated in Global Constraints). ✓
- **Zero-usage org → £0 summary, not error** → Task 4 (returns `{ lines: [], totalPence: 0 }`), Task 6 (route), Task 7 (empty-state), tests in Tasks 4 & 6. ✓
- **Cross-org usage read → 404** → Task 6: member reads are scoped to `req.org.id` (cross-org structurally impossible); admin route 404s on missing org via `getOrgDetail`. ✓
- **Orphan / no-plan / stopped write no row** → Task 3 (`meterResources` skips all three; explicit test). ✓
- **Best-effort metering inside the health tick (never crashes the monitor)** → Task 5 (own `try/catch`, `// ponytail:`). ✓
- **API surface: `GET /api/org/usage`, `/current`, `GET /api/admin/orgs/:id/usage`** → Task 6. ✓
- **UI: Usage page + nav (any member) + admin per-org usage** → Task 7. ✓

**Dependency on C stated:** Global Constraints declare C ships first, owns migration 11 (`resource_ownership.plan_id`) and `server/billing.js`'s `usdToPence`; B reads `plan_id` and imports `usdToPence`. The "if B ships before C" fallback (self-add `plan_id`) is noted but not the planned path. ✓

**Type consistency:** `planById`, `planRatePencePerHour`, `planStorageGb`, `ownedPlan`, `insertUsageEvent`, `meterResources`, `rollupCompute`, `usageSummary` are each defined once in `server/metering.js` and referenced with consistent names/signatures across Tasks 2–7. `meterResources(resources, sampledAt, intervalSec)` and `usageSummary(orgId, period, name?)` signatures are stable. The summary contract (`{ period, currency, name, lines[], totalPence }`, line `{ type, uuid, plan, …, pence }`) is fixed in Task 4 and consumed unchanged by Tasks 6–7 — this is the contract subsystem C draws against.

**Placeholder scan:** No TBD/TODO; every code step is complete and runnable. `// ponytail:` markers (rate rounding, flat disk rate, flat bandwidth table, best-effort tick, double `listServices` fetch) are deliberate convention, not placeholders.
