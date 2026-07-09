# Fleet Monitoring & Remediation — Design

Date: 2026-07-08
Status: Approved (brainstorm) — pending implementation plan

## Problem

DebutDeploy proxies Coolify on a single Hetzner host running ~20 apps. Operators
have **no consolidated view** of host capacity or per-site resource usage, and no
in-panel way to react when something goes wrong. The 2026-07-08 incident (8–24h
"hung" deploys, root disk hitting 99%, Postgres ENOSPC crashes) was diagnosed and
fixed entirely by hand over SSH. This design turns that manual firefight into a
repeatable system: **see the whole box + every site, get alerted with a suggested
fix, and let a tiny high-confidence allow-list self-heal.**

Crucially, most of the backend already exists and is reused, not rebuilt.

## What already exists (reused, not rebuilt)

- **[server/metrics.js](../../../server/metrics.js)** — a health-tick sampler that
  records `docker stats` for every container (CPU, mem, net, block-IO, PIDs) into
  `metrics_samples`, and host capacity (RAM used/total, disk used/total of `/`, CPU
  load) into `host_samples`; serves 1h/6h/24h bucketed history per-service
  (`metricsHistory`) and host-wide (`hostHistory`); retention sweep included.
- **[server/hostexec.js](../../../server/hostexec.js)** — `runOnHost()` (SSH with a
  **pinned host key**), `getContainerStats()`, `getServiceLogs()`.
- **MCP ([mcp/server.js](../../../mcp/server.js))** — already exposes
  `control_service` (start/stop/restart), `update_service_resources`,
  `service_logs`, `list/get_service`, `service_deployments`, etc.
- **Notifications** page + subsystem, and an existing **admin/RBAC gate** on routes.

## Gaps this design fills

1. No **fleet/master overview** — host + all sites on one screen (`host_samples`
   exists but is never surfaced as an overview; the host sampler only measures `/`,
   not the new `/mnt/dockerdata` Docker volume).
2. No **per-site disk usage** — `docker stats` gives CPU/mem/net but not disk.
3. No **in-panel restart** button (capability exists in API/MCP, not surfaced).
4. No **situation detection**, suggested fixes, or bounded auto-remediation; and the
   MCP can't see host-level capacity or per-container disk.

## Architecture (Approach A — extend existing backend)

```
health tick ──▶ sampleAndStore()                  [metrics.js, extended]
                 ├─ sampleAllContainers()  (exists)
                 ├─ sampleContainerDisk()  (NEW, slower cadence)
                 └─ sampleHostCapacity()   (extended: root + /mnt/dockerdata)
             ──▶ evaluateSituations()               [situations.js, NEW]
                 ├─ rules over latest samples ▶ open/resolve `situations`
                 ├─ notify (reuse Notifications)
                 └─ autoRemediate() for high-confidence allow-list only

server/index.js  ▶ /api/fleet/overview, /api/situations,
                   /api/situations/:id/remediate   (admin-gated)
mcp/server.js    ▶ host_metrics, fleet_overview, container_disk,
                   list_situations, run_remediation
client/          ▶ Fleet dashboard page
```

Rejected alternatives: **B. host-side agent** (new deployable, duplicates the SSH
sampler); **C. Prometheus/Grafana/cAdvisor/Alertmanager** (4–5 new containers on an
already-constrained host, heavy, remediation still needs custom glue). Approach A is
the least new infrastructure and reuses proven code.

## Data model

Reuse `host_samples` and `metrics_samples`. Additions (all additive/idempotent DDL,
auto-migrated at boot per existing convention):

- `metrics_samples.disk_bytes` (INTEGER, nullable) — per-container total footprint
  (`SizeRootFs` from `docker ps -s`). Sampled on a **slower cadence** than CPU/mem
  because `docker ps -s` is expensive (walks layer sizes); most tick rows leave it
  null and the dashboard reads the most recent non-null.
- `host_samples.vol_used_bytes`, `host_samples.vol_total_bytes` (INTEGER, nullable)
  — the `/mnt/dockerdata` volume, alongside the existing root `/` disk columns.
- `situations` — `id`, `type`, `target` (`host` or a Coolify uuid), `severity`
  (`warn`|`crit`), `status` (`open`|`resolved`), `opened_at`, `resolved_at`,
  `detail` (JSON), `suggested_remediation` (registry key or null),
  `auto_applied_at` (nullable).
- `remediation_log` — `id`, `situation_id`, `action` (registry key), `actor`
  (`auto`|user id), `command`, `result`, `ok`, `at`. Full audit trail.

## Collection details

- **Per-site disk:** `docker ps -s --format '{{.Names}}|{{.Size}}'`; parse
  `"12.3MB (virtual 1.2GB)"` → writable + total (reuse `parseBytes`). Map names to
  owned uuids with the existing `mapNamesToUuids`. Run every Nth tick (config, default
  ~10 min).
- **Host volume:** extend `sampleHostCapacity()` to also emit
  `VOL_TOTAL=$(df -B1 --output=size /mnt/dockerdata | tail -1)` and `VOL_USED=...`
  (guarded so a host without the volume still samples cleanly).

## Phase 1 — Fleet dashboard + MCP read/restart (highest value)

- **`GET /api/fleet/overview`** → `{ host: { cpu, mem{used,total,pct},
  diskRoot{used,total,pct}, diskVolume{used,total,pct} }, sites: [{ uuid, name,
  status, health, cpu_pct, mem_bytes, mem_pct, disk_bytes }] }` from the latest
  samples joined to `resource_ownership`.
- **UI Fleet page:** host cards (RAM, CPU, **root disk + volume disk** as separate
  gauges), and a **sortable table** of sites (name, status/health, mem, CPU, disk)
  each with a **Restart** button (calls existing `control_service`). Live refresh on
  a short interval; reuses `client/lib/api.js` patterns.
- **MCP:** `host_metrics` (host capacity incl. volume), `fleet_overview` (the table),
  `container_disk` (per-uuid disk). Restart already exists via `control_service`.

Acceptance: dashboard shows host root+volume+RAM+CPU and a per-site table with disk;
restart button restarts a chosen app; `host_metrics`/`fleet_overview` return the same
data to Claude Code.

## Phase 2 — Situation detection + suggested fixes

- **`evaluateSituations()`** runs each tick over the latest samples + Coolify deploy
  state, opening/resolving `situations`. Initial rule set:
  - host root or volume disk `>85%` (warn) / `>92%` (crit)
  - host mem `>90%`
  - a container `down` / `unhealthy` / crash-looping (restart count climbing)
  - a deployment `in_progress` longer than `N` min (hung build — the 2026-07-08 case)
  - build queue piling (multiple `queued`/`in_progress` for one app)
- Opening a situation fires a **notification** (reuse Notifications) and attaches a
  `suggested_remediation` from the registry.
- **`GET /api/situations`** (open + recent history) and
  **`POST /api/situations/:id/remediate`** (apply the mapped remediation, human-
  approved). UI: a situations panel on the dashboard with severity, detail, and an
  **"Apply fix"** button. MCP: `list_situations`, `run_remediation`.

Acceptance: forcing a rule (e.g. simulated 95% disk sample) opens a situation, emits a
notification, and shows a suggested fix that applies when approved.

## Phase 3 — High-confidence auto-remediation (bounded allow-list)

- **Remediation registry:** each entry `{ key, title, situationType, command
  (template), confidence, auto (bool), cooldownSec }`. Only entries with
  `auto: true && confidence: 'high'` and idempotent/safe commands auto-run.
  Initial auto entries:
  - disk `>92%` → `docker image prune -af --filter until=48h && docker builder prune -f`
    (the exact cron-safe commands; **never** `--volumes` / `docker volume prune`).
  - (candidate, conservative) clear crash-loop → a single bounded `control_service
    restart`, once, then escalate to suggest-only.
- On tick, open situations whose remediation is `auto` execute automatically,
  **rate-limited to once per situation with a cooldown**, logged to
  `remediation_log`, and announced via notification ("auto-fixed X"). Everything else
  remains suggest-only.
- **Guardrails:** allow-listed command templates only (no arbitrary exec); global
  `AUTO_REMEDIATE` env kill-switch (default on, flip off to disable); per-situation
  cooldown; audit log; admin-only routes; MCP requires the same token.

Acceptance: with a stubbed situation, an `auto` remediation runs once, logs to
`remediation_log`, respects cooldown (won't re-run), and does nothing when
`AUTO_REMEDIATE=false`.

## Error handling & safety

- All host actions go through the existing pinned-key `runOnHost` (fails closed with
  no host-key pin). Remediation commands are fixed templates keyed by registry entry;
  user/agent input never interpolates into a shell command.
- New routes are **admin-gated** (existing RBAC); MCP tools require the existing token.
- Sampler additions are best-effort (wrapped, same as the current host-sample try/catch)
  so a slow `docker ps -s` never blocks the tick.
- DEMO mode: disk/volume/situation paths return synthesized/empty data like the
  existing `demoHistory`, so the dashboard renders without a live host.

## Testing

Follow the [metrics.js](../../../server/metrics.js) pattern — pure functions unit-
tested with injected data, no SSH:
- disk-size line parser (`"12.3MB (virtual 1.2GB)"` → bytes)
- `sampleHostCapacity` parser extended for volume fields
- `evaluateSituations(samples, deploys)` → expected open/resolved situations
- remediation selection + auto/cooldown gating logic
- route smoke tests using the existing `.mjs` test harness for `/api/fleet/overview`
  and `/api/situations`.

## Out of scope (YAGNI)

Prometheus/Grafana/cAdvisor/Alertmanager; a host-side agent; arbitrary command
execution; auto-remediation beyond the small high-confidence allow-list; multi-host
(the fleet is one box today — design keeps `target`/host fields generic but builds
for one).
