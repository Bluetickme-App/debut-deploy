# Task 5 Report: API routes (thin) + retire Coolify project surface

## Files changed

### Created: `server/test_projects_routes.mjs`
Verbatim from plan. Tests `buildProjectDetail` grouping and org-scoping.

### Created: `server/projectview.js`
`buildProjectDetail(orgId, projectId)` — org-scoped, returns `{ project, environments: [{ id, name, slug, resourcesByKind }] }`. All six kind keys always present (empty arrays).

### Modified: `server/index.js`
1. **db.js import** (lines 14–47): merged `ensureUserOrg`, `listProjects`, `createProject`, `getProject`, `renameProject`, `deleteProject`, `createEnvironment`, `renameEnvironment`, `deleteEnvironment` into the existing named import block.
2. **New top-of-file imports** (after `./metering.js`): added `import { placeResourceInEnvironment } from "./placement.js"` and `import { buildProjectDetail } from "./projectview.js"`.
3. **Replaced block ~495–538**: Removed `visibleProjects`, `assertKnownProject`, `POST /api/services/:id/move`, `POST /api/databases/:id/move`. Replaced with panel-native routes: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `GET/POST /api/projects/:id/environments`, `PATCH/DELETE /api/environments/:id`, `PATCH /api/resources/:type/:id/placement`, plus the `orgOf` helper.
4. **Database create route** (line ~639 orig): removed `assertKnownProject` guard (function no longer exists). The `projectUuid` param is passed through unchanged to Coolify's `createDatabase`; comment updated.

### Modified: `client/src/lib/api.js`
Replaced old `projects`/`moveService`/`moveDatabase` lines with: `projects`, `project`, `createProject`, `renameProject`, `deleteProject`, `createEnvironment`, `renameEnvironment`, `deleteEnvironment`, `placeResource`. `moveService` and `moveDatabase` removed.

## Commands run + output

### TDD step 1 — test fails before projectview.js
```
node --test server/test_projects_routes.mjs
→ FAIL: Cannot find module './projectview.js'
```

### TDD step 2 — test passes after projectview.js created
```
node --test server/test_projects_routes.mjs
→ PASS: 2/2
```

### node --check
```
node --check server/index.js
→ (no output, exit 0)
```

### Full test suite
```
node --test server/test_projects_routes.mjs server/test_projects_db.mjs server/test_placement.mjs
→ PASS: 15/15
```

### npm run build
```
npm run build
→ vite build: ✓ 1611 modules transformed, built in 2.63s (no errors)
```

## Deviations

- **`assertKnownProject` in `/api/databases` POST**: The plan said to replace the `visibleProjects`/`/move` block only, but `assertKnownProject` was also called in the database creation route. Removing the function required dropping that call. The guard is no longer needed since new databases don't get panel-placed at creation time; placement is done separately via the new `/placement` route.
- **No `Projects.jsx` changes needed**: The page uses `useProjects()` which derives from `api.services()` (unchanged), not `api.projects()`. Build was green with no modifications.
- `coolify.listProjects` and `coolify.moveToProject` remain in `coolify.js` per plan instructions.

## Fix pass

### Edits applied (commit `da6d570`)

**Fix 1 — `POST /api/databases` no longer accepts `projectUuid`**
- `server/index.js` line ~643: destructuring changed from `{ type, name, projectUuid, version }` to `{ type, name, version }`.
- `databases.createDatabase(...)` call changed from `{ type, name, projectUuid, version }` to `{ type, name, version }`.
- Old stale comment replaced with: `// projectUuid intentionally NOT accepted here — Coolify-side project is the server default; customer grouping is panel-native via PATCH /api/resources/:type/:id/placement.`

**Fix 2 — `orgOf` no longer calls `ensureUserOrg` for admins**
- `server/index.js` line ~507: helper rewritten to:
  `const orgOf = (user) => user.role === "admin" ? null : (getMembership(user.id)?.org_id ?? ensureUserOrg(user.id));`

**Fix 3 — sync annotations**
- `buildProjectDetail(orgOf(req.user), Number(req.params.id))` — trailing `// sync` added.
- `placeResourceInEnvironment({` — trailing `// sync` added.

### Command outputs

```
node --check server/index.js → SYNTAX OK

node --test server/test_projects_routes.mjs server/test_placement.mjs server/test_projects_db.mjs server/test_databases.mjs
# tests 17 / pass 17 / fail 0

npm run build → ✓ built in 2.99s (1611 modules)
```
