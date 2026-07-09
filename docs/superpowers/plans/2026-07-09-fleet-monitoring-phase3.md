# Fleet Monitoring — Phase 3 (Bounded Auto-Remediation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a SMALL allow-list of high-confidence, idempotent remediations run **autonomously** when their situation opens — gated behind an `AUTO_REMEDIATE` kill-switch (**default OFF**), rate-limited per situation with a cooldown, and fully audited. Everything else stays suggest-only (Phase 2). Targets today's two outages: auto-prune at disk-crit, auto-clear a zombie deploy.

**Architecture:** Reuse the Phase 2 situations engine end to end. Add `auto`/`confidence`/`cooldownSec` flags to the `REGISTRY`, a pure `selectAutoRemediations(...)` decision function, and a tick step that (only when enabled) calls the EXISTING `applyRemediation` for the selected situations, stamps `situations.auto_applied_at`, and notifies. No new command paths — auto reuses the same allow-listed `applyRemediation`.

**Tech Stack:** Node ESM, Express, better-sqlite3, React/Vite, `node:test`.

## Global Constraints

- ESM everywhere; reuse Phase 2's `server/situations.js` (`REGISTRY`, `applyRemediation`, `reconcileSituations`, `listSituations`, `collectSituationInputs`, `evaluateSituations`).
- **`AUTO_REMEDIATE` env kill-switch, default OFF.** When off (or unset), NOTHING auto-executes — behaviour is identical to Phase 2. Only `AUTO_REMEDIATE=true` enables the auto path.
- Auto path reuses the EXISTING `applyRemediation` (fixed REGISTRY command literals only — no new shell path, no situation/request data in commands).
- **Bounded:** each situation auto-remediates at most once (`auto_applied_at` set → never again); a per-remediation cooldown prevents thrash across situations of the same type (`remediation_log` is the source of truth for "last ran").
- Only `confidence:'high' && auto:true` registry entries are eligible. `restart-service` stays suggest-only (do NOT auto-restart customer apps). Initial auto set: `prune-docker` (disk crit), `clear-deploy-queue` (zombie deploy).
- Auto-execution is best-effort on the health tick (own try/catch; never crashes the tick).
- Every auto action writes `remediation_log` with `actor='auto'` and fires a notification ("auto-fixed X").
- Pure decision logic (`selectAutoRemediations`) is unit-tested with injected data; no DB/SSH in the pure function.

## File Structure

- `server/situations.js` — REGISTRY flags; `AUTO_REMEDIATE` read; pure `selectAutoRemediations`; `markAutoApplied`.
- `server/index.js` — extend the health-tick situations block with the auto step.
- `client/src/pages/Fleet.jsx` — show an "auto-fixed" badge on situations with `auto_applied_at`.
- `docs/api.md` / config docs — note the `AUTO_REMEDIATE` env var.
- Tests: `server/situations.test.js`.

---

### Task 1: Registry auto-flags + `selectAutoRemediations` (pure) + config

**Files:** Modify `server/situations.js`; Test `server/situations.test.js`.

**Interfaces:**
- REGISTRY gains per-entry `auto` (bool), `confidence` ('high'|'medium'), `cooldownSec`. Set `prune-docker` → `{auto:true, confidence:'high', cooldownSec:3600}`; `clear-deploy-queue` → `{auto:true, confidence:'high', cooldownSec:1800}`; `restart-service` → `{auto:false, confidence:'medium'}` (unchanged behaviourally).
- `AUTO_REMEDIATE_ENABLED` — `export const AUTO_REMEDIATE_ENABLED = process.env.AUTO_REMEDIATE === "true";` (default false).
- Produces `selectAutoRemediations(openSituations, recentLog, nowMs) -> [{situation, remediationId}]` — PURE. Returns the subset of `openSituations` where: the situation has a `suggested_remediation` whose REGISTRY entry is `auto:true && confidence:'high'`; the situation has no `auto_applied_at`; AND no `remediation_log` entry for that `action` ran within `cooldownSec` (using `recentLog = [{action, at}]` and `nowMs`). Does NOT read `AUTO_REMEDIATE_ENABLED` itself (the caller gates on that) — keep it pure and testable.

- [ ] **Step 1: Write failing tests** (add to `server/situations.test.js`):

```javascript
import { REGISTRY, selectAutoRemediations } from "./situations.js";
test("REGISTRY: only prune-docker + clear-deploy-queue are auto+high; restart-service is not", () => {
  assert.equal(REGISTRY["prune-docker"].auto, true);
  assert.equal(REGISTRY["prune-docker"].confidence, "high");
  assert.equal(REGISTRY["clear-deploy-queue"].auto, true);
  assert.notEqual(REGISTRY["restart-service"].auto, true);
});
test("selectAutoRemediations: picks auto+high with no cooldown/auto_applied", () => {
  const open = [{ id: 1, type: "host.disk", suggested_remediation: "prune-docker", auto_applied_at: null }];
  const sel = selectAutoRemediations(open, [], 1_000_000);
  assert.equal(sel.length, 1);
  assert.equal(sel[0].remediationId, "prune-docker");
});
test("selectAutoRemediations: skips within cooldown", () => {
  const open = [{ id: 1, type: "host.disk", suggested_remediation: "prune-docker", auto_applied_at: null }];
  const now = 1_000_000;
  const recent = [{ action: "prune-docker", at: new Date(now - 60_000).toISOString() }]; // 60s ago, cooldown 3600s
  assert.equal(selectAutoRemediations(open, recent, now).length, 0);
});
test("selectAutoRemediations: skips already auto_applied + skips suggest-only", () => {
  assert.equal(selectAutoRemediations([{ id:1, suggested_remediation:"prune-docker", auto_applied_at:"2026-01-01T00:00:00Z" }], [], 1e6).length, 0);
  assert.equal(selectAutoRemediations([{ id:2, suggested_remediation:"restart-service", auto_applied_at:null }], [], 1e6).length, 0);
});
```

- [ ] **Step 2: Run, verify fail** — `DATABASE_FILE=:memory: DEMO_MODE=true node --test --test-name-pattern="selectAutoRemediations|REGISTRY: only" server/situations.test.js`.
- [ ] **Step 3: Implement** the REGISTRY flags, `AUTO_REMEDIATE_ENABLED`, and `selectAutoRemediations` (pure; parse `recentLog` timestamps with `Date.parse`, compare `nowMs - lastAt < cooldownSec*1000`).
- [ ] **Step 4: Run, verify pass** (full file, ≥3× deterministic).
- [ ] **Step 5: Commit** — `feat(situations): auto-remediation registry flags + pure selector`

---

### Task 2: Auto-execute on the health tick (gated, audited, notified)

**Files:** Modify `server/situations.js` (`markAutoApplied`, a `recentRemediationLog` reader); Modify `server/index.js` (extend the tick situations block); Test `server/situations.test.js`.

**Interfaces:**
- Produces `markAutoApplied(situationId, nowIso)` — `UPDATE situations SET auto_applied_at=? WHERE id=?`.
- Produces `recentRemediationLog(sinceIso) -> [{action, at}]` — recent `remediation_log` rows (for cooldown).

- [ ] **Step 1: Test** `markAutoApplied` sets the column (a subsequent `selectAutoRemediations` with that situation returns nothing). Unique situation row.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `markAutoApplied` + `recentRemediationLog`. Then in `server/index.js`, extend the EXISTING situations tick block (added in Phase 2, after reconcile/notify) with:

```javascript
  if (AUTO_REMEDIATE_ENABLED) {
    try {
      const open = listSituations();
      const auto = selectAutoRemediations(open, recentRemediationLog(new Date(Date.now() - 6*3600_000).toISOString()), Date.now());
      for (const { situation } of auto) {
        const r = await applyRemediation(situation.id, "auto");
        markAutoApplied(situation.id, new Date().toISOString());
        recordSystem("situation.auto_remediated", { resourceType: situation.target === "host" ? "host" : "application", resourceUuid: situation.target, metadata: { type: situation.type, ok: r.ok } });
        if (situation.target !== "host") notifyOwner(situation.target, { type: "situation", message: `auto-fixed ${situation.type}` });
      }
    } catch (e) { console.error("auto-remediate:", e.message); }
  }
```
Import `AUTO_REMEDIATE_ENABLED, selectAutoRemediations, markAutoApplied, recentRemediationLog, applyRemediation, listSituations` from `./situations.js`. Keep it INSIDE the situations try/catch's sibling best-effort structure (its own try/catch). When `AUTO_REMEDIATE_ENABLED` is false the whole block is skipped — zero behaviour change vs Phase 2.

- [ ] **Step 4** `node --check server/index.js`; run the situations suite green.
- [ ] **Step 5: Commit** — `feat(situations): gated auto-remediation on the health tick (default off)`

---

### Task 3: Surface auto-applied in the UI + document the switch

**Files:** Modify `client/src/pages/Fleet.jsx`; Modify `docs/api.md` (or a config note).

- [ ] **Step 1** Fleet.jsx: for a situation with `auto_applied_at` set, render a small "auto-fixed" badge (muted/green) next to the severity chip, and suppress the "Apply fix" button (it's handled). Keep minimal.
- [ ] **Step 2** `npm run build` passes; re-read to confirm the badge only shows when `auto_applied_at` is truthy and the manual button is hidden in that case.
- [ ] **Step 3** Document `AUTO_REMEDIATE=true` (default false) in `docs/api.md`/config notes: what it enables (auto prune-docker at disk-crit, auto clear-deploy-queue at zombie), the guardrails (once per situation, cooldown, audit log), and that it's off by default.
- [ ] **Step 4: Commit** — `feat(fleet): auto-fixed badge + document AUTO_REMEDIATE switch`

---

## Self-Review

**Spec coverage (Phase 3 of the design doc):** high-confidence allow-list auto-runs (prune-docker, clear-deploy-queue) → T1 flags + T2 tick; `AUTO_REMEDIATE` kill-switch default off → T1 const + T2 gate; once-per-situation + cooldown → T1 selector (auto_applied_at + recentLog) / T2 markAutoApplied; audit + notify → T2 (`actor='auto'` via applyRemediation + recordSystem/notifyOwner); reuse allow-listed applyRemediation (no new shell path) → T2; UI surfacing → T3. `restart-service` stays suggest-only (constraint in T1).

**Placeholder scan:** none — the cooldown window (6h log lookback) and cooldownSec values are concrete.

**Type consistency:** `selectAutoRemediations(open, recentLog, nowMs) -> [{situation, remediationId}]` produced in T1, consumed in T2's tick loop (uses `.situation`). `markAutoApplied(id, nowIso)` / `recentRemediationLog(sinceIso)` signatures match their T2 callers. `auto_applied_at` column (already in the Phase 2 `situations` table) written by T2, read by T1's selector and T3's badge.
