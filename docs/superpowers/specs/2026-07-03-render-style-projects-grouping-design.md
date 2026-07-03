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
  org_id      INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL,           -- normalised lowercase; used for routing
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE(org_id, slug)                    -- slug uniqueness also gives case-insensitive names
);

CREATE TABLE environments (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  UNIQUE(project_id, slug)
);

-- resource_ownership (existing) gains (via table rebuild so the FK action + CHECK stick;
-- SQLite ALTER ADD COLUMN can't add ON DELETE / CHECK to an existing table cleanly):
--   environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL   -- nullable
--   kind TEXT NOT NULL DEFAULT 'web_service'
--     CHECK (kind IN ('web_service','background_worker','cron_job','static_site','postgres','key_value'))
```

- **`slug`** is the routing key (`/projects/aurora-travel`), normalised to lowercase
  `[a-z0-9-]`. Uniqueness is on `(org_id, slug)` / `(project_id, slug)`, which also prevents
  case-only-different names ("Production" vs "production"). `id` remains the real identifier.
- `org_id` on `resource_ownership` stays the authorization field, unchanged. A resource's
  `environment_id` MUST resolve (env → project → org) to that same `org_id`; enforced by the
  placement service (below), never by ad-hoc SQL.
- **FK actions (with `PRAGMA foreign_keys = ON` on every connection):** deleting a project
  `ON DELETE CASCADE`s its environments; a resource whose environment is deleted has its
  `environment_id` set to `NULL` (`ON DELETE SET NULL`) — the resource is never deleted.
- **Deferred (noted, not built in phase 1):** `archived_at` soft-delete (hard delete is
  already non-destructive to resources; add if project-delete regret appears) and
  `display_order` (phase 1 sorts Production-first then alphabetical).

## Placement service (single writer)

All `environment_id` writes go through ONE function — routes, import flows, admin actions,
and the backfill all call it; no route issues `UPDATE resource_ownership SET environment_id`
directly (that is where IDOR/consistency bugs creep in):

```
placeResourceInEnvironment({ callerOrgId, resourceUuid, environmentId })
  1. assertOwns(callerOrgId, resourceUuid)                    -- caller owns the resource
  2. env = getEnvironmentWithProject(environmentId)
  3. if !env || env.project.org_id !== callerOrgId → 404      -- target env is in caller's org
  4. UPDATE resource_ownership SET environment_id = env.id WHERE coolify_uuid = resourceUuid
```

`environmentId: null` (unplace) is allowed only for admins or the deleted-environment
fallback — never a normal customer move.

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

Two separate, idempotent migrations — the generic backfill must not bake in a named
customer:

- **`00N_backfill_default_project_environment`** (generic): per org that owns resources,
  create a **"Default"** project + **"Production"** environment if absent, set
  `environment_id` to that env for every owned resource still `NULL`, and populate `kind`
  via the derivation table. After this, every existing resource is *placed* — `NULL` is
  reserved for the deleted-environment fallback only.
- **`00N+1_seed_known_customer_projects`** (fixture, separate, skippable): seed billal's
  four resources into an **"Aurora Travel"** project (Production). Environment-specific,
  idempotent, safe to skip; never part of the generic migration.

Then customers reorganise in the UI.

## API

All org-scoped; non-admins only ever see/act on their own org's projects. Tenant mismatch
(unknown resource, project, environment, or a foreign target env) returns **404** — never
leak whether another org's id exists.

- `GET /api/projects` · `POST /api/projects` — list / create.
- `GET /api/projects/:projectId` · `PATCH` · `DELETE`.
- `GET /api/projects/:projectId/environments` · `POST` (create under a project).
- `PATCH /api/environments/:environmentId` · `DELETE`.
- `PATCH /api/resources/:resourceId/placement { environmentId }` — via the placement
  service. **Replaces** `POST /api/services/:id/move` and `/api/databases/:id/move`, which
  are removed from the customer UI. `resourceId` is the coolify_uuid.
- **Admin mutations require an explicit `orgId`** in the body when creating/placing on a
  customer's behalf — admin bypass must be deliberate, never implicit cross-org.

`GET /api/projects/:id` returns a **Render-shaped** payload with an empty array per kind
(so the UI renders every category consistently):

```json
{
  "project": { "id": 1, "name": "Aurora Travel", "slug": "aurora-travel" },
  "environments": [
    { "id": 10, "name": "Production", "slug": "production",
      "resourcesByKind": {
        "web_service": [], "background_worker": [], "cron_job": [],
        "postgres": [], "key_value": [], "static_site": []
      } }
  ]
}
```

The existing admin-only `GET /api/projects` (Coolify projects) is repurposed to the panel
projects above. **Audit its two consumers first** — `client/src/lib/api.js` and
`client/src/pages/Projects.jsx` (both rewritten by this work) — then remove the Coolify
`moveToProject`/`listProjects` paths from the customer surface.

## UI (Render-matched)

- **`/projects`** — the org's projects as cards with resource counts; **New Project**.
  `Projects` becomes the primary nav home; **Services** and **Infrastructure** stay but are
  **demoted** to operational "all my resources" indexes (All Web Services / Workers /
  Databases / Key Value).
- **`/projects/:slug`** — **Environment tabs** (Production, …, **+ New Environment**).
  Within the active tab, resources render in **kind sections** (*Web Services · Background
  Workers · Cron Jobs · Databases · Key Value*), each a labelled group of cards with
  per-resource **Move** and an **Add resource** affordance. Empty kinds render as empty
  sections (payload guarantees the arrays).
- **Empty state:** a new org is created with **Default → Production** already present (on
  org creation / first login) so the Projects page is never a blank slate — it shows
  Default/Production with "No resources yet" + New Web Service / New Database / Import.
- **Move modal is project-first:** choose **Project**, then **Environment** (envs only make
  sense inside a project) — not a flat env list.
- **Import / New flows default silently** to **Default / Production**, but show a
  project + environment selector with those preselected, so organised users can place
  correctly and new users can ignore it.

## Build order (for the plan)

1. **DB + service layer:** migrations (tables, `environment_id`, `kind`), project/env
   repository fns, `placeResourceInEnvironment()`, `deriveResourceKind()`, backfill +
   tests.
2. **API:** project/env CRUD, `GET /projects/:id` (grouped), placement route; retire the
   Coolify move routes from the customer surface (after the consumer audit).
3. **UI:** `/projects`, `/projects/:slug` with env tabs + kind sections, move modal,
   project/env selectors in import/create.

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

- Per-environment shared env vars (Render "environment groups") — out of scope here; the
  panel already has `sharedvars`/variable-groups that can later bind to an environment.
- Whether `archived_at` soft-delete replaces hard project-delete — deferred (see data
  model); revisit if accidental project deletes become a support issue.

## Review amendments folded in (2026-07-03)

`slug` routing keys (+ case-insensitive uniqueness), `updated_at`, explicit `ON DELETE`
actions + `PRAGMA foreign_keys=ON`, single `placeResourceInEnvironment()` writer with
both-side org validation, `kind NOT NULL + CHECK`, separate customer-seed migration,
admin-explicit-`orgId`, Render-shaped grouped response, and UI empty-state / project-first
move / demoted flat pages / default-with-selector. Deferred: `archived_at`, `display_order`.
Kept `/api/projects` (repurposed) over a new `/api/panel` namespace, with a consumer audit.
