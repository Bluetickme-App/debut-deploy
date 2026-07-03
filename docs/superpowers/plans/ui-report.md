# Projects UI — implementation report

**Date:** 2026-07-03

## Files changed

| File | Action |
|---|---|
| `client/src/lib/projects.jsx` | Rewrite: sources projects from `api.projects()` instead of deriving from services |
| `client/src/pages/Projects.jsx` | Rewrite: real project cards + New Project modal → `api.createProject` |
| `client/src/pages/ProjectDetail.jsx` | Rewrite: environment tabs, kind sections, move modal, rename/delete |

## How the join works

`ProjectDetail` fires `Promise.all([api.project(id), api.services(), api.databases()])` in parallel. The `api.project(id)` payload gives `environments[].resourcesByKind[]` entries as `{ coolify_uuid, type, kind }` (no name/status/domain). Services and databases are fetched flat. Two lookup maps (`svcMap[uuid]`, `dbMap[uuid]`) are built; each resource stub is spread-merged with the rich entry before rendering. Missing entries (uuid not yet in the flat lists) render with `name: undefined` → falls back to the uuid, and `status: "unknown"`.

## Switcher compatibility

`ProjectProvider` now exports the same shape `{ projects, activeId, activeProject, setActive, addProject }`. `App.jsx`'s `ProjectSwitcher` reads only `projects[].name`, `projects[].color`, `projects[].id`, and `activeProject.name` / `activeProject.color` — all preserved. `color` is computed client-side via the existing `colorFor(name)` hash (same PALETTE). The `FALLBACK` constant prevents a crash on empty API. `addProject` is now async (calls API then refreshes); the switcher's "New project" button navigates to `/projects` so it never calls `addProject` directly — no breakage.

## `npm run build` output

```
✓ 1611 modules transformed.
dist/assets/index-TTGhmyAN.js   436.24 kB │ gzip: 116.85 kB
✓ built in 2.98s
```

Clean, zero warnings.

## Deviations / gaps

- **Resource count on project cards**: fetches `api.project(id)` per card (N+1). Acceptable for the typical handful of projects. Add a `?counts=1` server aggregation when N grows.
- **`api.createProject` response shape**: `addProject` in `projects.jsx` tries both `proj.id` and `proj.project?.id` to handle either a flat or nested response shape from the backend.
- **Rename/delete environment**: not built (not in spec for this phase — only project-level rename/delete and environment *creation* were in scope).
- **Static site / cron job creation**: kind sections render but show "None" — correct per spec (phase 2).
- **`placeResource` type arg**: derived from `kind` — `postgres`/`key_value` → `"database"`, everything else → `"application"`. Matches the `api.js` signature `placeResource(type, id, environmentId)`.
