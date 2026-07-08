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
- `MIN_FREE_DISK_GB` (disk hard-gate floor, fast-follow — see below).
- **Control-plane isolation:** the current shared box also runs Coolify + Postgres +
  Traefik + the panel. It is role `shared_control` and treated as **bootstrap capacity
  only** — once a second shared (workload-only) box exists, new workloads prefer the
  workload boxes; the control-plane box is packed last, to shrink blast radius.
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

## Consistency, idempotency & runtime enforcement (review-mandated, before 3a)

These close the gap between "the reservation math is correct" and "the reservation is
actually enforced under concurrency" — three angles on one risk.

### Placement consistency (lock)

A naive `pickBox` has a check-then-act race: two concurrent deploys both see the same
free capacity and both place on the same box → overcommit despite the gate. Placement
must be atomic:

```text
1. Resolve the incoming plan's reservation (MB).
2. Acquire the placement lock (serialise all shared-pool placement).
3. Recompute committed RAM for candidate boxes INSIDE the lock.
4. pickBox (best-fit). No fit → create-or-reuse a provisioning job (below).
5. Persist the chosen server UUID / destination as the deploy target.
6. Release the lock. Only now may the deploy call Coolify.
```

Mechanism: the panel is **single-process** (one Node instance; SQLite has no Postgres-
style advisory locks), so the lock is an **in-process async mutex** serialising the
compute-and-commit step — cheap and sufficient. *(ponytail: in-process mutex now; a
`placement_lock` DB row is the upgrade path IF the panel ever runs multiple instances.)*

### Provisioning idempotency (job state machine)

Scale-up must not double-provision on retries/timeouts/simultaneous unschedulable events
(orphaned or duplicate Hetzner boxes = real money). Provisioning is job-based:

```text
requested → provisioning → coolify_registered → destination_ready → active
requested → provisioning_failed
```

`server_provision_jobs`: `id, idempotency_key, status, instance_type, hetzner_server_id,
coolify_server_uuid, destination_uuid, error, retry_count, created_at, updated_at`.
Concurrent unschedulable deploys **reuse an in-flight job** (keyed by idempotency_key)
rather than creating a second box; the cooldown is enforced against the last job's time.

### Reservation → runtime limit (the enforcement that makes the gate real)

The committed-RAM gate stops *placement* overcommit, but a container with no memory
**limit** can still exceed its reservation and OOM the host — so the reservation must
become a real cgroup limit:

- Every planned resource maps its plan memory to a **Coolify container memory limit**,
  applied via `updateResources` (PATCH `/services/:id/resources` `{ memory }`) on deploy.
- Plan changes update the limit; a resource whose limit fails to apply is **blocked/
  marked unsafe**, not deployed.
- Existing resources without a limit are back-filled to their plan (or the conservative
  default) on next deploy.

### Capacity failure policy (fail closed)

If committed RAM can't be computed for a box (e.g. Coolify resource fetch fails), it is
`capacity_unknown` → **excluded from placement** + operator alert. If all shared boxes
are full or unknown → **block** the deploy; never guess, never provision past
`MAX_SHARED_BOXES`.

## Data & model

- **`server_meta`** table: `server_uuid, role ('shared'|'shared_control'|'dedicated'),
  client_org_id (dedicated only), instance_type, ram_mb, headroom_mb, created_at`.
  `shared_control` = the Coolify-host box (bootstrap capacity, packed last). Everything
  else is live from Coolify + the existing DB.
- **`server_provision_jobs`** table — the scale-up idempotency state machine (see above).
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
- **concurrent placement race:** two deploys request the last slot → exactly one wins,
  the other provisions/blocks (proves the lock).
- **provision idempotency:** repeated unschedulable events reuse one job → no duplicate
  Hetzner box; **cooldown under concurrency:** five simultaneous unschedulable → one job.
- **unknown capacity:** failed Coolify fetch → box excluded (fail closed).
- **unplanned resource** gets the default reservation and shows it in the Fleet UI.
- **MAX cap:** at cap, deploy blocks + alerts, no provision call.
- **runtime limit:** deploy applies the plan's Coolify memory limit; apply-failure blocks.

## Non-goals (v1 / later)

- **Scale-down before the relocation primitive** (Phase 3b, sequenced).
- **CPU as a *hard* gate** — CPU stays warning-only. **Disk is a fast-follow hard gate**
  (`MIN_FREE_DISK_GB`): a full disk kills deploys, DB, docker pulls, and TLS renewal, so
  block placement on a near-full box and when disk telemetry is missing on a full-ish box.
- Cross-region autoscaling; multi-instance-type node groups.
- Auto-migrating/rebalancing existing sites for packing efficiency (only relocation for
  scale-down, not continuous rebalancing).

## Unit economics & cost model (why the gate = the margin)

No new customer billing here — apps on shared boxes are already billed via
`COMPUTE_PLANS` (`plans.js`). This is the **operator cost model**, because autoscaling
turns hosting cost from "one box" into "a fleet that grows with billed load".

**A box is a fixed step cost.** A shared 8 GB box ≈ **€7–9/mo** (verify the current
Hetzner CX SKU). Usable pool ≈ 8 GB − ~1.2 GB headroom ≈ **6.8 GB** on a workload agent
box. Committed RAM (the placement gate) *is* the packing density, so **the same
reservation number that prevents OOM also sets revenue-per-box:**

```text
packed with   reserve   sites/box   revenue/box (price)   box cost   gross/box
Hobby  $5      0.5 GB      ~13         ~$65                 ~$8        ~$57  (~88%)
Starter $9     1 GB        ~6          ~$54                 ~$8        ~$46  (~85%)
Pro    $15     2 GB        ~3          ~$45                 ~$8        ~$37  (~82%)
```

Per-plan `costMo` in `plans.js` already encodes this — **but it assumes a *packed* box.**

**The autoscaling wrinkle:** a freshly provisioned box is **partially filled**, so its
true cost is the full ~€8/mo with only a fraction of the revenue until it fills. That's
the economic guardrail, and it maps onto the scaling rules already in this spec:
- **Provision only on genuine need** (unschedulable), so a new box always opens with ≥1
  paying site — break-even is ~1 Pro or ~2 Starter, reached immediately.
- **Overprovision-ahead spare = a deliberate, capped cost** (~€8/mo of idle box) bought to
  hide the ~2-min cold-provision latency. Worth it, but it's why `MAX_SHARED_BOXES` and
  the 85% ahead-threshold exist — don't hold more than one spare.
- **`MIN_SHARED_BOXES` = your baseline fixed cost** (the warm floor runs even at zero load).
- **Dedicated boxes are cost-passthrough** — the client pays the box via the dedicated
  plans (Pro Plus $45 / Scale $85, `shared:false`), so they never dilute shared margin.

**Fleet dashboard shows it:** per box, billed revenue (Σ plan price of its sites) vs
Hetzner cost → live gross margin, so a chronically half-empty provisioned box is visible,
not silently eating the ~85% margin the packed math assumes.

## Risks

- **Autoscale spends money with no human** — mitigated by kill switch + hard cap +
  cooldown + audit + alerts. These are load-bearing, not nice-to-haves.
- **Reservations must reflect reality** — if plan memory is set too low, bin-packing
  overcommits despite the gate; the live-warner is the backstop that flags it.
- **Provision latency (~2 min)** — overprovision-ahead hides it; without it, the first
  deploy after a box fills waits for a cold box.

## Build order

1. **A** — `capacity.js` (committed math + live telemetry sampler on the tick) +
   `server_meta`/`server_provision_jobs`/samples tables.
2. **B** — Fleet admin page (hierarchy join + capacity bars).
3. **C / Phase 3a** — `autoscale.js`: placement **lock** + `pickBox` bin-packing +
   scale-up-on-unschedulable + **provision-job idempotency** + overprovision-ahead +
   guardrails + **runtime memory-limit enforcement**, wired into the deploy/create path.
   *(The lock, the provision-job state machine, runtime-limit enforcement, and fail-closed
   capacity are mandatory-before-3a, not fast-follows — they're what make the gate real.)*
4. **C / Phase 3b** — `relocateSite` primitive, then scale-down on top of it.

**Status: approved for implementation planning, not implementation-ready** until the
mandatory-before-3a controls above are in the plan.

## Addendum (2026-07-08) — Hetzner reality, stable-IP ingress, provisioning-can-fail, costings

Informed by a senior-infra review of the live Hetzner offering (sources in the handover).
Three things this design MUST absorb.

### A. Stable-IP ingress (customers never re-do DNS on a box change)

Decouple "the IP a customer points at" from "the box that runs it", so upgrade / replace /
rescale / autoscale-drain never forces a customer DNS change. Granularity decides coverage:

- **Shared app pool → a Hetzner Load Balancer (one stable IP).** Customers point their
  domain at the **LB IP**; the LB routes to whichever backend box runs their app via
  **label-selector targets** + health checks. Replace, migrate-between-boxes, and autoscale
  are all transparent — the autoscaler adds/removes boxes and the LB re-targets by label,
  DNS untouched. Best fit for the autoscaled pool.
- **Dedicated / stateful boxes (mail, big single-tenant) → one Floating IPv4 each.** No LB;
  the box *is* the service. Replacement = reassign the Floating IP via one API call →
  reputation + rDNS travel with the IP (critical for mail). The box must **bind the Floating
  IP** (cloud-init/netplan) or the benefit is inbound-only.
- **Onboarding implication:** the DNS-setup/verify flow must emit the **stable IP (LB or
  Floating IP), not a box's primary IP**. One-time change for the customer; zero thereafter.

### B. Provisioning-can-fail (promote to a first-class failure mode)

Hetzner has **no managed autoscaler** — our hcloud-API controller is the only path — and
**`POST /servers` can fail** (there is an active "Limited availability of cloud instances"
incident, and existing customers get randomly restricted). The controller MUST:
- **Retry with backoff** on capacity errors; never put node-create on a user's sync path.
- **Fallback by server type** (CX→CPX) and **by region** (fsn1→nbg1→hel1) on capacity failure.
- Keep a **warm headroom node** so a burst doesn't wait on a cold (or failing) provision.
- Bring nodes up from a **golden snapshot** (baked Coolify-agent image) — seconds, not full
  cloud-init.
- Raise the **per-account resource limit** (console request, needs ≥1mo tenure) BEFORE go-live;
  respect hard caps: **placement group = 10 servers**, **private network = 100 servers**,
  hcloud **API rate limits** (cache state, poll actions async).
- Alarm on **create-failure rate** — an autoscaler that assumes create always succeeds pages at 3am.

### C. Costings (EUR/mo, ex-VAT; new-order rates — model the fleet on these, not grandfathered)

| Item | Cost | Role in this design |
|---|---|---|
| CX23 4 GB / CX33 8 GB / CX43 16 GB | €5.49 / €8.49 / €15.99 | shared pool nodes (bin-packed) |
| CPX32 8 GB / CPX52 24 GB | €35.49 / €100.49 | higher-clock / heavy boxes |
| CCX23 16 GB / CCX33 32 GB (dedicated) | €85.99 / €138.49 | noisy/isolated single-tenant |
| **Primary IPv4** | €0.50 | default per box |
| **Floating IPv4** | €3.00 | per stateful box (mail, dedicated) — stable IP |
| **Load Balancer (LB11)** | €5.39–7.49 | one per shared pool — stable ingress IP |
| **Cloud Firewall / Private Network / Placement Group** | **free** | apply to every box by role |
| **Snapshot** | €0.0143/GB-mo (compressed) | golden image for fast node bring-up |
| **Volume** | €0.0572/GB-mo | survive-the-box data (mail store, DBs) |
| **Object Storage** | €4.99 incl. 1 TB | off-box backups (DR floor) |
| **Automatic Backups** | +20% of server price | stateful boxes only, not cattle |

**Unit-economics deltas vs the earlier "box = step cost" model:**
- A shared pool node is now **box + share of one LB** (€5.39–7.49 amortised across the pool),
  not box + per-box Floating IP — so the LB is a *fixed pool overhead*, not per-node. Cheap
  once the pool has >1 node.
- A **dedicated/stateful box** carries **+€3 Floating IP + Volume (€0.057/GB) + 20% backups**
  on top of the box — fold into that customer's price.
- **Rescale re-prices to new rates**, so prefer **replace-with-snapshot** over rescale for
  predictable per-node cost.
- Fixed platform overhead to budget regardless of load: **1 LB (€~7) + Object Storage (€5) +
  control-plane box backups (20%)** ≈ €15–20/mo floor before any customer node.

**Net:** the primitives are cheap-to-free (firewalls, networks, placement groups free; IPs/
snapshots/volumes trivial); the only non-trivial recurring adds are the **LB (~€7, pooled)**
and **per-stateful-box Floating IP (€3)**. The real cost risk is not these line items — it's
the **capacity crunch** forcing fallback to pricier types/regions, which the controller must
handle and the margin model must tolerate.
