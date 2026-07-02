# Usage Metering — Design Spec

**Date:** 2026-07-02
**Status:** Draft (design), pending review
**Subsystem:** B of 3 (Org/Team RBAC · **Usage Metering** · Billing Engine)

> **Controller reconciliation (B↔C cross-cutting), 2026-07-02.** B and C were designed in parallel and independently introduced a per-resource plan and a "migration 11". Reconciled for the build:
> - **Plan home is `resource_ownership.plan_id`** (added by C's migration 11). B **reads** it; the `service_plans` table proposed below is **dropped** — wherever this spec says `service_plans`, read `resource_ownership.plan_id`.
> - **Migrations are serialized:** C = `user_version` 11 (billing + `plan_id`); **B = 12 (`usage_events`) and 13 (`usage_samples`)**. Wherever this spec says "migration 11/12", read "12/13".
> - Net effect: B depends on C's migration 11 for the `plan_id` column; if B ever ships before C, B's first migration must add `resource_ownership.plan_id` itself.

## Context

DebutDeploy is a Render-style control panel proxying Coolify on Hetzner. Subsystem A (org & team model) has **shipped**: `organizations`, `memberships` (one-org-per-user), `org_invites`, and `resource_ownership.org_id` all live at `user_version` 10 in `server/db.js`. **The org is the billing entity** — `resource_ownership.org_id` is the attribution key for every metered resource.

This spec covers **only** metering: turning live Coolify resource state into per-org **usage** rows and per-org **cost** numbers. It produces the numbers; it does not spend them. The wallet, Stripe, credit draw-down, and invoicing are subsystem C — B is upstream of C and independently shippable: with B alone, a Master Admin can see "org X accrued £12.40 of compute this month" even though nothing charges for it yet.

The metering signal is grounded in what Coolify/the host actually expose (research below). Where a signal is not obtainable, the spec uses the stated fallback and does **not** invent data.

### Decisions locked (from research + Subsystem A)

- **Org-attributed.** Every usage row carries `org_id`, resolved from `resource_ownership`. Resources with no ownership row (orphans) are **skipped**, never inserted with a null org — Subsystem A already flags orphan reconciliation as a known gap and forward-points it here.
- **Sampling, not eventing.** Metering is time-series uptime/size sampling (the model Render uses internally), not start/stop event pairs. A resource "was running at instant T for `interval_sec` seconds" is one row.
- **Reuse the existing monitor tick.** `server/index.js:1410-1446` already runs a 60-second `setInterval` (live-only, `!demoMode && NODE_ENV !== 'test'`, with a reentrancy guard) that calls `coolify.listServices()` and has running/stopped state for every application. This is the metering hook — no net-new ticker for compute.
- **Conservative accrual.** The tick's reentrancy guard skips a slow tick rather than doubling it, so we slightly **under**-accrue on missed ticks — never over-bill. Acceptable and safe direction.
- **Plan rate is derived, not stored in plans.js.** `server/plans.js` has `priceMo` only. Hourly rate = `priceMo / 730.5` (730.5 = 365.25/12 × 24 hrs/mo). No per-hour field is added to plans.js.
- **Currency is GBP for billing output**, per the task. `plans.js` prices are authored in USD (`priceMo`). See **Decisions needed from you** — the USD→GBP path is a real open question, not a guess.

## Goals

1. Meter **compute-hours** (running uptime × plan) for applications and databases.
2. Meter **disk GB-hours** for applications-with-volumes and databases, sampled from the host.
3. Provide a **bandwidth** column from day one, populated with `0` under an explicit flat-allowance fallback (per-org egress is **not** reliably obtainable — see below).
4. Aggregate samples into per-org, per-period **cost numbers in GBP** using `plans.js` rates.
5. Expose a **Render-style per-org usage summary** (line items + total) via API, consumed by the panel and later by subsystem C.
6. Stay independently shippable — B writes usage + cost; it never debits a wallet.

## Non-goals (explicit)

- **Wallet / Stripe / credit draw-down / invoicing** — subsystem C. B only *produces* usage + cost.
- **Per-container actual CPU/memory billing.** `getContainerStats` via SSH (`server/hostexec.js`) returns real percentages but costs a 1-3s SSH round-trip per call and depends on `MIGRATION_SSH_HOST` being configured. Flat plan-rate billing only; actual-consumption metering is a much harder problem (variable per-tick cost, SSH reliability) and is out of scope. `// ponytail:` seam noted at the tick.
- **Per-org bandwidth billing.** Not obtainable (below); flat per-plan allowance instead.
- **Coolify `/servers/{uuid}/resources` percentages.** `server/resources.js` documents that Coolify v4.1.2 returns a container-list array, not usage percents — all fields come back null. This endpoint is **not** used as a metering signal.
- A rollup/materialized-aggregate table beyond the single monthly rollup defined here — aggregate at query time until a query profile demands more.

## Signal inventory (what is / isn't obtainable)

| Dimension | Source | Obtainable | Mechanism |
|-----------|--------|:----------:|-----------|
| Compute (uptime) | `coolify.listServices()` / `listDatabases()` compound status → `running` | **yes** | Already in the monitor tick; one write per running resource per minute |
| Disk bytes (DB, shared cluster) | `pg_database_size('<db>')` via superuser URL in `app_settings` | **yes** | `getSetting('shared_cluster_url')` + one SQL call |
| Disk bytes (DB, standalone) | `docker exec <container> psql -c 'SELECT pg_database_size(current_database())'` via `hostexec.runOnHost` | **yes** | SSH; container name derived from Coolify uuid |
| Disk bytes (app volumes) | `du -sb <mountpoint>` where mountpoint from `docker volume inspect` via `runOnHost` | **partial** | Coolify's `local_persistent_volumes` gives mount_path but **no size**; size needs host `du` |
| Bandwidth (egress) | `docker stats {{.NetIO}}` | **no (reliably)** | Counter resets to 0 on every container restart; TX/RX combined; not Hetzner-level. **Flat allowance fallback.** |
| CPU/mem % | Coolify `/servers/{uuid}/resources` | **no** | Returns container array, all percents null |
| CPU/mem % (real) | `getContainerStats` SSH | yes but **out of scope** | On-demand stats display only, not a metering tick |

**Bandwidth fallback (locked):** per-plan monthly GB allowance; overage is not billed until a reliable per-org egress signal exists. The `bandwidth_bytes` column exists from day one (value stays 0) so the billing engine treats all dimensions uniformly. A `// ponytail: bandwidth metering not implemented — flat allowance per plan; upgrade when docker-stats NetIO reset is solved or Hetzner adds per-container metrics` comment marks the sampling site.

## Data model

Two new migrations. **Migration 10 already shipped** (org model, in `server/db.js`), so the next `user_version` is **11**. The two metering concerns want two migrations; they cannot both be 11.

**Ordering (flag):** the compute path and the storage path are separable, but they share `service_plans` (compute needs it for the rate; storage needs a plan for the disk allowance and for the same rollup join). Ship them as:

- **Migration 11 — `service_plans` + `usage_events`** (compute; the plan table is the prerequisite for everything downstream).
- **Migration 12 — `usage_samples`** (disk + bandwidth sampling).

If storage slips, 11 ships alone and B still bills compute. Migrations are forward-only and append to the `MIGRATIONS` array in `server/db.js` (same pattern as 1-10); the array index *is* the version.

### Migration 11 — `service_plans` + `usage_events`

```sql
-- Which plan each resource is on. The prerequisite: no plan → no metering row.
CREATE TABLE service_plans (
  type         TEXT NOT NULL CHECK(type IN ('application','database','service')),
  coolify_uuid TEXT NOT NULL,
  plan_id      TEXT NOT NULL,                 -- 'pro', 'db-starter', … (string from plans.js; not FK'd — plans.js is a static file)
  set_at       TEXT NOT NULL,
  PRIMARY KEY (type, coolify_uuid)            -- mirrors resource_ownership's PK shape
);

-- One row per running resource per tick. "This resource was running at sampled_at
-- for interval_sec seconds, on this plan, at this rate."
CREATE TABLE usage_events (
  id                    INTEGER PRIMARY KEY,
  org_id                INTEGER NOT NULL REFERENCES organizations(id),
  coolify_uuid          TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK(type IN ('application','database','service')),
  plan_id               TEXT NOT NULL,
  price_pence_per_hour  INTEGER NOT NULL,     -- denormalised GBP rate at write time (historical accuracy; see note)
  sampled_at            TEXT NOT NULL,
  interval_sec          INTEGER NOT NULL DEFAULT 60
);
CREATE INDEX idx_usage_events_org_period ON usage_events(org_id, sampled_at);
```

Notes:
- **`price_pence_per_hour` is denormalised at INSERT time**, not derived at query time. This resolves an open question from research: if a plan's price changes mid-month, query-time derivation retroactively reprices old events — wrong. Storing the rate on the row freezes history. It also survives a `plan_id` being removed from `plans.js` (rollup still works; no query-time rate lookup that could fail). `// ponytail: pence-integer, no sub-penny; fine at £/hr rates ~0.5-8.5p.`
- **`service_plans` has no FK to a catalog table** because the catalog is a static JS file (`server/plans.js`). The `plan_id` string is stored as-is; it need only resolve *at write time* to compute the rate. This is a deliberate, documented brittleness ceiling.
- No `UNIQUE` on `usage_events` — duplicate suppression is the tick's reentrancy guard, not the schema.

### Migration 12 — `usage_samples` (disk + bandwidth)

```sql
CREATE TABLE usage_samples (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  coolify_uuid  TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('application','database')),
  dimension     TEXT NOT NULL CHECK(dimension IN ('disk_bytes','bandwidth_bytes')),
  value_bytes   INTEGER NOT NULL DEFAULT 0,
  interval_sec  INTEGER NOT NULL DEFAULT 900,  -- disk tick is slower than compute (host du/pg cost)
  sampled_at    TEXT NOT NULL
);
CREATE INDEX idx_usage_samples_org_period ON usage_samples(org_id, sampled_at);
```

Notes:
- `bandwidth_bytes` rows are **not written** at launch (flat-allowance fallback) — the enum value exists so the billing engine and UI code path handles both dimensions uniformly the day a real signal lands.
- Disk sampling runs at a **slower cadence** than compute (proposed 900s / 15 min) because each sample is a host `du -sb` or `pg_database_size()` call. `interval_sec` is stored per-row so GB-hours math doesn't hard-code the cadence.
- Same org-attribution rule: skip resources with no `resource_ownership.org_id`.

## Sampling & aggregation

### Compute tick (reuse the monitor, migration 11)

Extend the existing tick at `server/index.js:1410-1446`. After `healthSnapshot = snapshot`, iterate the current resource list; for every resource where `status === 'running'` **and** a `service_plans` row exists **and** a `resource_ownership.org_id` is present, INSERT one `usage_events` row. One SQLite write per running resource per minute (~52k rows/mo at 100 services — fine in WAL mode).

- **Databases:** the monitor currently polls only `listServices()` (applications). Add a `coolify.listDatabases()` call in the same tick and apply the same INSERT for running databases. (See **Decisions needed** on same-tick vs separate ticker.)
- **Rate lookup at write time:** resolve `plan_id` → `priceMo` in `plans.js`, compute `price_pence_per_hour = round(priceMo_gbp / 730.5 * 100)`, store it on the row.
- **Guard:** the tick is `!demoMode && NODE_ENV !== 'test'`, so **no usage rows exist in demo/test**. Every consumer must render £0 for a zero-usage org, not error (see Risks).
- The INSERT is wrapped so a metering failure logs and skips — it must never crash the health monitor (which also drives outage notifications). `// ponytail: metering INSERT is best-effort inside the health tick; a failed write skips one sample, never throws.`

### Disk sampling tick (net-new, migration 12)

Research confirmed **no existing disk/bandwidth tick** — this is net-new. A second `setInterval` (same live-only gating), cadence 900s, non-fatal per resource:

- **App volumes:** `coolifydb.listServiceVolumes(uuid)` → for each volume, `runOnHost("docker volume inspect <name> --format '{{.Mountpoint}}'")` → `runOnHost("du -sb <mountpoint>")`.
- **Standalone DB:** `runOnHost("docker exec <container> psql -tAc 'SELECT pg_database_size(current_database())'")`.
- **Shared-cluster DB:** superuser URL from `getSetting('shared_cluster_url')` → `SELECT pg_database_size('<db_name>')` per logical DB. **Skip gracefully if the URL is null** (no org has provisioned the cluster yet) — do not error.
- Stagger per-resource host calls (short sleep between) so repeated `du` doesn't spike host disk I/O.

Every disk path depends on `hostexec.runOnHost` (SSH). If SSH is misconfigured the tick logs and skips; metering degrades, the server does not crash. `// ponytail: disk sampling is best-effort over SSH; a down host means gaps in disk_bytes, not an outage.` Coolify-internal-schema dependency (`local_persistent_volumes`) is inherited brittleness — a Coolify upgrade renaming the table breaks disk metering silently; already flagged "VERIFY LIVE" in `coolifydb.js`.

### Plan assignment (prerequisite)

Metering rows are only written when `service_plans` has a row. Assignment happens where ownership is already assigned:
- **At create time:** the create-service / create-database flow in `server/index.js` already calls `ownership.assign()`; add a `service_plans` INSERT alongside it.
- **On demand:** `PATCH /api/services/:id/plan` and `PATCH /api/databases/:id/plan`, `manage`-capability (per Subsystem A's ladder — plan changes have billing impact; `manage`, not `deploy`).

## Cost mapping (usage → GBP)

Rollup for a billing period `[start, end)`:

**Compute (migration 11):**
```sql
SELECT coolify_uuid, plan_id,
       SUM(interval_sec) / 3600.0                        AS compute_hours,
       SUM(interval_sec / 3600.0 * price_pence_per_hour) AS pence
FROM usage_events
WHERE org_id = ? AND sampled_at >= ? AND sampled_at < ?
GROUP BY coolify_uuid, plan_id;
```
Cost per line = `SUM(interval_sec/3600 × price_pence_per_hour)` — the rate is already per-row (frozen at write time), so mid-month plan changes bill correctly across the split.

**Disk (migration 12):** GB-hours = `SUM(value_bytes/1e9 × interval_sec/3600)` per resource; multiply by the plan's disk £/GB-hr. Same shape as compute (bytes-time instead of run-time).

- **Allocated vs actual disk:** see **Decisions needed** — Render bills *allocated* size (from the plan's `disk`/`storage` field in `plans.js`), which avoids penalising efficient use and sidesteps the fragile `du` path entirely. This spec's disk sampling supports *actual*; whether to bill actual or allocated is a pricing decision, not a data decision.
- **Bandwidth:** £0 line (flat allowance); shown in the summary as "X GB of Y GB allowance", overage un-billed.

Accuracy: 60s compute sampling → ±1 min granularity (a 47-min run bills 46-48 min). Standard for usage metering (AWS bills EC2 by the second, Render by the hour; we sit between). Conservative miss-on-slow-tick means slight under-accrual, never over-bill.

## API surface (new)

All under the existing org context (`req.org` from Subsystem A's `attachOrgContext`); Master Admin bypass unchanged.

- `GET /api/org/usage?period=YYYY-MM` — **the Render-style summary** for the caller's org: line items (per resource: type, name, plan, compute-hours, disk GB-hours, bandwidth used/allowance, £ subtotal) + period total in GBP. `read` capability. Returns a well-formed £0 summary for a zero-usage org.
- `GET /api/org/usage/current` — month-to-date convenience (defaults `period` to the current month).
- `PATCH /api/services/:id/plan` — set/change a service's plan (`manage`; writes `service_plans`).
- `PATCH /api/databases/:id/plan` — same for databases (`manage`).
- `GET /api/admin/orgs/:id/usage?period=YYYY-MM` — Master Admin: any org's summary (extends Subsystem A's `/api/admin/orgs/:id`).

The summary payload is the contract subsystem C will draw against — C reads these numbers to debit a wallet; it does not recompute them.

## UI

- **Client — Usage** (new `client/src/pages/Usage.jsx`): current-period breakdown table (resource, plan, compute-hrs, disk GB-hrs, bandwidth-vs-allowance, £ subtotal) + period total, month selector. Visible to any member (`read`). Zero-usage org shows £0.00 and an empty-state, not an error.
- **Plan selector** on the service/database create + detail views (writes via the `PATCH …/plan` routes; `manage`-gated controls only).
- **Master Admin — org detail** (`client/src/pages/Clients.jsx` from Subsystem A): add a Usage tab reading `/api/admin/orgs/:id/usage`.
- Nav: "Usage" for all members alongside the resource views.

## Testing

Matching existing patterns (`server/test_isolation.mjs`, `test_orgs.mjs`, in-memory DB).

**`server/test_metering.mjs` — data layer:**
- A running resource with a `service_plans` row and an org-owned `resource_ownership` → one `usage_events` row per tick with the correct denormalised `price_pence_per_hour`.
- A **stopped** resource writes no row; a resource **without** a `service_plans` row writes no row.
- An **orphan** (no `resource_ownership.org_id`) is skipped — never inserted with a null org.
- Rollup: N ticks over a period sum to the expected compute-hours and pence; a **mid-period plan change** bills each segment at its own frozen rate (the reason `price_pence_per_hour` is per-row).
- Disk: `usage_samples` GB-hours math over known `value_bytes`/`interval_sec`; `bandwidth_bytes` rows sum to a £0 line.
- Shared-cluster URL null → disk tick skips, no throw.

**Route-level:**
- `GET /api/org/usage` for a zero-usage org returns a £0 summary (200), not an error.
- Cross-org: org A cannot read org B's usage (404, non-disclosure — same rule as Subsystem A).
- `PATCH …/plan` requires `manage`; `viewer`/`deployer` are refused.
- Master Admin reaches `/api/admin/orgs/:id/usage`.

## Build sequence (for the implementation plan)

1. **Migration 11** — `service_plans`, `usage_events` (with `price_pence_per_hour`), the index. Append to `MIGRATIONS` in `server/db.js` (→ `user_version` 11).
2. **Data helpers** in `db.js` — `setServicePlan`, `getServicePlan`, `insertUsageEvent`, `rollupUsageEvents(orgId, start, end)`; GBP-rate derivation from `plans.js`.
3. **`test_metering.mjs`** compute-layer tests (TDD): running/stopped/orphan/no-plan, rollup, mid-period reprice.
4. **Extend the monitor tick** (`server/index.js:1410`) — add `listDatabases()`, INSERT `usage_events` for running+planned+owned resources; best-effort/non-fatal wrapper.
5. **Plan assignment** — `service_plans` INSERT in the create flow; `PATCH …/plan` routes (`manage`).
6. **`GET /api/org/usage` + `/current`** — rollup → Render-style summary; £0 for zero-usage.
7. **Migration 12** — `usage_samples`; disk sampling tick (net-new `setInterval`, host-SSH best-effort); shared-cluster-null skip.
8. **Disk in the rollup + summary** — GB-hours line items; bandwidth as £0 allowance line.
9. **Admin** — `/api/admin/orgs/:id/usage`.
10. **Client** — Usage page, plan selectors, admin Usage tab, nav.
11. **Tests green** — `test_metering.mjs` (data + route) and existing suites pass.

Steps 1-6 are the independently shippable compute-only slice (migration 11 alone). Steps 7-8 (migration 12) add storage; 3+ can ship without them.

## Decisions resolved (2026-07-02) — these OVERRIDE the open items below

1. **Currency = USD→GBP FX conversion via a configurable rate.** `plans.js` numbers stay USD; convert with a rate stored in `app_settings` (key `usd_gbp_rate`, default `0.79` as a `// ponytail:` constant, operator-editable). All money math: `gbp_pence = Math.round(priceMo_usd * rate * 100)`, rate read once per rollup. **Shared with C — one rate, one source.**
2. **Free until assigned.** No `resource_ownership.plan_id` → £0, no `usage_events` rows written. Owner/manager assigns via `PATCH …/plan`. Existing resources stay free until set.
3. **Allocated disk, NOT sampled.** Disk is billed as the plan's storage figure (`plans.js` `disk`/`storage`) — a deterministic value, computed at rollup as `plan_storage_gb × resource_hours_in_period × disk_rate`, where `resource_hours` derives from `resource_ownership.created_at`. **The host-SSH disk sampler, the `usage_samples` table, and migration 13 are DROPPED.** B ships as **migration 12 (`usage_events`) only**; the disk line and the bandwidth allowance line are computed plan-derived values, no sampling.
4. **Bandwidth = flat per-plan allowance** (unchanged): a £0 informational line.

**Net effect:** B = one migration (12: `usage_events`), compute metered by actual uptime (a stopped resource accrues £0 compute — the utility part), disk+bandwidth as plan-derived computed lines. No `usage_samples`, no SSH disk path, no migration 13. The `du`/`pg_database_size` mechanism from the storage research is not built.

**Deferred modeling seam (decide when drawdown is wired, not now):** whether B's metered usage *replaces* C's flat monthly plan charge (pure utility) or *supplements* it (baseline + usage). For the MVP, C charges the monthly plan cost and B is the transparency meter; the utility-vs-fixed choice lands when the drawdown seam is wired.

## Decisions needed from you (superseded above; retained for context)

1. **USD → GBP.** `plans.js` prices are USD (`priceMo`). Billing output is specified in GBP. Fixed conversion constant, a configurable rate in `app_settings`, or re-author `plans.js` prices in GBP? All rate math (`priceMo/730.5`) and `price_pence_per_hour` depend on this. **Blocking for step 2.**
2. **Default plan on resource creation.** When a resource is created without an explicit plan: is there a **free tier** (no `service_plans` row → no metering → £0), or does every resource accrue from creation on a default plan (e.g. `hobby`)? This decides whether "no plan row" means "free" or "misconfigured".
3. **Allocated vs actual disk billing.** Bill the plan's allocated `disk`/`storage` (Render's model, simpler, skips the fragile host `du` path entirely) or actual `du -sb`/`pg_database_size` usage? Research notes Coolify volumes appear **uncapped** (no size column, no `--storage-opt`), so *if* we bill allocated we use the plan figure, not a Docker-enforced limit. Affects whether migration 12's disk tick is even needed at launch.
4. **Same-tick vs separate ticker for databases.** Add `listDatabases()` to the existing health monitor tick (simpler, one guard, but doubles the Coolify call in that tick), or run a separate metering ticker (cleaner isolation, more API calls)? Recommendation: same tick — one reentrancy guard, DB status is the same compound-status signal.
5. **Bandwidth allowance values.** The flat fallback needs a per-plan monthly GB allowance. `plans.js` has no `bandwidth_gb` field. What allowances per tier (e.g. Starter 100 GB, Pro 500 GB)? Needed to render the "X of Y GB" summary line; add the field to `plans.js`.
