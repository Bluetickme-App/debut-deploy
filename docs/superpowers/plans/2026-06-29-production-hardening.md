# Production Hardening Implementation Plan (for 20-site migration)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Add the code-shippable features that make DebutDeploy safe for ~20 production sites: per-app resource limits, rollback, health checks, metrics, persistent disks, shared env, database backups, and first-class service types.

**Architecture:** Thin control plane over Coolify v4.1.2. Each feature's Coolify calls go in a **new focused server module** (parallel-safe, distinct files); a single integration agent wires routes into `server/index.js`; the UI is split by **page ownership** (ServiceDetail / Databases / NewService / a new SharedVars page) so parallel agents don't collide.

**Tech Stack:** Node 22 ESM, Express, better-sqlite3, React+Vite, Tailwind v4. Tests: `node:test` with `DATABASE_FILE=':memory:'` + dynamic import. Coolify API base `${COOLIFY_BASE_URL}/api/v1`, Bearer `COOLIFY_API_TOKEN`.

## Global Constraints

- ESM only; match existing patterns in `server/coolify.js` (the `cf()` helper, `isDemo()` branch on every method) and `server/index.js` (`h()` wrapper, `requireAuth`, `requireAdmin`, `mutateGuard`, `assertOwns` before any Coolify call, ownership assigned only after success).
- New server modules import `isDemo` from `./coolify.js` and define a local `cf()` (copy the pattern from `lifecycle.js`). Every method has an `isDemo()` fixture branch.
- Routes: `requireAuth` always; `mutateGuard` on writes; `assertOwns(req.user, type, id)` for any resource-scoped call; never trust client-supplied uuids without an ownership check.
- Tests use `node:test`; set `process.env.DATABASE_FILE=':memory:'` before importing `db.js`.
- **Verify Coolify payload shapes against the live instance** (`http://167.233.206.184:8000`) before finalizing — Coolify's field names (snake_case) must be confirmed; don't ship guessed field names. Use the API token in `server/.env`.
- UI: compose existing `ui.jsx` components + CSS-var tokens; no hardcoded colors; keep light/dark working.

## Prerequisites (NOT agent tasks — owner action required)

- **P1 — Capacity:** the current CX22 (2 vCPU/4 GB) is too small for 20 sites. Provision a larger Hetzner server (CX42/CX52 or dedicated) or plan multi-server. *Blocker for migration, not for this code.*
- **P2 — S3 bucket + creds** for database backups (Task 7 stores config but needs a real bucket).
- **P3 — Domain + public hosting** of DebutDeploy itself (separate Phase-3 effort; OAuth needs https).
- **P4 — Notifications:** Coolify's deploy/health alerts are team-level settings — configure email/Slack in Coolify directly (not built here).

---

### Task 1: Resource limits + health check + metrics module (`server/resources.js`)

**Files:** Create `server/resources.js`, `server/test_resources.mjs`.

**Interfaces (Produces):**
- `setLimits(uuid, { memory, cpus })` → PATCH `/applications/{uuid}` with `limits_memory` (e.g. `"512M"`) and `limits_cpus` (e.g. `"0.5"`). Validate non-empty; demo → `{ ok:true, memory, cpus }`.
- `setHealthcheck(uuid, { enabled, path, port })` → PATCH `/applications/{uuid}` with `health_check_enabled`, `health_check_path`, `health_check_port`. demo → `{ ok:true }`.
- `getResourceUsage(serverUuid)` → GET `/servers/{serverUuid}/resources` → `{ cpu, memory, disk }` (numbers/percent; tolerate missing). demo → fixture `{ cpu:12, memory:34, disk:21 }`.

- [ ] **Step 1: Failing test** — `test_resources.mjs`: assert `setLimits` rejects empty input (status 400) and demo returns the echoed values; `setHealthcheck` demo returns ok.
- [ ] **Step 2:** Run `node --test server/test_resources.mjs` → FAIL (module missing).
- [ ] **Step 3:** Implement `server/resources.js` per Interfaces (copy `cf()`/`isDemo` pattern from `lifecycle.js`). **Verify the live PATCH field names** against Coolify before finalizing.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit `feat(server): resources module (limits, healthcheck, usage)`.

### Task 2: Rollback (extend `server/coolify.js`)

**Files:** Modify `server/coolify.js`; `server/test_rollback.mjs`.

**Interfaces (Produces):**
- `rollback(uuid, commit)` → redeploy a specific commit: POST `/deploy?uuid={uuid}&force=true` after PATCH `/applications/{uuid}` `{ git_commit_sha: commit }` — OR if Coolify exposes a direct redeploy-by-deployment endpoint, use it (verify live). demo → `{ ok:true, uuid, commit }`.
- (`listDeployments` already returns `{ uuid, commit, ... }` per deployment — rollback targets a commit.)

- [ ] **Step 1: Failing test** — demo `rollback("x","abc123")` returns `{ ok:true }`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; **verify the real rollback mechanism on the live Coolify** (commit redeploy) before finalizing.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(server): rollback to a previous commit`.

### Task 3: Persistent disks module (`server/volumes.js`)

**Files:** Create `server/volumes.js`, `server/test_volumes.mjs`.

**Interfaces (Produces):**
- `listVolumes(appUuid)` → GET app and read its volumes/persistent storage (verify field). demo → `[]`.
- `addVolume(appUuid, { name, mountPath, hostPath })` → Coolify persistent-storage create endpoint for the app (verify path; likely POST `/applications/{uuid}/storages` or similar). Validate mountPath non-empty. demo → `{ ok:true }`.
- `deleteVolume(appUuid, volumeUuid)` → delete. demo → `{ ok:true }`.

- [ ] **Step 1: Failing test** — `addVolume` rejects empty mountPath (400); demo add returns ok.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; **verify the Coolify storage endpoint live**.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(server): persistent volumes module`.

### Task 4: Shared env / env groups module (`server/sharedvars.js`)

**Files:** Create `server/sharedvars.js`, `server/test_sharedvars.mjs`.

**Interfaces (Produces):**
- `listSharedVars()` → GET `/teams/{id}/...` shared variables OR Coolify's shared-variables endpoint (verify). demo → fixture array.
- `upsertSharedVar({ key, value })` / `deleteSharedVar(uuid)`. demo → `{ ok:true }`.
- Scope: team/project-level shared variables (admin-managed). Route guard = `requireAdmin`.

- [ ] **Step 1: Failing test** — `upsertSharedVar` rejects empty key (400); demo returns ok.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; **verify Coolify shared-variables endpoint live**.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(server): shared variables module`.

### Task 5: Database backups module (`server/backups.js`)

**Files:** Create `server/backups.js`, `server/test_backups.mjs`.

**Interfaces (Produces):**
- `getBackupConfig(dbUuid)` → GET database backup settings. demo → `{ enabled:false }`.
- `setBackupSchedule(dbUuid, { frequency, s3StorageUuid })` → configure Coolify scheduled backup (cron + S3 destination). Validate frequency. demo → `{ ok:true }`.
- `triggerBackup(dbUuid)` → run a backup now. demo → `{ ok:true }`.
- Note: requires an S3 storage configured in Coolify (P2). If none, the route returns a clear 400 "Configure S3 storage first."

- [ ] **Step 1: Failing test** — `setBackupSchedule` rejects empty frequency (400); demo trigger returns ok.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; **verify Coolify backup + S3-storage endpoints live**.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(server): database backups module`.

### Task 6: Route integration (`server/index.js`)

**Files:** Modify `server/index.js`.

**Consumes:** Tasks 1–5 modules. Add routes (all `requireAuth`; writes `mutateGuard`; resource routes `assertOwns`):
- `PATCH /api/services/:id/limits` → `resources.setLimits` (assertOwns application).
- `PATCH /api/services/:id/healthcheck` → `resources.setHealthcheck`.
- `GET /api/servers/:id/usage` → `requireAdmin` → `resources.getResourceUsage`.
- `POST /api/services/:id/rollback` `{ commit }` → assertOwns → `coolify.rollback`; audit `rollback`.
- `GET/POST/DELETE /api/services/:id/volumes[/:vid]` → assertOwns → volumes.*; audit.
- `GET/POST/DELETE /api/shared-vars[/:id]` → `requireAdmin` → sharedvars.*.
- `GET/POST /api/databases/:id/backups` + `POST /api/databases/:id/backups/run` → assertOwns(database) → backups.*; audit.

- [ ] **Step 1:** Add imports (`import * as resources from './resources.js'`, etc.).
- [ ] **Step 2:** Add the routes following existing patterns (ownership before Coolify call; ownership/audit after success for creates).
- [ ] **Step 3:** Run `node --check server/index.js` and `node --test server/*.mjs` → all pass.
- [ ] **Step 4:** Commit `feat(server): wire limits/health/rollback/volumes/sharedvars/backups routes`.

### Task 7: Service detail UI (`client/src/pages/ServiceDetail.jsx`)

**Files:** Modify `client/src/pages/ServiceDetail.jsx`.

**Consumes:** routes from Task 6. Add to the Settings tab (compose `ui.jsx`):
- **Resources:** memory + CPU inputs → `PATCH /api/services/:id/limits`.
- **Health check:** enable toggle + path + port → `PATCH /api/services/:id/healthcheck`.
- **Persistent disks:** list + add (name, mount path) + delete via `/volumes`.
- In the **Deployments** tab: a **Rollback** button per past deployment → `POST /api/services/:id/rollback {commit}` (window.confirm).
- A small **metrics** strip (server usage) from `GET /api/servers/:id/usage` if admin.

- [ ] **Step 1:** Implement the sections using existing components; keep current functionality.
- [ ] **Step 2:** `npm --prefix client run build` → success.
- [ ] **Step 3:** Commit `feat(client): resources, health, disks, rollback on service detail`.

### Task 8: Databases backups UI + New Service types + Shared Vars page

**Files:** Modify `client/src/pages/Databases.jsx`, `client/src/pages/NewService.jsx`; Create `client/src/pages/SharedVars.jsx`; Modify `client/src/App.jsx` (route + nav for Shared Vars).

- Databases: a **Backups** control per DB (enable schedule + "Back up now") via `/databases/:id/backups`.
- NewService: surface **service type** (Web / Static / Worker / Cron) mapping to the build/start config (Static already maps to static build pack; Worker/Cron set the appropriate Coolify type — verify).
- SharedVars page (admin): list/add/delete shared variables via `/api/shared-vars`; add nav link (admin-only) + `/shared-vars` route.

- [ ] **Step 1:** Implement the three UI pieces composing `ui.jsx`.
- [ ] **Step 2:** `npm --prefix client run build` → success.
- [ ] **Step 3:** Commit `feat(client): backups UI, service types, shared variables page`.

---

## Parallelization map (for the swarm)
- **Wave 1 (parallel, new files):** Task 1 `resources.js`, Task 3 `volumes.js`, Task 4 `sharedvars.js`, Task 5 `backups.js`, Task 2 `coolify.js` rollback. (Task 2 touches the shared `coolify.js` — run it alone in Wave 1 or fold its small change into Task 6 to avoid contention.)
- **Wave 2 (sequential, 1 agent):** Task 6 — owns `index.js`.
- **Wave 3 (parallel, by page):** Task 7 (ServiceDetail), Task 8 (Databases + NewService + SharedVars + App.jsx). Task 8 touches multiple distinct files but only that agent touches them.
- **Wave 4:** verify (tests + build).

## Self-review notes
- Coverage vs gap analysis: limits/quotas (T1), rollback (T2), health checks (T1/T7), metrics (T1/T7), persistent disks (T3), env groups (T4), backups (T5) — all blockers/important items have a task. **Not in this plan (owner/infra):** capacity (P1), S3 bucket (P2), public hosting + domain (P3), notifications (P4), live log *streaming* (kept as fetch for now), preview envs/IaC/SSH-terminal (later).
- External-API caveat: this plan is feature-level detailed (not line-by-line TDD code) because every task integrates Coolify's live API — implementers MUST verify field names/endpoints against the running instance before finalizing, per Global Constraints.
