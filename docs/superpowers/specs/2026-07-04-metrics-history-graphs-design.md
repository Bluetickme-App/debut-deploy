# Persisted metrics + Render-style graphs

**Date:** 2026-07-04
**Status:** approved (design) — pending implementation plan
**Depends on:** the existing SQLite layer (`db.js` migrations), the 60s health-monitor
tick (`index.js`), the SSH host-exec path (`hostexec.js`), and the live metrics
endpoint (`GET /api/services/:id/metrics`).

## Problem

The Metrics tab shows only **point-in-time** CPU% and memory% from a single
`docker stats --no-stream` snapshot ([hostexec.js `getContainerStats`](../../../server/hostexec.js)),
rendered as two static progress bars ([ServiceDetail.jsx `MetricsTab`](../../../client/src/pages/ServiceDetail.jsx)).
There is no history: every sample is thrown away, so there are no graphs, no
peaks, and no "what happened an hour ago". Render shows time-series graphs with
selectable windows and peak markers.

Coolify has **no metrics API** (confirmed — see the Coolify-quirks memory). The
only data source is `docker stats` over SSH. So history must be **accumulated by
us**: sample on a schedule, persist, and query back windowed.

## Goals

- Persist CPU / memory / network samples per service so graphs survive client
  reloads and server restarts.
- A Render-style Metrics tab: **`[1h] [6h] [24h]`** time-range toggle, an area+line
  graph per metric, and **current / peak / avg** readouts.
- One SSH round-trip per minute regardless of fleet size (kind to the 8 GB host).
- Zero new timers, zero new dependencies.

## Non-goals

- No 7-day (or longer) window; 24 h retention only.
- No downsample-on-write / rollup table; bucketing happens at query time.
- No hover crosshair tooltip on the graph in v1 (the cur/peak/avg readout covers
  the numbers).
- No bandwidth-rate (bytes → Mbps) derivation in v1; store cumulative net counters,
  derive later if wanted.
- No charting library; hand-rolled SVG (the codebase already hand-rolls SVG for the
  build queue).
- No change to the existing live `GET /api/services/:id/metrics` endpoint — the
  "Live" current-value path stays.
- No backfill: history is empty for the first hour after a service starts being
  sampled. There is no historical `docker stats` to recover.

## Architecture

Four additive parts on the existing spine. Each reuses an existing mechanism
rather than adding a parallel one.

```
Part 1  metrics_samples table            (migration user_version 21)
Part 2  sampler on the existing 60s tick (server/metrics.js + index.js wiring)
Part 3  retention on the existing 6h sweep
Part 4  history API + rebuilt Metrics tab (SVG graphs)
```

CPU is stored as docker's convention (0–100 × nCPU, i.e. can exceed 100 on
multi-core). Memory as used bytes + percent. Network as the **cumulative** rx/tx
counters docker reports (nullable — some drivers omit NetIO).

---

## Part 1 — Storage (migration `user_version 21`)

Append one migration to the `MIGRATIONS` array in
[db.js](../../../server/db.js), mirroring the `usage_events` shape:

```sql
CREATE TABLE metrics_samples (
  coolify_uuid TEXT NOT NULL,
  sampled_at   TEXT NOT NULL,      -- ISO 8601, same clock as usage_events
  cpu_pct      REAL NOT NULL,      -- 0–100 (× nCPU; docker convention)
  mem_bytes    INTEGER NOT NULL,   -- used bytes
  mem_pct      REAL NOT NULL,      -- 0–100
  net_rx_bytes INTEGER,            -- cumulative from docker stats NetIO (nullable)
  net_tx_bytes INTEGER
);
CREATE INDEX idx_metrics_uuid_ts ON metrics_samples(coolify_uuid, sampled_at);
```

No UNIQUE constraint: the health tick's reentrancy guard (`healthRunning`) is the
duplicate-suppression, exactly as `usage_events` documents.

## Part 2 — Sampler on the existing 60 s tick

New module `server/metrics.js` holding the pure/testable logic:

- `parseStatsLine(line)` → `{ name, cpu_pct, mem_bytes, mem_pct, net_rx_bytes, net_tx_bytes }`.
  Parses one `docker stats --format` line, converting MiB/GiB/kB/MB units to bytes
  and stripping `%`. Handles the `NetIO` `"1.2kB / 3.4MB"` pair.
- `sampleAllContainers()` → runs **one** SSH command:
  `docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}'`
  over **all** running containers (no name filter), returns parsed rows. Reuses
  `runOnHost` from `hostexec.js`. DEMO short-circuits with a synthetic row.
- `mapNamesToUuids(rows)` → resolve each container name to its owning service uuid.
  A container name contains the service uuid as a substring (the live endpoint
  already filters `docker ps --filter name=<uuid>`); match by "uuid is a substring
  of container name", dropping rows that match no owned resource.
- `insertMetricsSamples(rows, sampledAt)` → one batched `INSERT` (prepared
  statement in a `db.transaction`).

Wiring: add a third best-effort block in the health tick
([index.js ~2248](../../../server/index.js)), immediately after the metering
block, inside its own `try/catch` so a sampling failure only skips one minute and
never crashes the monitor (identical stance to the metering block's comment).

```js
// --- metrics history sampling (best-effort; must never crash the monitor) ---
try {
  const rows = mapNamesToUuids(await sampleAllContainers());
  insertMetricsSamples(rows, new Date().toISOString());
} catch (mErr) {
  console.error("metrics sampling:", mErr.message);
}
```

## Part 3 — Retention on the existing 6 h sweep

In the existing suspension/sweep timer ([index.js ~2288](../../../server/index.js)),
add one statement:

```sql
DELETE FROM metrics_samples WHERE sampled_at < :cutoff  -- cutoff = now − 24 h
```

No new timer. At 60 s sampling that caps the table at ~1,440 rows per container.

## Part 4 — History API + rebuilt Metrics tab

**Endpoint.** `GET /api/services/:id/metrics/history?window=1h|6h|24h`
— `requireAuth`, owner-scoped via the same `assertOwns(req.user, "application", id)`
as the live endpoint. Unknown/absent `window` → default `1h`.

Bucketing happens in SQL so payloads stay small and the client draws directly:

| window | bucket | ≈ points |
|--------|--------|----------|
| 1h     | 60 s (raw) | 60  |
| 6h     | 3 min      | 120 |
| 24h    | 10 min     | 144 |

```sql
SELECT CAST(strftime('%s', sampled_at) / :bucketSec AS INT) AS bucket,
       AVG(cpu_pct) AS cpu, MAX(cpu_pct) AS cpu_peak,
       AVG(mem_pct) AS mem, MAX(mem_pct) AS mem_peak,
       AVG(mem_bytes) AS mem_bytes,
       MAX(net_rx_bytes) AS net_rx, MAX(net_tx_bytes) AS net_tx,
       MIN(sampled_at) AS t
FROM metrics_samples
WHERE coolify_uuid = :uuid AND sampled_at >= :from
GROUP BY bucket ORDER BY bucket;
```

Response shape:

```json
{
  "window": "1h",
  "series": {
    "cpu":  [{ "t": "2026-07-04T10:00:00Z", "v": 3.2, "peak": 12.1 }, ...],
    "mem":  [{ "t": "...", "v": 4.0, "bytes": 71000000 }, ...],
    "net":  [{ "t": "...", "rx": 1200, "tx": 3400 }, ...]
  },
  "stats": {
    "cpu": { "current": 0.4, "peak": 12.1, "avg": 3.0 },
    "mem": { "current": 0.9, "peak": 6.0, "avg": 4.0 },
    "net": { "current": 0, "peak": 0, "avg": 0 }
  }
}
```

Empty history (no rows yet) → `{ window, series: { cpu:[], mem:[], net:[] }, stats: null }`.
The client renders an "accumulating…" empty state for `stats: null`.

**Client.** New API method `api.metricsHistory(id, window)` in
[lib/api.js](../../../client/src/lib/api.js). Rebuild `MetricsTab`
([ServiceDetail.jsx ~561](../../../client/src/pages/ServiceDetail.jsx)):

- A `[1h] [6h] [24h]` pill toggle (Render-style), default `1h`.
- New `<MetricChart>` component: a hand-rolled SVG **area + line** with a **peak
  dot** annotation and light horizontal gridlines, sized to fill the card. Pure:
  takes `points`, `color`, an accessor, and an optional `peak`.
- One card per metric — **CPU**, **Memory**, **Network** — each with the big
  current value, a `peak / avg` sub-line, and the graph beneath.
- Keep the pulsing "Live" dot. The current value keeps refreshing from the live
  `/metrics` endpoint every 5 s (unchanged); the graph refetches on window change
  and on a slower interval (e.g. 30 s).

The existing `MetricCard` / `Bar` / `pct` helpers are reused where they still fit
(the current-value header); the static-bar-only layout is replaced by the graph.

## Data flow

```
health tick (60s)
  ├─ runHealthCheck            (unchanged)
  ├─ meterResources            (unchanged)
  └─ sampleAllContainers  ──►  one SSH `docker stats` over ALL containers
        mapNamesToUuids  ──►  drop unowned; name⊃uuid
        insertMetricsSamples ─► batch INSERT into metrics_samples

6h sweep tick
  └─ DELETE metrics_samples WHERE sampled_at < now-24h

client Metrics tab
  ├─ api.metrics(id)              every 5s  → live current-value header ("Live")
  └─ api.metricsHistory(id, win)  on change / 30s → SQL-bucketed series → <MetricChart>
```

## Error handling

- Sampler is best-effort inside the monitor tick: SSH/parse failure logs and skips
  one minute, never throws (matches the metering block).
- SSH host not configured (`getContainerStats` throws 501 today) → the sampler
  simply inserts nothing; the history endpoint returns empty; the tab shows the
  "metrics host not configured / accumulating…" state.
- History endpoint is read-only and owner-scoped; an unowned id → the same 402/403
  the live endpoint raises via `assertOwns`.
- Malformed `docker stats` lines are dropped per-line in `parseStatsLine`, never
  failing the whole batch.

## Testing

`node --test` only, extending the existing suite. No new frameworks.

- `metrics.js`:
  - `parseStatsLine`: MiB/GiB/kB/MB → bytes; `%` stripping; NetIO pair split;
    malformed line → null (dropped).
  - `mapNamesToUuids`: name-contains-uuid match; unowned rows dropped.
  - bucket math: bucket index from epoch/bucketSec; peak = MAX; round-once on the
    displayed values.
- History endpoint (or its pure query builder):
  - window → `from` bound and `bucketSec` selection (1h/6h/24h; unknown → 1h).
  - empty history → `stats: null`, empty series.
  - owner-scope: unowned id rejected.

## Build order

1. **Part 1** — migration `user_version 21` (`metrics_samples` + index).
2. **Part 2** — `server/metrics.js` (`parseStatsLine`, `sampleAllContainers`,
   `mapNamesToUuids`, `insertMetricsSamples`) + wire into the health tick.
3. **Part 3** — retention `DELETE` in the 6 h sweep.
4. **Part 4** — history endpoint + `api.metricsHistory` + `<MetricChart>` +
   rebuilt `MetricsTab`.
