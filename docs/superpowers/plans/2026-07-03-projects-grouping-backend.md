# Projects/Environments Grouping — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a panel-native `Org → Project → Environment → typed-resource` grouping model to DebutDeploy's backend (data model, helpers, kind derivation, placement service, thin API routes), decoupled from Coolify's own projects.

**Architecture:** SQLite migration adds `projects` + `environments` tables and `environment_id` + `kind` columns on the existing `resource_ownership`. A single `placeResourceInEnvironment()` service is the only writer of `environment_id`, validating org ownership on both sides. A pure `deriveResourceKind()` maps Coolify metadata to a Render-style kind. Express routes stay thin (per `CLAUDE.md`) and delegate to these tested functions.

**Tech Stack:** Node ESM, `better-sqlite3`, Express, `node:test` + `node:assert/strict`. Tests run with `node --test server/<file>.mjs`.

## Global Constraints

- ESM everywhere (`import`, not `require`).
- The org table is **`organizations`** (id), not `orgs`. A user's org: `getMembership(userId).org_id`.
- `resource_ownership` PK is `(type, coolify_uuid)`; `org_id` is the authorization pivot; columns through v17 are `coolify_uuid, type, user_id, created_at, org_id, plan_id, auto_deploy`.
- Migrations are appended to the `MIGRATIONS` array in `server/db.js`; index N → `user_version = N+1`. Current latest is `user_version 17` (array length 17). The new one is index 17 → **`user_version 18`**. Each migration runs in a transaction; **throw to roll back**.
- `PRAGMA foreign_keys = ON` is already set in `openDb()`; rely on FK actions.
- Tenant mismatch (unknown/foreign project, env, or resource) → **404**, never 403, never leak existence.
- `kind ∈ {web_service, background_worker, cron_job, static_site, postgres, key_value}`.
- Slugs are lowercase `[a-z0-9-]` via the existing `slugify()` in `db.js`.

---

### Task 1: Migration 18 — projects + environments + placement/kind columns + backfill

**Files:**
- Modify: `server/db.js` (append one migration to the `MIGRATIONS` array, after the `user_version 17` entry)
- Test: `server/test_projects_migration.mjs`

**Interfaces:**
- Consumes: existing `organizations`, `memberships`, `resource_ownership` tables.
- Produces: tables `projects(id, org_id, name, slug, created_at, updated_at)`, `environments(id, project_id, name, slug, created_at, updated_at)`; columns `resource_ownership.environment_id` (FK → environments, `ON DELETE SET NULL`), `resource_ownership.kind` (NOT NULL, CHECK). After migration every org-owned resource is placed in a Default/Production env; databases get `kind='postgres'`, everything else `kind='web_service'`.

- [ ] **Step 1: Write the failing test**

Create `server/test_projects_migration.mjs`:

```js
// Migration 18. Run: node --test server/test_projects_migration.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v17 DB with the tables migration 18 reads/alters, then seed an org + resources.
const file = path.join(os.tmpdir(), `dd-mig18-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE memberships (user_id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE resource_ownership (
      coolify_uuid TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('application','database','service')),
      user_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      org_id INTEGER, plan_id TEXT, auto_deploy INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (type, coolify_uuid)
    );
  `);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (1,'Acme','acme',?)").run(now);
  d.prepare("INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (1,1,'owner',?)").run(now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,created_at,org_id) VALUES ('app-1','application',1,?,1)").run(now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,created_at,org_id) VALUES ('db-1','database',1,?,1)").run(now);
  d.pragma("user_version = 17");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("creates a Default project + Production environment for the org", () => {
  const proj = db.prepare("SELECT * FROM projects WHERE org_id = 1").get();
  assert.equal(proj.name, "Default");
  assert.equal(proj.slug, "default");
  const env = db.prepare("SELECT * FROM environments WHERE project_id = ?").get(proj.id);
  assert.equal(env.name, "Production");
  assert.equal(env.slug, "production");
});

test("places every owned resource into Production and never leaves one unplaced", () => {
  const unplaced = db.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NOT NULL AND environment_id IS NULL").get().c;
  assert.equal(unplaced, 0);
});

test("naive kind: application → web_service, database → postgres", () => {
  const app = db.prepare("SELECT kind FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  const dbr = db.prepare("SELECT kind FROM resource_ownership WHERE coolify_uuid='db-1'").get();
  assert.equal(app.kind, "web_service");
  assert.equal(dbr.kind, "postgres");
});

test("kind CHECK rejects an invalid value", () => {
  assert.throws(() => db.prepare("UPDATE resource_ownership SET kind='bogus' WHERE coolify_uuid='app-1'").run());
});

test("deleting a project cascades environments and unplaces (not deletes) its resources", () => {
  const proj = db.prepare("SELECT id FROM projects WHERE org_id=1").get();
  db.prepare("DELETE FROM projects WHERE id = ?").run(proj.id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM environments WHERE project_id=?").get(proj.id).c, 0);
  const still = db.prepare("SELECT environment_id FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  assert.equal(still.environment_id, null);            // SET NULL, resource row survives
  assert.ok(db.prepare("SELECT 1 FROM resource_ownership WHERE coolify_uuid='app-1'").get());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_projects_migration.mjs`
Expected: FAIL — `no such table: projects` (migration 18 not written yet).

- [ ] **Step 3: Write the migration**

In `server/db.js`, append this element to the `MIGRATIONS` array (immediately after the `user_version 17` `auto_deploy` migration, before the closing `];`):

```js
  // -> user_version 18: panel-native projects + environments; resource placement + kind
  (d) => {
    d.exec(`
      CREATE TABLE projects (
        id         INTEGER PRIMARY KEY,
        org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(org_id, slug)
      );
      CREATE TABLE environments (
        id         INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        slug       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, slug)
      );
      ALTER TABLE resource_ownership ADD COLUMN environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL;
      ALTER TABLE resource_ownership ADD COLUMN kind TEXT NOT NULL DEFAULT 'web_service'
        CHECK(kind IN ('web_service','background_worker','cron_job','static_site','postgres','key_value'));
      CREATE INDEX idx_projects_org         ON projects(org_id);
      CREATE INDEX idx_environments_project ON environments(project_id);
      CREATE INDEX idx_resource_env         ON resource_ownership(environment_id);
    `);

    // Generic backfill: per org that owns resources, a Default project + Production env,
    // place all its resources there; databases get kind='postgres' (naive; editable later).
    const now = new Date().toISOString();
    const orgIds = d.prepare("SELECT DISTINCT org_id FROM resource_ownership WHERE org_id IS NOT NULL").all().map((r) => r.org_id);
    const insProj = d.prepare("INSERT INTO projects (org_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)");
    const insEnv  = d.prepare("INSERT INTO environments (project_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)");
    const place   = d.prepare("UPDATE resource_ownership SET environment_id = ? WHERE org_id = ? AND environment_id IS NULL");
    for (const orgId of orgIds) {
      const projId = insProj.run(orgId, "Default", "default", now, now).lastInsertRowid;
      const envId  = insEnv.run(projId, "Production", "production", now, now).lastInsertRowid;
      place.run(envId, orgId);
    }
    d.exec("UPDATE resource_ownership SET kind = 'postgres' WHERE type = 'database'");

    // Validation — throw (rolls back the migration) if anything is left unplaced.
    const unplaced = d.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NOT NULL AND environment_id IS NULL").get().c;
    if (unplaced) throw new Error(`migration 18 backfill incomplete: ${unplaced} owned resources unplaced`);
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_projects_migration.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing DB tests to confirm no regression**

Run: `node --test server/test_orgs_migration.mjs server/test_billing_migration.mjs server/test_migrate.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/test_projects_migration.mjs
git commit -m "feat(db): migration 18 — projects/environments + resource placement + kind"
```

---

### Task 2: DB helpers for projects & environments

**Files:**
- Modify: `server/db.js` (append helper functions near the other query helpers)
- Test: `server/test_projects_db.mjs`

**Interfaces:**
- Consumes: `db`, `slugify`, `getMembership`.
- Produces:
  - `createProject(orgId, name) -> { id, name, slug }`
  - `listProjects(orgId) -> [{ id, name, slug, created_at }]`
  - `getProject(orgId, id) -> row | undefined` (org-scoped)
  - `renameProject(orgId, id, name) -> changes`
  - `deleteProject(orgId, id) -> changes`
  - `createEnvironment(orgId, projectId, name) -> { id, name, slug }` (validates project is in org)
  - `listEnvironments(projectId) -> [{ id, name, slug }]`
  - `renameEnvironment(orgId, envId, name) -> changes`
  - `deleteEnvironment(orgId, envId) -> changes`
  - `ensureDefaultProjectEnv(orgId) -> { projectId, environmentId }` (idempotent; used by first-login)
  - `getEnvironmentWithOrg(envId) -> { id, project_id, org_id } | undefined`

- [ ] **Step 1: Write the failing test**

Create `server/test_projects_db.mjs`:

```js
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const db = await import("./db.js");

function newOrg(email) {
  const u = db.createUser({ email, role: "customer" });
  return db.ensureUserOrg(u.id);
}

test("createProject slugifies and is org-unique-scoped", () => {
  const org = newOrg("p1@x.com");
  const p = db.createProject(org, "Aurora Travel");
  assert.equal(p.slug, "aurora-travel");
  assert.ok(p.id);
  assert.throws(() => db.createProject(org, "Aurora Travel")); // UNIQUE(org_id, slug)
});

test("createProject in a different org with the same name is allowed", () => {
  const a = newOrg("p2a@x.com"), b = newOrg("p2b@x.com");
  db.createProject(a, "Shared Name");
  assert.ok(db.createProject(b, "Shared Name").id); // different org
});

test("getProject is org-scoped (another org's project is invisible)", () => {
  const a = newOrg("p3a@x.com"), b = newOrg("p3b@x.com");
  const p = db.createProject(a, "Only A");
  assert.ok(db.getProject(a, p.id));
  assert.equal(db.getProject(b, p.id), undefined);
});

test("createEnvironment rejects a project outside the caller's org", () => {
  const a = newOrg("p4a@x.com"), b = newOrg("p4b@x.com");
  const p = db.createProject(a, "A Proj");
  assert.throws(() => db.createEnvironment(b, p.id, "Production"), (e) => e.status === 404);
  assert.ok(db.createEnvironment(a, p.id, "Production").id);
});

test("ensureDefaultProjectEnv is idempotent", () => {
  const org = newOrg("p5@x.com");
  const first = db.ensureDefaultProjectEnv(org);
  const second = db.ensureDefaultProjectEnv(org);
  assert.deepEqual(first, second);
  assert.equal(db.listProjects(org).filter((p) => p.slug === "default").length, 1);
});

test("getEnvironmentWithOrg resolves env → project → org", () => {
  const org = newOrg("p6@x.com");
  const p = db.createProject(org, "Proj");
  const e = db.createEnvironment(org, p.id, "Production");
  assert.deepEqual(db.getEnvironmentWithOrg(e.id), { id: e.id, project_id: p.id, org_id: org });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_projects_db.mjs`
Expected: FAIL — `db.createProject is not a function`.

- [ ] **Step 3: Write the helpers**

Append to `server/db.js` (after the org/membership helpers, before the file ends):

```js
// --- projects & environments (panel-native grouping) ------------------------

const notFound = (m = "Not found") => Object.assign(new Error(m), { status: 404 });

function uniqueProjectSlug(orgId, base) {
  const taken = db.prepare("SELECT 1 FROM projects WHERE org_id = ? AND slug = ?");
  let slug = base, n = 1;
  while (taken.get(orgId, slug)) { n += 1; slug = `${base}-${n}`; }
  return slug;
}
function uniqueEnvSlug(projectId, base) {
  const taken = db.prepare("SELECT 1 FROM environments WHERE project_id = ? AND slug = ?");
  let slug = base, n = 1;
  while (taken.get(projectId, slug)) { n += 1; slug = `${base}-${n}`; }
  return slug;
}

export function createProject(orgId, name) {
  const slug = slugify(name);
  // Enforce the UNIQUE(org_id, slug) exactly (no silent suffixing on create — callers
  // want a clear "already exists" error). uniqueProjectSlug is used only for backfill/default.
  const exists = db.prepare("SELECT 1 FROM projects WHERE org_id = ? AND slug = ?").get(orgId, slug);
  if (exists) throw Object.assign(new Error("A project with that name already exists"), { status: 409 });
  const now = nowIso();
  const id = db.prepare("INSERT INTO projects (org_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(orgId, name, slug, now, now).lastInsertRowid;
  return { id, name, slug };
}

export const listProjects = (orgId) =>
  db.prepare("SELECT id, name, slug, created_at FROM projects WHERE org_id = ? ORDER BY created_at").all(orgId);

export const getProject = (orgId, id) =>
  db.prepare("SELECT id, name, slug, created_at FROM projects WHERE org_id = ? AND id = ?").get(orgId, id);

export const renameProject = (orgId, id, name) =>
  db.prepare("UPDATE projects SET name = ?, slug = ?, updated_at = ? WHERE org_id = ? AND id = ?")
    .run(name, slugify(name), nowIso(), orgId, id).changes;

export const deleteProject = (orgId, id) =>
  db.prepare("DELETE FROM projects WHERE org_id = ? AND id = ?").run(orgId, id).changes;

// Validates the project belongs to the org before creating the env under it.
export function createEnvironment(orgId, projectId, name) {
  const proj = db.prepare("SELECT id FROM projects WHERE org_id = ? AND id = ?").get(orgId, projectId);
  if (!proj) throw notFound();
  const slug = uniqueEnvSlug(projectId, slugify(name));
  const now = nowIso();
  const id = db.prepare("INSERT INTO environments (project_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(projectId, name, slug, now, now).lastInsertRowid;
  return { id, name, slug };
}

export const listEnvironments = (projectId) =>
  db.prepare("SELECT id, name, slug FROM environments WHERE project_id = ? ORDER BY (slug='production') DESC, name").all(projectId);

export const renameEnvironment = (orgId, envId, name) =>
  db.prepare(`UPDATE environments SET name = ?, slug = ?, updated_at = ?
              WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE org_id = ?)`)
    .run(name, slugify(name), nowIso(), envId, orgId).changes;

export const deleteEnvironment = (orgId, envId) =>
  db.prepare(`DELETE FROM environments WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE org_id = ?)`)
    .run(envId, orgId).changes;

// Env → project → org, in one row. Used by the placement service's target check.
export const getEnvironmentWithOrg = (envId) =>
  db.prepare(`SELECT e.id, e.project_id, p.org_id
              FROM environments e JOIN projects p ON p.id = e.project_id WHERE e.id = ?`).get(envId);

// Idempotent Default project + Production env for an org (first-login / empty state).
export function ensureDefaultProjectEnv(orgId) {
  let proj = db.prepare("SELECT id FROM projects WHERE org_id = ? AND slug = 'default'").get(orgId);
  if (!proj) {
    const now = nowIso();
    const id = db.prepare("INSERT INTO projects (org_id, name, slug, created_at, updated_at) VALUES (?, 'Default', 'default', ?, ?)")
      .run(orgId, now, now).lastInsertRowid;
    proj = { id };
  }
  let env = db.prepare("SELECT id FROM environments WHERE project_id = ? AND slug = 'production'").get(proj.id);
  if (!env) {
    const now = nowIso();
    const id = db.prepare("INSERT INTO environments (project_id, name, slug, created_at, updated_at) VALUES (?, 'Production', 'production', ?, ?)")
      .run(proj.id, now, now).lastInsertRowid;
    env = { id };
  }
  return { projectId: proj.id, environmentId: env.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_projects_db.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/test_projects_db.mjs
git commit -m "feat(db): project/environment CRUD helpers (org-scoped)"
```

---

### Task 3: `deriveResourceKind` pure helper

**Files:**
- Create: `server/resourcekind.js`
- Test: `server/test_resourcekind.mjs`

**Interfaces:**
- Produces: `deriveResourceKind({ type, image, buildPack, hasDomain, startCommand }) -> kind`
  where `kind ∈ {web_service, background_worker, static_site, postgres, key_value}` (cron_job is
  reserved for phase 2; never derived here).

- [ ] **Step 1: Write the failing test**

Create `server/test_resourcekind.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveResourceKind } from "./resourcekind.js";

test("postgres database", () => {
  assert.equal(deriveResourceKind({ type: "database", image: "postgres:16-alpine" }), "postgres");
  assert.equal(deriveResourceKind({ type: "database", image: "pgvector/pgvector:pg17" }), "postgres");
});
test("key_value database (redis/keydb/dragonfly)", () => {
  assert.equal(deriveResourceKind({ type: "database", image: "redis:7" }), "key_value");
  assert.equal(deriveResourceKind({ type: "database", image: "keydb" }), "key_value");
  assert.equal(deriveResourceKind({ type: "database", image: "dragonfly" }), "key_value");
});
test("static site (build pack static)", () => {
  assert.equal(deriveResourceKind({ type: "application", buildPack: "static" }), "static_site");
});
test("background worker (no domain + worker-ish start)", () => {
  assert.equal(deriveResourceKind({ type: "application", hasDomain: false, startCommand: "pnpm start:workers" }), "background_worker");
});
test("web service (default application)", () => {
  assert.equal(deriveResourceKind({ type: "application", hasDomain: true, startCommand: "npm start" }), "web_service");
});
test("unknown → web_service (safe default)", () => {
  assert.equal(deriveResourceKind({ type: "service" }), "web_service");
  assert.equal(deriveResourceKind({}), "web_service");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_resourcekind.mjs`
Expected: FAIL — `Cannot find module './resourcekind.js'`.

- [ ] **Step 3: Write the helper**

Create `server/resourcekind.js`:

```js
// Map Coolify resource metadata to a Render-style display kind. Pure + deterministic.
// cron_job / preview kinds are phase-2 and never derived here.
const KEY_VALUE = /^(redis|keydb|dragonfly|valkey)/i;

export function deriveResourceKind({ type, image = "", buildPack = "", hasDomain = true, startCommand = "" } = {}) {
  if (type === "database") {
    return KEY_VALUE.test(String(image).replace(/^.*\//, "")) ? "key_value" : "postgres";
  }
  if (String(buildPack).toLowerCase() === "static") return "static_site";
  const worker = /worker|queue|consumer|:workers\b/i.test(String(startCommand));
  if (worker && hasDomain === false) return "background_worker";
  return "web_service";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_resourcekind.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/resourcekind.js server/test_resourcekind.mjs
git commit -m "feat(grouping): deriveResourceKind pure helper"
```

---

### Task 4: `placeResourceInEnvironment` service (single placement writer)

**Files:**
- Create: `server/placement.js`
- Test: `server/test_placement.mjs`

**Interfaces:**
- Consumes: `db`, `getEnvironmentWithOrg` (Task 2), `assertOwns` from `ownership.js`.
- Produces: `placeResourceInEnvironment({ user, type, resourceUuid, environmentId }) -> { ok: true }`.
  Throws `{status:404}` if the caller doesn't own the resource OR the target env isn't in the
  caller's org. `environmentId: null` (unplace) allowed only when `user.role === "admin"`.

- [ ] **Step 1: Write the failing test**

Create `server/test_placement.mjs`:

```js
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const dbm = await import("./db.js");
const { assign } = await import("./ownership.js");
const { placeResourceInEnvironment } = await import("./placement.js");

function seed(email) {
  const u = dbm.createUser({ email, role: "customer" });
  const orgId = dbm.ensureUserOrg(u.id);
  return { user: { id: u.id, role: "customer" }, orgId };
}

test("places an owned resource into an env in the caller's org", () => {
  const { user, orgId } = seed("pl1@x.com");
  assign("app-pl1", "application", user.id);
  const p = dbm.createProject(orgId, "Proj");
  const e = dbm.createEnvironment(orgId, p.id, "Production");
  const r = placeResourceInEnvironment({ user, type: "application", resourceUuid: "app-pl1", environmentId: e.id });
  assert.deepEqual(r, { ok: true });
  assert.equal(dbm.db.prepare("SELECT environment_id FROM resource_ownership WHERE coolify_uuid='app-pl1'").get().environment_id, e.id);
});

test("rejects placing into another org's environment (404)", () => {
  const a = seed("pl2a@x.com"), b = seed("pl2b@x.com");
  assign("app-pl2", "application", a.user.id);
  const pB = dbm.createProject(b.orgId, "B Proj");
  const eB = dbm.createEnvironment(b.orgId, pB.id, "Production");
  assert.throws(
    () => placeResourceInEnvironment({ user: a.user, type: "application", resourceUuid: "app-pl2", environmentId: eB.id }),
    (err) => err.status === 404
  );
});

test("rejects placing a resource the caller doesn't own (404)", () => {
  const a = seed("pl3a@x.com"), b = seed("pl3b@x.com");
  assign("app-pl3", "application", b.user.id); // owned by B
  const pA = dbm.createProject(a.orgId, "A Proj");
  const eA = dbm.createEnvironment(a.orgId, pA.id, "Production");
  assert.throws(
    () => placeResourceInEnvironment({ user: a.user, type: "application", resourceUuid: "app-pl3", environmentId: eA.id }),
    (err) => err.status === 404
  );
});

test("non-admin cannot unplace (environmentId null)", () => {
  const { user, orgId } = seed("pl4@x.com");
  assign("app-pl4", "application", user.id);
  assert.throws(
    () => placeResourceInEnvironment({ user, type: "application", resourceUuid: "app-pl4", environmentId: null }),
    (err) => err.status === 400
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_placement.mjs`
Expected: FAIL — `Cannot find module './placement.js'`.

- [ ] **Step 3: Write the service**

Create `server/placement.js`:

```js
// The ONLY writer of resource_ownership.environment_id. Every route/import/admin path
// funnels through here so both ownership and the target env's org are always validated.
import { db, getEnvironmentWithOrg, getMembership } from "./db.js";
import { assertOwns } from "./ownership.js";

export function placeResourceInEnvironment({ user, type, resourceUuid, environmentId }) {
  assertOwns(user, type, resourceUuid); // 404 if caller's org doesn't own the resource

  if (environmentId === null) {
    if (user?.role !== "admin") throw Object.assign(new Error("Cannot unplace a resource"), { status: 400 });
    db.prepare("UPDATE resource_ownership SET environment_id = NULL WHERE type = ? AND coolify_uuid = ?").run(type, resourceUuid);
    return { ok: true };
  }

  const env = getEnvironmentWithOrg(environmentId);
  if (!env) throw Object.assign(new Error("Not found"), { status: 404 });
  if (user?.role !== "admin") {
    const callerOrg = getMembership(user.id)?.org_id;   // admins may place across orgs deliberately
    if (env.org_id !== callerOrg) throw Object.assign(new Error("Not found"), { status: 404 });
  }
  db.prepare("UPDATE resource_ownership SET environment_id = ? WHERE type = ? AND coolify_uuid = ?").run(env.id, type, resourceUuid);
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_placement.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/placement.js server/test_placement.mjs
git commit -m "feat(grouping): placeResourceInEnvironment service (single validated writer)"
```

---

### Task 5: API routes (thin) + retire Coolify project surface

**Files:**
- Modify: `server/index.js` (replace the `visibleProjects`/`/api/projects`/`/move` block at ~460-500 with the panel routes; wire placement)
- Modify: `client/src/lib/api.js` (repoint `projects`, add environment + placement calls, drop `moveDatabase`/`moveToProject`)
- Test: `server/test_projects_routes.mjs` (unit-style over the helpers + a route-guard simulation, matching `test_org_api.mjs`)

**Interfaces:**
- Consumes: Task 2 helpers, Task 4 `placeResourceInEnvironment`, existing `requireAuth`, `mutateGuard`, `attachOrgContext`, `requireCapability`, `assertOwns`, `record`, `h`, and `req.user` / `getMembership`.
- Produces routes: `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `GET/POST /api/projects/:id/environments`, `PATCH/DELETE /api/environments/:id`, `PATCH /api/resources/:type/:id/placement`, and `GET /api/projects/:id` returning the Render-shaped grouped payload.

- [ ] **Step 1: Write the failing test**

Create `server/test_projects_routes.mjs`:

```js
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const dbm = await import("./db.js");
const { assign } = await import("./ownership.js");
const { buildProjectDetail } = await import("./projectview.js");

function seed(email) {
  const u = dbm.createUser({ email, role: "customer" });
  return { user: { id: u.id, role: "customer" }, orgId: dbm.ensureUserOrg(u.id) };
}

test("buildProjectDetail groups resources by kind with every category present", () => {
  const { user, orgId } = seed("rv1@x.com");
  const p = dbm.createProject(orgId, "Aurora Travel");
  const e = dbm.createEnvironment(orgId, p.id, "Production");
  assign("web-1", "application", user.id);
  dbm.db.prepare("UPDATE resource_ownership SET environment_id=?, kind='web_service' WHERE coolify_uuid='web-1'").run(e.id);
  assign("pg-1", "database", user.id);
  dbm.db.prepare("UPDATE resource_ownership SET environment_id=?, kind='postgres' WHERE coolify_uuid='pg-1'").run(e.id);

  const detail = buildProjectDetail(orgId, p.id);
  assert.equal(detail.project.slug, "aurora-travel");
  const env = detail.environments[0];
  assert.deepEqual(env.resourcesByKind.web_service.map((r) => r.coolify_uuid), ["web-1"]);
  assert.deepEqual(env.resourcesByKind.postgres.map((r) => r.coolify_uuid), ["pg-1"]);
  // every category key exists (empty arrays included) so the UI renders consistently
  assert.deepEqual(
    Object.keys(env.resourcesByKind).sort(),
    ["background_worker","cron_job","key_value","postgres","static_site","web_service"]
  );
});

test("buildProjectDetail returns undefined for another org's project", () => {
  const a = seed("rv2a@x.com"), b = seed("rv2b@x.com");
  const p = dbm.createProject(a.orgId, "A");
  assert.equal(buildProjectDetail(b.orgId, p.id), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_projects_routes.mjs`
Expected: FAIL — `Cannot find module './projectview.js'`.

- [ ] **Step 3: Write the grouped-view builder**

Create `server/projectview.js`:

```js
import { db, getProject, listEnvironments } from "./db.js";

const KINDS = ["web_service", "background_worker", "cron_job", "static_site", "postgres", "key_value"];

// Render-shaped project detail: { project, environments:[{..., resourcesByKind}] }, org-scoped.
export function buildProjectDetail(orgId, projectId) {
  const project = getProject(orgId, projectId);
  if (!project) return undefined;
  const rows = db.prepare(
    "SELECT coolify_uuid, type, kind, environment_id FROM resource_ownership WHERE org_id = ? AND environment_id IS NOT NULL"
  ).all(orgId);
  const environments = listEnvironments(projectId).map((env) => {
    const resourcesByKind = Object.fromEntries(KINDS.map((k) => [k, []]));
    for (const r of rows.filter((r) => r.environment_id === env.id)) {
      (resourcesByKind[r.kind] || resourcesByKind.web_service).push({ coolify_uuid: r.coolify_uuid, type: r.type, kind: r.kind });
    }
    return { id: env.id, name: env.name, slug: env.slug, resourcesByKind };
  });
  return { project, environments };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_projects_routes.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the routes in `server/index.js`**

Replace the block at `server/index.js` lines ~460–500 (the `visibleProjects` helper, `GET /api/projects`, `assertKnownProject`, `POST /api/services/:id/move`, `POST /api/databases/:id/move`) with:

```js
// --- panel-native projects / environments / placement ---
import { placeResourceInEnvironment } from "./placement.js";
import { buildProjectDetail } from "./projectview.js";
const orgOf = (user) => getMembership(user.id)?.org_id ?? ensureUserOrg(user.id);

app.get("/api/projects", requireAuth, h(async (req) => db.listProjects(orgOf(req.user))));

app.post("/api/projects", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => db.createProject(orgOf(req.user), String(req.body?.name || "").trim() || "Untitled")));

app.get("/api/projects/:id", requireAuth, h(async (req) => {
  const detail = buildProjectDetail(orgOf(req.user), Number(req.params.id));
  if (!detail) throw Object.assign(new Error("Not found"), { status: 404 });
  return detail;
}));

app.patch("/api/projects/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: db.renameProject(orgOf(req.user), Number(req.params.id), String(req.body?.name || "").trim()) })));

app.delete("/api/projects/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: db.deleteProject(orgOf(req.user), Number(req.params.id)) })));

app.post("/api/projects/:id/environments", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => db.createEnvironment(orgOf(req.user), Number(req.params.id), String(req.body?.name || "").trim() || "Untitled")));

app.patch("/api/environments/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: db.renameEnvironment(orgOf(req.user), Number(req.params.id), String(req.body?.name || "").trim()) })));

app.delete("/api/environments/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: db.deleteEnvironment(orgOf(req.user), Number(req.params.id)) })));

// type ∈ application|database; id is the coolify_uuid. Replaces the old /move routes.
app.patch("/api/resources/:type/:id/placement", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => {
    const r = placeResourceInEnvironment({
      user: req.user, type: req.params.type, resourceUuid: req.params.id,
      environmentId: req.body?.environmentId ?? null,
    });
    record(req, "resource.place", { resourceType: req.params.type, resourceUuid: req.params.id, metadata: { environmentId: req.body?.environmentId } });
    return r;
  }));
```

Ensure `server/index.js` imports `db` namespace helpers used above. It already does
`import * as coolify from "./coolify.js"`; add near the other imports:
`import { getMembership, ensureUserOrg, listProjects, createProject, getProject, renameProject, deleteProject, createEnvironment, renameEnvironment, deleteEnvironment, db } from "./db.js";`
(merge with any existing `./db.js` import line rather than duplicating).

Delete the now-unused `coolify.listProjects` / `coolify.moveToProject` calls; leave those
functions in `coolify.js` (admin/backend) but they are no longer routed.

- [ ] **Step 6: Update the client API surface**

In `client/src/lib/api.js`, replace the project/move lines:

```js
// projects & environments (panel-native)
projects:        () => req("/projects"),
project:         (id) => req(`/projects/${id}`),
createProject:   (name) => req("/projects", { method: "POST", body: { name } }),
renameProject:   (id, name) => req(`/projects/${id}`, { method: "PATCH", body: { name } }),
deleteProject:   (id) => req(`/projects/${id}`, { method: "DELETE" }),
createEnvironment: (projectId, name) => req(`/projects/${projectId}/environments`, { method: "POST", body: { name } }),
renameEnvironment: (id, name) => req(`/environments/${id}`, { method: "PATCH", body: { name } }),
deleteEnvironment: (id) => req(`/environments/${id}`, { method: "DELETE" }),
placeResource:   (type, id, environmentId) => req(`/resources/${type}/${id}/placement`, { method: "PATCH", body: { environmentId } }),
```

Remove the old `moveDatabase` and any `moveToProject` helper.

- [ ] **Step 7: Run tests + client build**

Run: `node --test server/test_projects_routes.mjs server/test_projects_db.mjs server/test_placement.mjs`
Then: `node --check server/index.js && npm run build`
Expected: tests PASS; `index.js` parses; client builds (the `Projects.jsx` page still compiles — it will be rewritten in the UI plan; if it imports a removed helper, stub the call to `api.projects()` so the build stays green).

- [ ] **Step 8: Commit**

```bash
git add server/index.js server/projectview.js client/src/lib/api.js server/test_projects_routes.mjs
git commit -m "feat(api): panel-native projects/environments/placement; retire Coolify move routes"
```

---

### Task 6 (optional): seed billal's stack into an "Aurora Travel" project

**Files:**
- Create: `server/_seed_billal_project.mjs` (standalone, idempotent one-off; not a migration)

**Interfaces:** consumes Task 2 helpers + `placeResourceInEnvironment`. Not imported by the app.

- [ ] **Step 1: Write the seed script**

Create `server/_seed_billal_project.mjs`:

```js
// One-off, idempotent: group billal's resources under a dedicated project.
// Run once against the live panel DB (node server/_seed_billal_project.mjs), then it's a no-op.
import * as db from "./db.js";
import { placeResourceInEnvironment } from "./placement.js";

const OWNER_EMAIL = "debutwebconsultants@gmail.com";      // adjust to the owning user
const RESOURCES = [
  { type: "application", uuid: "g9l5ixp1qa14hujkrsmd6cvt", kind: "web_service" },        // web
  { type: "application", uuid: "s1zcetwn77bntzjgn59bjq6g", kind: "background_worker" },  // worker
  { type: "database",    uuid: "yomkuwr2tkjbmewg9swdlnex", kind: "postgres" },           // pgvector
  { type: "database",    uuid: "qcrzgvpk0ht5w5f9i2rlbl3e", kind: "key_value" },          // redis
];

const user = db.getUserByEmail(OWNER_EMAIL);
if (!user) { console.error("owner user not found"); process.exit(1); }
const orgId = db.ensureUserOrg(user.id);
const proj = db.listProjects(orgId).find((p) => p.slug === "aurora-travel") || db.createProject(orgId, "Aurora Travel");
const env = db.listEnvironments(proj.id).find((e) => e.slug === "production") || db.createEnvironment(orgId, proj.id, "Production");

for (const r of RESOURCES) {
  db.db.prepare("UPDATE resource_ownership SET kind = ? WHERE type = ? AND coolify_uuid = ?").run(r.kind, r.type, r.uuid);
  placeResourceInEnvironment({ user: { id: user.id, role: user.role }, type: r.type, resourceUuid: r.uuid, environmentId: env.id });
}
console.log(`seeded ${RESOURCES.length} resources into Aurora Travel / Production`);
```

- [ ] **Step 2: Commit (do not run in CI)**

```bash
git add server/_seed_billal_project.mjs
git commit -m "chore(grouping): idempotent seed for billal Aurora Travel project"
```

---

## Follow-up: UI plan (separate)

The client has no test harness (only `npm run build`), so the Render-matched UI —
`/projects` list, `/projects/:slug` with environment tabs + kind sections, project-first
Move modal, empty-state Default/Production, and the project/env selectors in import/create —
is delivered as its own plan: `docs/superpowers/plans/2026-07-03-projects-grouping-ui.md`.
It consumes the API from Task 5 (`api.projects`, `api.project`, `api.createProject`,
`api.createEnvironment`, `api.placeResource`, …).

## Self-review notes

- **Spec coverage:** data model (T1), slug/uniqueness (T1/T2), kind + derivation (T1 naive backfill + T3 precise), placement service with both-side validation (T4), Render-shaped grouped response (T5), `/move`→placement swap + consumer audit (T5), backfill Default/Production (T1), billal seed as separate script (T6). UI + preview-envs + cron/static kinds are deferred (noted).
- **Placeholder scan:** none — every step has runnable code/commands.
- **Type consistency:** `deriveResourceKind`, `placeResourceInEnvironment({user,type,resourceUuid,environmentId})`, `buildProjectDetail(orgId, projectId)`, and the `resourcesByKind` shape are used identically across tasks.
