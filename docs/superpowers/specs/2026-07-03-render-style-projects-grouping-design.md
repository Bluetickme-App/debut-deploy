# Render-style Projects / Environments grouping — design

- **Date:** 2026-07-03
- **Status:** Approved (design); implementation plan pending
- **Owner:** DebutDeploy panel

## Problem

DebutDeploy has two disconnected grouping layers:

- **Coolify projects** (`deploy-7`, `customer-apps`, …) are *global* to the operator's
  Coolify account. The panel deliberately hides them from customers
  (`visibleProjects` returns `[]` for non-admins) so one tenant never sees another's.
- **DebutDeploy orgs** (`resource_ownership.org_id`) are the real tenant boundary. A
  customer logs in and sees a **flat list** of their org's resources. There is no
  org→project mapping.

So the customer view is just "my org's services, flat", which doesn't reflect how a
Render user organises work. We want the panel — a Render-style control panel — to own a
customer-facing grouping hierarchy that matches Render, independent of Coolify's own
(global, leak-prone) project structure.

## Model (matches Render)

```
Org (tenant / login boundary — already exists; authorization pivot)
 └─ Project              customer-created, named (e.g. "Aurora Travel")
     └─ Environment      Production, Staging, … (default "Production")
         └─ Resources    shown grouped by kind:
                          Web Services · Background Workers · Cron Jobs · Databases · Key Value
```

Worked example — billal becomes Project **Aurora Travel** → env **Production** → web
service + background worker + Postgres + Key Value/Redis (+ backup cron later).

An org has many projects; a project has many environments; a resource sits in exactly
one environment (or is unplaced → shown under a Default project until moved).

## Chosen approach: panel-native tables

The hierarchy lives entirely in the panel DB as **panel-only metadata**. Coolify stays a
flat execution layer; we never read/write Coolify's own projects/environments for this
feature. Rationale: Coolify projects are global (cross-tenant leakage + name collisions),
its project API is awkward, and the panel already owns tenancy via `org_id`. This is the
"panel-only metadata" decision from brainstorming.

Rejected: mirroring Coolify's native project/environment as source of truth (re-introduces
the coupling and leakage we're removing).

## Data model (SQLite, panel DB)

```sql
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES orgs(id),
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE(org_id, name)
);

CREATE TABLE environments (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE(project_id, name)
);

-- resource_ownership (existing) gains:
ALTER TABLE resource_ownership ADD COLUMN environment_id INTEGER REFERENCES environments(id); -- nullable
ALTER TABLE resource_ownership ADD COLUMN kind TEXT;  -- render-style display kind (see below)
```

- `org_id` on `resource_ownership` stays the authorization field, unchanged. A resource's
  `environment_id` MUST resolve (env → project → org) to that same `org_id`; enforced in
  app logic on placement.
- Deleting a project cascades to its environments; resources in a deleted environment fall
  back to `environment_id = NULL` (unplaced), never deleted.

### `kind` derivation

`kind ∈ { web_service, background_worker, cron_job, static_site, postgres, key_value }`.
Derived once at import/create, editable later:

| Source signal | kind |
|---|---|
| Coolify database, image `postgres*` | `postgres` |
| Coolify database, image `redis*`/`keydb*`/`dragonfly*` | `key_value` |
| Coolify application, build pack `static` | `static_site` |
| Coolify application, no HTTP port / worker-style start cmd | `background_worker` |
| Coolify application, otherwise | `web_service` |
| (reserved, phase 2) | `cron_job` |

The by-type view groups resources by `kind`. Storing it explicitly (vs deriving live)
keeps the grouping stable and lets the UI show all Render categories now, before we build
crons/static as deployable kinds.

## Backfill (existing resources)

Idempotent migration, per org that owns resources:

1. Create a **"Default"** project + **"Production"** environment if absent.
2. Set `environment_id` to that Production env for every owned resource with a NULL
   `environment_id`.
3. Populate `kind` for existing rows via the derivation table.

Then customers reorganise in the UI. As the worked example, seed billal's four resources
into an **"Aurora Travel"** project (Production) instead of Default.

## API

All org-scoped; non-admins only ever see/act on their own org's projects (IDOR guard by
resolving project→org and comparing to the caller's org, mirroring `assertOwns`).

- `GET/POST/PATCH/DELETE /api/projects` — CRUD projects.
- `GET/POST/PATCH/DELETE /api/projects/:id/environments` — CRUD environments.
- `GET /api/projects/:id` — project + its environments + resources grouped by `kind`.
- `PATCH /api/resources/:id/placement { environmentId }` — move a resource between
  environments/projects. **Replaces** the Coolify-backed `POST /api/services/:id/move`
  and `/api/databases/:id/move`, which are removed from the customer UI. (`resource id`
  is the coolify_uuid; the route validates ownership + that the target env is in the
  caller's org.)

The existing admin-only `GET /api/projects` that returned Coolify projects is repurposed
to the panel projects above; Coolify's own project list is no longer surfaced.

## UI (Render-matched)

- **`/projects`** — the org's projects as cards, with counts; **New Project** button.
- **`/projects/:id`** — **Environment tabs** across the top (Production, …, **+ New
  Environment**). Within the active tab, resources are rendered in **kind sections**:
  *Web Services · Background Workers · Cron Jobs · Databases · Key Value*, each a labelled
  group of resource cards, with per-resource **Move** (to another env/project) and an
  **Add resource** affordance.
- The existing flat **Services** and **Infrastructure** pages remain as quick "all my
  resources" views; **Projects** becomes the organised home. Import / New-service flows
  gain a project + environment selector (defaulting to Default/Production).

## Isolation & security

- Every project/environment/placement route resolves ownership to the caller's `org_id`
  and rejects mismatches with 404 (same pattern as `assertOwns`) — no cross-tenant reads
  or moves, no leaking another org's project/env by guessing an id.
- Admins retain the global view.

## Testing

- Migration test: fresh + populated DB → backfill creates Default/Production, places
  resources, sets `kind`; idempotent on re-run.
- `kind` derivation unit test over the signal table (each row → expected kind).
- Ownership/isolation: a user in org A cannot GET/move into org B's project/env (404);
  placement into a foreign env is rejected.
- Placement: moving a resource updates `environment_id`; deleting a project nulls its
  resources' `environment_id` (not the resources).

## Scope / phasing

- **This spec (phase 1):** projects + environments + placement + backfill + the
  Render-matched project/env/by-type UI, over today's resource kinds
  (services → web_service/background_worker, databases → postgres/key_value). Move between
  projects/envs. `/move` → placement swap.
- **Later (own specs):** `cron_job` and `static_site` as *deployable* kinds (schedule /
  run / logs, static build); **preview environments**. The `kind` enum and the
  environments layer already reserve their slots, so phase 1 doesn't block them.

## Open items

- Whether Import/New flows should *require* choosing a project or default silently to
  Default/Production (leaning: default silently, editable after).
- Per-environment shared env vars (Render "environment groups") — out of scope here;
  the panel already has `sharedvars`/variable-groups that can later bind to an environment.
