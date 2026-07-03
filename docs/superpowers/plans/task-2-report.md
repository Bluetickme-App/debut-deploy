# Task 2: DB Helpers for Projects & Environments — Completion Report

## Summary
Successfully implemented all org-scoped DB helper functions for project and environment CRUD operations, following the exact specifications in the plan. All 6 tests pass, and existing migration tests confirm no regression.

## What Was Done

### Step 1: Created Test File
Created `server/test_projects_db.mjs` with 6 test cases covering:
- Project creation with slug generation and org-scoped uniqueness
- Cross-org project name sharing (allowed)
- Org-scoped project visibility (cross-org access returns undefined)
- Environment creation with org ownership validation (404 for foreign projects)
- Idempotent default project/environment creation
- Environment → project → org resolution chain

### Step 2: Verified Test Failure
```bash
node --test server/test_projects_db.mjs
```
Result: 6 failed tests with "db.createProject is not a function" (expected).

### Step 3: Implemented Helpers
Appended the following functions to `server/db.js` (after existing org/membership helpers):

**Helper functions:**
- `createProject(orgId, name)` — Slugifies, enforces UNIQUE(org_id, slug) with 409 conflict error
- `listProjects(orgId)` — Returns sorted projects by org
- `getProject(orgId, id)` — Org-scoped single lookup
- `renameProject(orgId, id, name)` — Updates name and slug within org scope
- `deleteProject(orgId, id)` — Org-scoped delete
- `createEnvironment(orgId, projectId, name)` — Validates project ownership (404 if not found)
- `listEnvironments(projectId)` — Returns environments, production first
- `renameEnvironment(orgId, envId, name)` — Org-scoped rename via project lookup
- `deleteEnvironment(orgId, envId)` — Org-scoped delete via project lookup
- `getEnvironmentWithOrg(envId)` — Resolves env → project → org in single query
- `ensureDefaultProjectEnv(orgId)` — Idempotent creation of Default/Production (used by first-login)

**Internal utilities:**
- `notFound()` — Helper to create 404 errors with `{ status: 404 }` shape
- `uniqueProjectSlug()` — Generates unique project slugs with `-2`, `-3` suffixing (for backfill)
- `uniqueEnvSlug()` — Generates unique environment slugs (for auto-suffixing on create)

### Step 4: Verified Tests Pass
```bash
node --test server/test_projects_db.mjs
```
Result: **PASS — all 6 tests** ✓

### Step 5: Verified No Regression
```bash
node --test server/test_projects_migration.mjs server/test_orgs_migration.mjs
```
Result: **PASS — all 9 tests** (5 projects migration + 4 orgs migration) ✓

### Step 6: Committed Changes
```bash
git commit -m "feat(db): project/environment CRUD helpers (org-scoped)"
```
Commit: `e3b6e5b`

## Test Results Summary

### Task 2 Tests (server/test_projects_db.mjs)
```
✓ createProject slugifies and is org-unique-scoped
✓ createProject in a different org with the same name is allowed
✓ getProject is org-scoped (another org's project is invisible)
✓ createEnvironment rejects a project outside the caller's org
✓ ensureDefaultProjectEnv is idempotent
✓ getEnvironmentWithOrg resolves env → project → org
```

### Full DB Test Suite (migrations included)
```
✓ every user gets exactly one owner membership (orgs migration)
✓ resource_ownership rows are backfilled with the owner's org_id (orgs migration)
✓ org slug derives from name, falls back sanely (orgs migration)
✓ no ownership row left without an org (orgs migration)
✓ creates a Default project + Production environment for the org (projects migration)
✓ places every owned resource into Production and never leaves one unplaced (projects migration)
✓ naive kind: application → web_service, database → postgres (projects migration)
✓ kind CHECK rejects an invalid value (projects migration)
✓ deleting a project cascades environments and unplaces (not deletes) its resources (projects migration)
```

Total: **15 tests pass, 0 fail**.

## Deviations from Plan
None. Implementation follows the plan exactly:
- All function signatures match spec
- All org-scoping constraints enforced
- All error handling (404 for foreign resources) in place
- Idempotency for ensureDefaultProjectEnv verified

## Notes
- The migration for user_version 18 (projects/environments + kind + backfill) was already in place from Task 1
- All functions use `nowIso()` helper already defined in db.js
- Used existing `slugify()` function for slug generation
- Error objects use the `{ status: 404 }` shape expected by placement service (Task 4)
- The `uniqueProjectSlug()` and `uniqueEnvSlug()` helpers are internal; external callers get 409 on slug conflict (createProject) or auto-suffix on create (createEnvironment)

## Files Modified
- `server/db.js` — Added 11 export functions + 3 internal helpers
- `server/test_projects_db.mjs` — Created new test file

## Ready for Task 3

The DB helpers are complete and tested. Task 3 (deriveResourceKind) can proceed independently.

## Fix pass

Applied three targeted review fixes to `server/db.js`:

### Fix 1: renameProject slug collision 409

Changed `renameProject` from arrow function to regular `function` and added pre-check: if another project in the same org already has the target slug (excluding the project's own id), throws `Object.assign(new Error("A project with that name already exists"), { status: 409 })`. Query uses `SELECT 1 FROM projects WHERE org_id = ? AND slug = ? AND id != ?` to allow renaming to the project's current name (no collision with itself).

### Fix 2: listEnvironments guard comment

Added comment immediately before `listEnvironments` function:

```js
// NOTE: not org-scoped by design — callers MUST gate with getProject(orgId, projectId) first (buildProjectDetail does). Never call with an untrusted projectId.
```

### Fix 3: delete unused uniqueProjectSlug

Removed the entire `function uniqueProjectSlug(orgId, base) {...}` definition. Dead code confirmed: `createProject` rejects on collision inline and `ensureDefaultProjectEnv` hardcodes the `'default'` slug. Kept `uniqueEnvSlug` (used by `createEnvironment`).

### Test added to server/test_projects_db.mjs

Added test case verifying Fix 1:

```js
test("renameProject rejects a name that collides with another project in the org (409)", () => {
  const org = newOrg("prc@x.com");
  const a = db.createProject(org, "Alpha");
  const b = db.createProject(org, "Beta");
  assert.throws(() => db.renameProject(org, b.id, "Alpha"), (e) => e.status === 409);
  // renaming to its own current name is fine (no collision with itself)
  assert.doesNotThrow(() => db.renameProject(org, a.id, "Alpha"));
});
```

### Test command and results

```bash
node --test server/test_projects_db.mjs
```

Result: **PASS — 7 tests** (6 existing + 1 new covering Fix 1)

```bash
node --test server/test_projects_migration.mjs server/test_orgs_migration.mjs
```

Result: **PASS — 9 tests** (migrations verify no regression)

Commit: `5aa6af6` ("fix(db): renameProject 409 on slug collision; drop dead helper; guard comment")
