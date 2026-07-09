# Fleet Monitoring — Phase 2 (Detection + Suggested Fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Detect operational "situations" (disk high, memory high, container down/unhealthy, **zombie deploy jamming the queue**, build-queue pileup) on the existing health tick, record + notify with a **suggested fix**, and let an operator apply that fix with one click / one MCP call. **No autonomous action** — that's Phase 3.

**Architecture:** A pure `evaluateSituations(inputs)` rules function + a `reconcileSituations` DB layer, run each health tick right after `sampleAndStore` in [server/index.js](../../../server/index.js). New `situations` + `remediation_log` tables. A remediation **registry** maps each situation type to a suggested action and an allow-listed command template; the `/api/situations/:id/remediate` route (admin) runs the mapped template via the pinned-key `runOnHost`. Reuses `notifyOwner`/`recordSystem` (notifications + audit) and the Fleet dashboard.

**Tech Stack:** Node ESM, Express, better-sqlite3, `ssh2` via `runOnHost`, React/Vite, `@modelcontextprotocol/sdk`+`zod`, `node:test`.

## Global Constraints

- ESM everywhere; reuse existing helpers — `runOnHost` (pinned key, fails closed), `notifyOwner(uuid,{type,message})` ([index.js:415](../../../server/index.js)), `recordSystem(type,meta)`, the `h()` route wrapper, `requireAuth`+`requireAdmin`, the versioned `MIGRATIONS` array in [server/db.js](../../../server/db.js).
- Situation evaluation is **pure and unit-tested with injected inputs** (no DB/SSH in the pure function). DB reconcile + tick wiring are best-effort (wrapped; never crash the health tick).
- **Phase 2 is suggest-only.** Remediations execute ONLY via the explicit `/api/situations/:id/remediate` route or the `run_remediation` MCP tool (human/agent triggered). NO auto-execution on the tick. (Phase 3 adds the bounded auto path.)
- Remediation commands are **fixed allow-listed templates** keyed by registry id — never interpolate user/agent input into a shell command. All host actions via `runOnHost`.
- Routes admin-gated; MCP tools require the existing token.
- Situation `target` is `"host"` or a Coolify uuid — keep generic (fleet is one host today).
- Thresholds are module constants, not magic numbers inline.

## File Structure

- `server/situations.js` (NEW) — pure `evaluateSituations`, the remediation `REGISTRY`, `reconcileSituations`, `listSituations`, `applyRemediation`. One responsibility: situation lifecycle + remediation.
- `server/db.js` — two new `MIGRATIONS` entries (`situations`, `remediation_log`).
- `server/index.js` — wire `reconcileSituations` into the health tick; add 2 routes.
- `mcp/server.js` — `list_situations`, `run_remediation` tools.
- `client/src/pages/Fleet.jsx` — a Situations panel above the host gauges.
- `client/src/lib/api.js` — `situations()`, `remediateSituation(id)`.
- Tests: `server/situations.test.js` (pure evaluator + registry), extend `server/test_fleet_routes.mjs` for the situations route.

---

### Task 1: DB tables — situations + remediation_log

**Files:** Modify `server/db.js`; Test `server/situations.test.js` (new).

**Interfaces — Produces:** two tables.
- `situations(id INTEGER PK, type TEXT, target TEXT, severity TEXT, status TEXT, detail TEXT, suggested_remediation TEXT, opened_at TEXT, resolved_at TEXT, auto_applied_at TEXT)`
- `remediation_log(id INTEGER PK, situation_id INTEGER, action TEXT, actor TEXT, command TEXT, ok INTEGER, result TEXT, at TEXT)`

- [ ] **Step 1: Write the failing test** — in `server/situations.test.js`:

```javascript
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const { db } = await import("./db.js");

test("situations + remediation_log tables exist with expected columns", () => {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.deepEqual(cols("situations").sort(), ["auto_applied_at","detail","id","opened_at","resolved_at","severity","status","suggested_remediation","target","type"].sort());
  assert.ok(cols("remediation_log").includes("situation_id"));
  assert.ok(cols("remediation_log").includes("actor"));
});
```

- [ ] **Step 2: Run it, verify it fails** — `DATABASE_FILE=:memory: node --test --test-name-pattern="tables exist" server/situations.test.js` → FAIL (no such table).

- [ ] **Step 3: Add two `MIGRATIONS` entries in `server/db.js`** (next numbers after #28, matching the array's style):

```javascript
// -> user_version 29: fleet situations (open/resolved operational conditions)
`CREATE TABLE IF NOT EXISTS situations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, target TEXT NOT NULL, severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', detail TEXT,
  suggested_remediation TEXT, opened_at TEXT NOT NULL,
  resolved_at TEXT, auto_applied_at TEXT
)`,
// -> user_version 30: remediation audit log
`CREATE TABLE IF NOT EXISTS remediation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  situation_id INTEGER, action TEXT NOT NULL, actor TEXT NOT NULL,
  command TEXT, ok INTEGER, result TEXT, at TEXT NOT NULL
)`,
```
Match how existing entries are added to the array + the `user_version` bump (read the file; migrations #27/#28 from Phase 1 are the template).

- [ ] **Step 4: Run it, verify pass.** Full: `DATABASE_FILE=:memory: node --test server/situations.test.js`.
- [ ] **Step 5: Commit** — `git add server/db.js server/situations.test.js && git commit -m "feat(situations): situations + remediation_log tables"`

---

### Task 2: Pure situation evaluator + remediation registry

**Files:** Create `server/situations.js`; Test `server/situations.test.js`.

**Interfaces:**
- Produces `evaluateSituations(input) -> Array<{type,target,severity,detail,suggested_remediation}>` where `input = { host:{diskRoot:{pct},diskVolume:{pct}|null,mem:{pct}}, sites:[{uuid,name,status,health}], deploys:[{uuid,application_name,status,ageSec}] }`. Pure — no DB/SSH.
- Produces `REGISTRY` — `{ [remediationId]: { title, situationTypes:[...], command, confidence } }`. Command is a fixed template string. Phase 2 marks none `auto`.
- Consumes nothing from other tasks.

**Rules (thresholds as consts):** `DISK_WARN=85, DISK_CRIT=92, MEM_WARN=90, ZOMBIE_DEPLOY_SEC=1200, QUEUE_PILEUP=3`.
- disk root or volume `pct >= CRIT` → `crit` / `>= WARN` → `warn`, type `host.disk` (target `host`, detail names which fs), suggested_remediation `prune-docker`.
- host mem `pct >= MEM_WARN` → `warn`, type `host.mem`, suggested `null` (no safe auto-fix).
- a site `status` exited/`health` unhealthy → `warn`, type `service.unhealthy`, target uuid, suggested `restart-service`.
- a deploy `status==='in_progress' && ageSec > ZOMBIE_DEPLOY_SEC` → `crit`, type `deploy.zombie`, target app, suggested `clear-deploy-queue`.
- `>= QUEUE_PILEUP` deploys `queued` → `warn`, type `deploy.pileup`, target `host`, suggested `null`.

- [ ] **Step 1: Write failing tests** (representative):

```javascript
import { evaluateSituations, REGISTRY } from "./situations.js";
test("evaluateSituations: volume crit → host.disk crit with prune suggestion", () => {
  const out = evaluateSituations({ host:{diskRoot:{pct:40},diskVolume:{pct:95},mem:{pct:50}}, sites:[], deploys:[] });
  const s = out.find((x) => x.type === "host.disk");
  assert.equal(s.severity, "crit");
  assert.equal(s.suggested_remediation, "prune-docker");
  assert.match(s.detail, /volume/i);
});
test("evaluateSituations: zombie deploy → deploy.zombie crit", () => {
  const out = evaluateSituations({ host:{diskRoot:{pct:5},diskVolume:null,mem:{pct:10}}, sites:[], deploys:[{uuid:"d1",application_name:"X",status:"in_progress",ageSec:5000}] });
  assert.equal(out.find((x)=>x.type==="deploy.zombie").severity, "crit");
});
test("evaluateSituations: all healthy → no situations", () => {
  assert.equal(evaluateSituations({ host:{diskRoot:{pct:5},diskVolume:{pct:5},mem:{pct:10}}, sites:[{uuid:"a",status:"running",health:"healthy"}], deploys:[] }).length, 0);
});
test("REGISTRY: every command is a fixed string, none auto in phase 2", () => {
  for (const r of Object.values(REGISTRY)) { assert.equal(typeof r.command, "string"); assert.notEqual(r.auto, true); }
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `server/situations.js`** — the pure `evaluateSituations` per the rules above + the `REGISTRY`:

```javascript
export const REGISTRY = {
  "prune-docker": { title: "Reclaim disk (prune images + build cache)", situationTypes: ["host.disk"], confidence: "high",
    command: "docker image prune -af --filter until=24h && docker builder prune -f --keep-storage 20GB" },
  "restart-service": { title: "Restart the unhealthy service", situationTypes: ["service.unhealthy"], confidence: "medium",
    command: "coolify-restart" }, // special: routes through control_service, not a raw host cmd — see applyRemediation
  "clear-deploy-queue": { title: "Clear the stuck deploy (restart coolify to reconcile)", situationTypes: ["deploy.zombie"], confidence: "high",
    command: "docker restart coolify" },
};
```
(Thresholds as consts; `detail` as a short human string; return the array. No DB here.)

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(situations): pure evaluator + remediation registry`

---

### Task 3: reconcileSituations + listSituations (DB lifecycle)

**Files:** Modify `server/situations.js`; Test `server/situations.test.js`.

**Interfaces:**
- Produces `reconcileSituations(desired, nowIso) -> {opened:[], resolved:[]}` — inserts newly-appeared `(type,target)` as `open`; marks `resolved` any currently-open row whose `(type,target)` is no longer in `desired`. Idempotent (re-running with same desired opens/resolves nothing). Dedup key: `type + "|" + target`.
- Produces `listSituations({includeResolved=false}) -> rows`.

- [ ] **Step 1: Write failing test** — insert desired [A], reconcile → opened [A]; reconcile same → nothing; reconcile [] → resolved [A]; `listSituations()` returns only open. (Use a unique target to avoid cross-test collisions, per the Phase-1 flaky-test lesson.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `reconcileSituations` (SELECT open rows, diff against desired by `type|target`, INSERT new / UPDATE resolved_at) + `listSituations`. Store `detail` as JSON string. Return opened/resolved for the caller to notify.
- [ ] **Step 4: Run, verify pass (run suite ≥5×, must be deterministic).**
- [ ] **Step 5: Commit** — `feat(situations): reconcile open/resolved lifecycle`

---

### Task 4: Wire into the health tick + notify

**Files:** Modify `server/index.js` (health tick ~line 2604, after `sampleAndStore`); Modify `server/situations.js` (a `collectSituationInputs()` that gathers host+sites+deploys — reuses `fleetOverview()` + a deploy-queue read).

**Interfaces:** Consumes `fleetOverview` (Phase 1), `reconcileSituations`, `evaluateSituations`, `notifyOwner`, `recordSystem`.

- [ ] **Step 1** Add `collectSituationInputs()` to situations.js: `{ host, sites }` from `fleetOverview()`; `deploys` from a host `runOnHost` query of `application_deployment_queues` (status in_progress/queued + `age`) OR reuse an existing deploy read if present — read the codebase; if none, a small `runOnHost` psql like the ops runbooks use. (Best-effort; empty on failure.)
- [ ] **Step 2** In the health tick, after the metrics block, add a best-effort block:
```javascript
try {
  const desired = evaluateSituations(await collectSituationInputs());
  const { opened } = reconcileSituations(desired, new Date().toISOString());
  for (const s of opened) {
    recordSystem("situation.opened", { resourceType: s.target === "host" ? "host" : "application", resourceUuid: s.target, metadata: { type: s.type, severity: s.severity } });
    if (s.target !== "host") notifyOwner(s.target, { type: "situation", message: `${s.type} (${s.severity})` });
  }
} catch (e) { console.error("situations:", e.message); }
```
- [ ] **Step 3** Manual/integration check: no unit test for the tick; verify `node --check server/index.js` and that `collectSituationInputs` is covered by a focused test with a stubbed `fleetOverview` (inject via param for testability — pass `fleetOverview` as an optional arg defaulting to the real one).
- [ ] **Step 4: Commit** — `feat(situations): evaluate + notify on the health tick`

---

### Task 5: Routes + applyRemediation + MCP

**Files:** Modify `server/situations.js` (`applyRemediation`), `server/index.js` (2 routes), `mcp/server.js` (2 tools), `docs/api.md`.

**Interfaces:**
- Produces `applyRemediation(situationId, actor) -> {ok, result}` — looks up the situation, finds its `suggested_remediation` in `REGISTRY`, executes: for `command==="coolify-restart"` route through the existing control_service restart of `situation.target`; else `runOnHost(REGISTRY[id].command)` (fixed template). Writes `remediation_log`. Never interpolates situation data into the command.
- `GET /api/situations` (admin) → `{ situations: listSituations({includeResolved}) }`.
- `POST /api/situations/:id/remediate` (admin) → `applyRemediation(id, req.user.email)`.

- [ ] **Step 1** Test `applyRemediation` with a stubbed runner (inject `runOnHost`): asserts it runs the REGISTRY command for the situation's suggested id, writes a `remediation_log` row with `actor`, and REFUSES if the situation has no `suggested_remediation` (returns `{ok:false}` — no command run).
- [ ] **Step 2** Run, verify fail.
- [ ] **Step 3** Implement `applyRemediation` + the two routes (admin-gated, `h()` wrapper, demo-safe: in demo return a canned `{ok:true, demo:true}`).
- [ ] **Step 4** MCP: `list_situations` → `GET /api/situations`; `run_remediation` (input `{ id }`) → `POST /api/situations/:id/remediate`. Doc both in `docs/api.md`.
- [ ] **Step 5** Verify: `node server/test_fleet_routes.mjs` extended to GET `/api/situations` (demo) → 200 + array; MCP `tools/list` shows both new tools.
- [ ] **Step 6: Commit** — `feat(situations): remediate route + list + MCP tools`

---

### Task 6: Situations panel on the Fleet dashboard

**Files:** Modify `client/src/lib/api.js` (`situations`, `remediateSituation`), `client/src/pages/Fleet.jsx`.

- [ ] **Step 1** api.js: `situations: () => req("/situations")`, `remediateSituation: (id) => req(`/situations/${id}/remediate`, { method: "POST" })`.
- [ ] **Step 2** Fleet.jsx: fetch situations alongside the overview (same 15s refresh); render a panel ABOVE the host gauges — each open situation as a row: severity chip (crit=red/warn=amber), `type` + `detail`, and when it has a `suggested_remediation` an **"Apply fix"** button (shows the registry `title`) that calls `remediateSituation(id)` with a confirm dialog (reuse `ConfirmDialog`/`ConfirmDelete` from components) and a busy state; on success re-load. If no open situations, render nothing (or a small "All clear").
- [ ] **Step 3** `npm run build` must pass; re-read to confirm the panel guards empty/loading and the Apply button only shows when `suggested_remediation` is set.
- [ ] **Step 4: Commit** — `feat(fleet): situations panel with one-click suggested fixes`

---

## Self-Review

**Spec coverage (Phase 2 scope of the design doc):** situation rules (disk/mem/unhealthy/zombie-deploy/pileup) → T2; open/resolve lifecycle + notify → T3/T4; suggested fixes + one-click apply + audit log → T2 registry/T5 applyRemediation+route/T6 UI; MCP list+remediate → T5; reuse Notifications + Fleet dashboard → T4/T6. **Auto-remediation explicitly deferred to Phase 3** — no `auto` path on the tick (constraint enforced in T2 registry test + T4 wiring).

**Placeholder scan:** T4's `collectSituationInputs` deploy-read is the one "read the codebase for an existing helper, else small runOnHost psql" adaptation point — concrete fallback given (the ops-runbook psql form), not a blank.

**Type consistency:** situation shape `{type,target,severity,detail,suggested_remediation}` is produced by `evaluateSituations` (T2), persisted/returned by `reconcileSituations`/`listSituations` (T3), consumed by the route/MCP (T5) and UI (T6) identically. `REGISTRY[id].command` consumed only by `applyRemediation` (T5). `reconcileSituations(desired, nowIso)` signature matches its T4 caller.
