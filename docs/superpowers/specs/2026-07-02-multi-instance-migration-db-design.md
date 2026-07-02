# Multi-instance project migration + real Postgres migration

**Date:** 2026-07-02 · **Status:** approved (design)

## Goal
Migrate a whole Render project — multiple services + a database — in one pass,
with a real Postgres data migration into a **target the operator picks** (an
existing Coolify Postgres, or a freshly provisioned one).

## Decisions (approved)
- **DB target = pick/reuse.** The importer shows existing Coolify Postgres
  instances; operator chooses one, or "create new" (provision), or "none".
- **Real `pg_dump`/restore mechanism = `docker run --rm postgres:18`.** Version-
  matches Render's PG18, needs no host pg tooling. Runs
  `pg_dump "$SRC" | psql "$TGT"` with URLs passed via env (never argv), both
  validated by `assertPgUrl`. Requires the Docker socket available to the server
  process — clear actionable error if absent. (Deploy prerequisite; live-verify
  once RENDER_API_KEY + socket are in place.)

## Server changes
1. `migrate.js`
   - `migratePostgres({ source, target })` — real impl: `assertPgUrl(source)` +
     `assertPgUrl(target)`, then `runDumpRestore` via `docker run postgres:18`.
     Demo/no-target → skip. Returns `{ ok }` or throws with an actionable message.
   - `importFromRender(...)` gains `dbTarget` in `target`:
     `{ mode: "existing"|"new"|"none", uuid? }`. Resolve the target connection URL
     (existing → Coolify DB `internal_db_url`; new → provision a Coolify Postgres;
     none → skip). After restore, set `DATABASE_URL` on the migrated app to the
     **target** URL (never the Render source).
2. New route `POST /api/import/render/project` (admin) — body
   `{ apiKey, services: [renderServiceId…], target: { mode, serverType?, location?, dbTarget } }`.
   Loops `importFromRender` per selected service, sharing one `dbTarget`; returns
   `{ results: [{ renderServiceId, ok, appUuid, steps }] }`. Single-service route
   stays for back-compat.
3. DB-target list reuses existing `GET /api/databases`.

## Client (`ImportRender.jsx`)
- Multi-select checkboxes on the service list (migrate several at once).
- A "Database target" control: dropdown of existing Coolify Postgres (from
  `api.databases()`) + "Create new" + "No database". Passed as `target.dbTarget`.
- Per-service step results in the report (reuse the existing StepBadge list).

## Testing
- `migratePostgres` refuses a non-postgres `source` OR `target` (assertPgUrl on
  both) — unit test with a spy for the docker spawn (assert it's NOT called when a
  URL is invalid, and that a valid pair builds the expected env-passed command).
- `importFromRender` DB-target resolution: existing uuid → resolves internal url;
  none → migrate-db skipped; new → provision path invoked (mocked deps).
- Multi route loops per service (mocked importFromRender).

## Out of scope / follow-up
- Env-group migration as a unit (Render env groups → shared vars) — later.
- Live verification of the actual dump/restore (needs RENDER_API_KEY + Docker
  socket mounted into the DebutDeploy container).
