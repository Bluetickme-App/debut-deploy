# Fleet capacity + admin hierarchy + autoscaling

**Date:** 2026-07-05
**Status:** approved (design) — pending implementation plan
**Depends on:** Coolify server APIs (`coolify.js` `listServers`, `/servers/:uuid/
resources`, `getDefaultDestination`), the SSH host-exec path (`hostexec.js`), Hetzner
provisioning (`hetzner.js`, `provision.js`), per-resource plans (`plans.js`, `metering.js`),
and ownership/org data (`db.js`, `ownership.js`).

## Problem

The panel has no capacity awareness. Coolify's REST API exposes **no live host CPU/RAM/
disk** ([coolify.js:436](../../../server/coolify.js)); "fullness" today is only a
resource *count*. So there's no signal for **"is this shared box full?"**, no admin view
of **which box holds which client's sites**, and no logic to **stop packing a box and
spin up another**. The 4 GB box already OOM'd once by overcommitting memory.

Goal: run **the same system enterprise providers run** — the Kubernetes **Cluster
Autoscaler** + bin-packing scheduler model (GKE/EKS/AKS/Render/Fly all sit on it) —
adapted to Hetzner + Coolify, plus the admin hierarchy view to see it.

## The enterprise model we mirror

| Cluster-Autoscaler mechanism | Default | Our equivalent |
|---|---|---|
| Schedule by **requests** (guaranteed reservation), not live use | — | **Committed RAM** gate: `plan_id` → reserved MB |
| Enforce by **limits** at runtime (kubelet) | — | Container mem limit; **live telemetry warns** on breach |
| **Bin-pack `MostAllocated`** (dense = fewer boxes = cheaper) | opt-in | `pickBox` = best-fit onto the fullest box that still fits |
| **Scale up** when a workload is **unschedulable** | — | No shared box fits the reservation → provision |
| **System-reserved** overhead | — | Per-box headroom (OS+Coolify+Traefik) |
| **Overprovision headroom** | opt-in | Provision-ahead at a fleet-committed threshold |
| **Node group** = one instance type, **min/max** | — | Shared pool = one Hetzner CX type, MIN=1 / MAX=5 |
| **Scale-up stabilization / cooldown** | — | Cooldown between provisions |
| **Scale down** when node requests < threshold, sustained | **50%**, **10 min** unneeded | Box committed <50% for 10 min → reclaim candidate |
| **`scale-down-delay-after-add`** | **10 min** | Same |
| Scale down only if pods **reschedulable** (PodDisruptionBudget) | — | **Requires a site-relocation primitive** (see Phase 3b) |

**Capacity model (locked): commit-gates, live-warns.** Committed RAM is the hard
placement gate (arithmetic → can't overcommit → no OOM). Live RAM/CPU/disk telemetry
never gates; it raises warnings (e.g. a site live-using far above its plan).

## Config (node-group settings, locked)

- `MIN_SHARED_BOXES = 1` (warm floor) · `MAX_SHARED_BOXES = 5` (hard spend ceiling).
- Shared-pool **instance type** = same CX as the current shared box (config-editable).
- Per-box **headroom**: control-plane host (runs Coolify+PG+Traefik+panel) reserves more
  (~1.5 GB); pure workload agent boxes reserve less (~0.5 GB). Stored per box.
- **Scale-up-ahead threshold** (overprovision): fleet committed > 85% → provision the
  next box *before* fully wedged.
- **Provision cooldown** (stabilization): no second provision within 10 min.
- **Global autoscale on/off** kill switch.
- Scale-down (Phase 3b): 50% committed threshold, 10-min unneeded, 10-min delay-after-add.

All in a `server_meta`/settings store, operator-editable.

## Architecture — three pieces, built in order

```
A. Capacity telemetry ──► B. Fleet hierarchy view (admin)
        │
        └──────────────► C. Capacity-aware placement + autoscaling
```

### A. Capacity telemetry — `server/capacity.js`

Two numbers per server:
- **Committed RAM (hard gate)** — sum of the reserved memory of every resource placed on
  the box (join Coolify `/servers/:uuid/resources` × `resource_ownership.plan_id` →
  `plans.js` memory). Pure DB/Coolify arithmetic; no live dependency.
  - **Gap (must handle):** resources with no `plan_id` (free-tier/unclaimed) have no
    reservation → invisible to the gate. They get a **conservative default reservation**
    so a box can't be silently overcommitted.
- **Live RAM/CPU/disk (warner)** — SSH `free -b`, `df -B1 /`, `nproc`, load via
  `runOnHost`, sampled on the **existing 60s health tick** (piggyback, like the metrics
  sampler). Stored in `server_capacity_samples`, swept to 24 h (reuse the metrics sweep).

Usable pool = host RAM − headroom. Box is **full** when committed ≥ usable pool.

### B. Fleet hierarchy view (admin)

A new **Fleet** admin page — the server-centric complement to the client-centric
`Clients.jsx`. A tree built by joining Coolify per-server resources × `resource_ownership`
(org/client) × domains × plan (reserved MB):

```
CX22  (shared)   ██████████ 94% committed  ⚠ near full   live 39%
  └ Acme Ltd      3 sites · 5 domains · 3.2 GB reserved
  └ Beta Co       1 site  · 1 domain  · 1.0 GB reserved
CX23  (shared)   ██░░░░░░░░ 24% committed                 live 18%
  └ Gamma Inc     2 sites · 4 domains
CX-mail (dedicated → email product)   — excluded from autoscaling
```

Per box: committed% (hard bar) + live% (overlay), role (shared/dedicated), reachable.
"All account owners" = the org list, reachable from either axis.

### C. Capacity-aware placement + autoscaling — `server/autoscale.js`

**Governs the SHARED pool only.** Dedicated boxes are 1:1 with a client and excluded
(the k8s tainted-node analogue) — never packed, never reclaimed.

**Placement (`pickBox`, pure):** on any new deploy/create targeting the shared pool,
best-fit (`MostAllocated`) the incoming reservation into the shared box with the least
free space that still fits → dense packing, fewer boxes.

**Phase 3a — Scale UP + bin-pack (ship now):**
- No shared box fits the reservation (**unschedulable**) → **auto-provision** a box:
  `provisionServer(type)` → poll `getDefaultDestination` until Coolify-ready (~2 min) →
  place the deploy there.
- **Overprovision-ahead:** when fleet committed > 85%, provision the next box in the
  background so a burst doesn't wait on a cold box.
- **Guardrails (mandatory — this spends money unattended):** global kill switch;
  `MAX_SHARED_BOXES` hard cap (hitting it **blocks + alerts**, never provisions past);
  10-min provision cooldown; fixed instance type; provision failure → alert + fall back
  to blocking, never silent. Every action `recordSystem`-audited + operator-notified.

**Phase 3b — Scale DOWN (after the relocation primitive):**
- Adopt the same policy: a shared box under 50% committed for 10 min (and past the
  delay-after-add) is a reclaim candidate.
- **Prerequisite (the honest divergence from k8s):** a customer **site is a pet**, not
  cattle — it has a domain, TLS cert, often a volume/DB, and Coolify deploys it to a
  *specific* box with no live-migrate. Reclaiming a box means **relocating** its sites
  (redeploy on the target box + repoint Traefik/DNS + move persistent data) — a new
  **`relocateSite` primitive** we must build (feasible; done manually before). Scale-down
  is gated on it. PodDisruptionBudget analogue: never relocate a dedicated/pinned site,
  and only within a per-site maintenance window (not during a client's business hours).
- Trying to auto-scale-down *without* relocation would evict live customer sites —
  explicitly unsafe, so it stays out until the primitive exists.

## Data & model

- **`server_meta`** table: `server_uuid, role ('shared'|'dedicated'), client_org_id
  (dedicated only), instance_type, ram_mb, headroom_mb, created_at`. Everything else is
  live from Coolify + the existing DB.
- **`server_capacity_samples`** table (or reuse a generic samples table): `server_uuid,
  sampled_at, ram_used_bytes, ram_total_bytes, cpu_pct, disk_used_bytes, disk_total_bytes`.
  Swept to 24 h on the existing sweep.
- Which box a resource sits on: Coolify already exposes it (`app.destination.server.uuid`
  / `/servers/:uuid/resources`) — no new tracking needed.

## Error handling

- Telemetry is best-effort on the tick (SSH/parse failure skips one sample, never crashes
  the monitor — same stance as the metrics sampler).
- Committed-RAM math must **fail closed**: if a box's committed can't be computed, treat
  it as full (don't place there) rather than risk overcommit.
- Provisioning is async and can fail; the flow polls readiness, and on timeout/failure
  alerts + blocks rather than placing on a not-ready box.

## Testing

`node --test`, pure logic + mocked provisioning:
- `pickBox` best-fit / `MostAllocated` (fits, no-fit → null, prefers fullest-that-fits).
- committed-RAM math incl. the unplanned-resource default reservation; fail-closed.
- `free`/`df` parse (reuse the metrics-parse pattern).
- scale-up trigger: unschedulable → provision (mocked `provisionServer`); MAX cap →
  block+alert not provision; cooldown suppresses a second provision; overprovision-ahead
  fires at threshold.
- scale-down (Phase 3b): under-threshold + sustained → candidate; excludes dedicated;
  refuses without relocation available.

## Non-goals (v1 / later)

- **Scale-down before the relocation primitive** (Phase 3b, sequenced).
- **CPU/disk as *hard* gates** — RAM hard-gates; disk/CPU only warn (disk-full is a real
  risk → warn loudly; hard disk gate is a fast-follow).
- Cross-region autoscaling; multi-instance-type node groups.
- Auto-migrating/rebalancing existing sites for packing efficiency (only relocation for
  scale-down, not continuous rebalancing).

## Risks

- **Autoscale spends money with no human** — mitigated by kill switch + hard cap +
  cooldown + audit + alerts. These are load-bearing, not nice-to-haves.
- **Reservations must reflect reality** — if plan memory is set too low, bin-packing
  overcommits despite the gate; the live-warner is the backstop that flags it.
- **Provision latency (~2 min)** — overprovision-ahead hides it; without it, the first
  deploy after a box fills waits for a cold box.

## Build order

1. **A** — `capacity.js` (committed math + live telemetry sampler on the tick) +
   `server_meta`/samples tables.
2. **B** — Fleet admin page (hierarchy join + capacity bars).
3. **C / Phase 3a** — `autoscale.js`: `pickBox` bin-packing + scale-up-on-unschedulable +
   overprovision-ahead + guardrails, wired into the deploy/create path.
4. **C / Phase 3b** — `relocateSite` primitive, then scale-down on top of it.
