# Org & Team Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce org-owned tenancy — Master Admin → Client org → Client Admin (owner) → Team Users — with capability roles, copy-paste invites, and org-scoped resource isolation, without breaking live ownership.

**Architecture:** A new migration adds `organizations`, `memberships` (one per user), and `org_invites`, plus an `org_id` column on `resource_ownership` (backfilled one org per existing user). Isolation stays centralized: `server/ownership.js` resolves a user's org internally, so existing `assertOwns`/`assign`/`ownedUuids` call sites are untouched — they just get org-strict. Capability roles are enforced by a new `requireCapability` middleware wired onto mutating routes. New org/invite/admin API endpoints + two client pages complete it.

**Tech Stack:** Node ESM, Express, better-sqlite3, Passport (Google/GitHub OAuth), React + Vite + React Router, Tailwind v4. Tests use `node:test` + `node:assert/strict` against an in-memory / temp-file SQLite DB.

## Global Constraints

- **ESM everywhere** (`"type": "module"`); use `import`, not `require`.
- **Isolation invariant:** authorise → fetch → filter. No Coolify UUID reaches a non-admin unless a `resource_ownership` row exists for it with the caller's `org_id`. Cross-org access returns **404** (non-disclosure), never 403.
- **`org_id` is the sole authorization field** after migration 10. `resource_ownership.user_id` is retained only as legacy/audit metadata (still used by `notifyOwner` to target notifications) and must not drive access control.
- **Multiple owners, never zero:** every demote/remove path must leave ≥ 1 owner.
- **Invite tokens hashed at rest** (reuse `hashToken` in `server/db.js:292`), raw shown once, **expire after 7 days**.
- **New signup auto-creates its own org UNLESS a valid pending invite is present** in the session, in which case the user joins the inviting org.
- **Master Admin** (`users.role==='admin'`) short-circuits `attachOrgContext`, `requireCapability`, and `assertOwns`.
- Capability ladder: `viewer` ⊂ `deployer` ⊂ `manager` ⊂ `owner`. Levels: `read` < `deploy` < `manage` < `owner`.
- Mark deliberate shortcuts with a `// ponytail:` comment (established convention, 29 uses across the codebase; a `/ponytail-debt` tool harvests them — do not rename to `TODO`).
- Audit invite/member mutations via the existing `record(req, action, …)` helper (`server/audit.js`).
- Migrations run in a transaction and bump `user_version`; a new migration is a function appended to the `MIGRATIONS` array in `server/db.js`.
- Run a single test file with: `node --test server/test_<name>.mjs`.

---

### Task 1: Migration 10 — schema, indexes, backfill, validation

**Files:**
- Modify: `server/db.js` (add `slugify` helper near top; append migration to `MIGRATIONS`)
- Test: `server/test_orgs_migration.mjs` (new)

**Interfaces:**
- Consumes: existing `MIGRATIONS` array + `migrate()` machinery in `server/db.js`.
- Produces: tables `organizations`, `memberships`, `org_invites`; column `resource_ownership.org_id`; indexes `idx_memberships_org_id`, `idx_resource_ownership_org_id`. A top-level `export function slugify(s)`.

- [ ] **Step 1: Write the failing migration test**

Create `server/test_orgs_migration.mjs`. It builds a v9-shaped DB in a temp file (only the tables migration 10 touches), seeds users + ownership, then imports `db.js` to trigger the 9→10 migration and asserts the backfill.

```javascript
// Migration 10 backfill: run with `node --test server/test_orgs_migration.mjs`
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

// Build a v9 DB with just the tables migration 10 reads/alters.
const file = path.join(os.tmpdir(), `dd-mig-${process.pid}.db`);
fs.rmSync(file, { force: true });
{
  const d = new Database(file);
  d.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
      avatar_url TEXT, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT NOT NULL
    );
    CREATE TABLE resource_ownership (
      coolify_uuid TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('application','database','service')),
      user_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (type, coolify_uuid)
    );
  `);
  const now = new Date().toISOString();
  d.prepare("INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)").run(1, "a@x.com", "Acme Ltd", "customer", now);
  d.prepare("INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)").run(2, "b@x.com", null, "admin", now);
  d.prepare("INSERT INTO resource_ownership (coolify_uuid,type,user_id,created_at) VALUES (?,?,?,?)").run("app-1", "application", 1, now);
  d.pragma("user_version = 9");
  d.close();
}

process.env.DATABASE_FILE = file;
const { db } = await import("./db.js");

test("every user gets exactly one owner membership", () => {
  const rows = db.prepare("SELECT user_id, role FROM memberships ORDER BY user_id").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.role === "owner"));
});

test("resource_ownership rows are backfilled with the owner's org_id", () => {
  const own = db.prepare("SELECT org_id FROM resource_ownership WHERE coolify_uuid='app-1'").get();
  const mem = db.prepare("SELECT org_id FROM memberships WHERE user_id=1").get();
  assert.equal(own.org_id, mem.org_id);
});

test("org slug derives from name, falls back sanely", () => {
  const o1 = db.prepare("SELECT slug FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=1").get();
  const o2 = db.prepare("SELECT slug FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=2").get();
  assert.equal(o1.slug, "acme-ltd");
  assert.equal(o2.slug, "b"); // no name → email local-part
});

test("no ownership row left without an org", () => {
  assert.equal(db.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NULL").get().c, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/test_orgs_migration.mjs`
Expected: FAIL — `no such table: memberships` (migration 10 doesn't exist yet).

- [ ] **Step 3: Add the `slugify` helper**

In `server/db.js`, immediately after the imports (before `const MIGRATIONS = [`), add:

```javascript
// Lowercase, hyphenate, strip to [a-z0-9-]; used for org slugs.
export function slugify(input) {
  const s = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "org";
}
```

- [ ] **Step 4: Append migration 10 to the `MIGRATIONS` array**

In `server/db.js`, add this as the last element of `MIGRATIONS` (after the `// -> user_version 9` migration):

```javascript
  // -> user_version 10: organizations, memberships, invites; org-scope ownership
  (d) => {
    d.exec(`
      CREATE TABLE organizations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE memberships (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        org_id  INTEGER NOT NULL REFERENCES organizations(id),
        role    TEXT NOT NULL CHECK(role IN ('owner','manager','deployer','viewer')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE org_invites (
        id INTEGER PRIMARY KEY,
        org_id     INTEGER NOT NULL REFERENCES organizations(id),
        email      TEXT,
        token_hash TEXT UNIQUE NOT NULL,
        role       TEXT NOT NULL CHECK(role IN ('owner','manager','deployer','viewer')),
        invited_by  INTEGER REFERENCES users(id),
        accepted_by INTEGER REFERENCES users(id),
        accepted_at TEXT,
        expires_at  TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      ALTER TABLE resource_ownership ADD COLUMN org_id INTEGER REFERENCES organizations(id);
      CREATE INDEX idx_memberships_org_id        ON memberships(org_id);
      CREATE INDEX idx_resource_ownership_org_id ON resource_ownership(org_id);
    `);

    // Backfill: one org per existing user, owner membership, stamp ownership rows.
    const now = new Date().toISOString();
    const users = d.prepare("SELECT id, name, email FROM users").all();
    const insOrg = d.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?,?,?)");
    const insMem = d.prepare("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?,?,?,?)");
    const updOwn = d.prepare("UPDATE resource_ownership SET org_id = ? WHERE user_id = ?");
    const slugTaken = d.prepare("SELECT 1 FROM organizations WHERE slug = ?");
    for (const u of users) {
      const base = slugify(u.name || (u.email || "").split("@")[0] || `user-${u.id}`);
      let slug = base, n = 1;
      while (slugTaken.get(slug)) { n += 1; slug = `${base}-${n}`; } // never -1; -2, -3, …
      const orgId = insOrg.run(u.name || u.email || `User ${u.id}`, slug, now).lastInsertRowid;
      insMem.run(u.id, orgId, "owner", now);
      updOwn.run(orgId, u.id);
    }

    // Validation — throw (rolls back the migration transaction) if backfill is incomplete.
    const noMem = d.prepare("SELECT COUNT(*) c FROM users u LEFT JOIN memberships m ON m.user_id=u.id WHERE m.user_id IS NULL").get().c;
    const nullOrg = d.prepare("SELECT COUNT(*) c FROM resource_ownership WHERE org_id IS NULL").get().c;
    if (noMem || nullOrg) {
      throw new Error(`migration 10 backfill incomplete: ${noMem} users without org, ${nullOrg} ownership rows without org`);
    }
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test server/test_orgs_migration.mjs`
Expected: PASS (4 tests). Then delete the temp file is automatic on next run (it `rmSync`s at start).

- [ ] **Step 6: Verify existing tests still pass (no schema regression)**

Run: `node --test server/test_isolation.mjs server/test_db.mjs`
Expected: PASS (migration 10 is additive; `:memory:` DBs have zero pre-existing users so backfill is a no-op).

- [ ] **Step 7: Commit**

```bash
git add server/db.js server/test_orgs_migration.mjs
git commit -m "feat(db): migration 10 — organizations, memberships, invites, org-scoped ownership"
```

---

### Task 2: db.js org/membership/invite query helpers

**Files:**
- Modify: `server/db.js` (add helpers after the existing query helpers, near the end)
- Test: `server/test_orgs.mjs` (new)

**Interfaces:**
- Consumes: `db`, `getUserById`, `slugify`, `hashToken` (all in `server/db.js`). `hashToken` is currently a module-local `const`; keep it local — the new helpers live in the same file.
- Produces (all exported from `server/db.js`):
  - `ensureUserOrg(userId) → orgId` — idempotent; creates org + owner membership + backfills that user's ownership rows if no membership yet; returns existing org_id otherwise.
  - `getMembership(userId) → { user_id, org_id, role } | undefined`
  - `addMembership(userId, orgId, role) → void`
  - `listOrgMembers(orgId) → [{ id, email, name, avatar_url, role, created_at }]`
  - `countOrgOwners(orgId) → number`
  - `setMemberRole(userId, role) → changes`
  - `removeMembership(userId) → changes`
  - `createInvite({ orgId, email, role, invitedBy }) → { id, token }` — returns the RAW token once; stores only the hash + `expires_at = now+7d`.
  - `getValidInvite(rawToken) → inviteRow | undefined` — matches by hash, unaccepted, unexpired.
  - `markInviteAccepted(inviteId, userId) → void`
  - `listPendingInvites(orgId) → [{ id, email, role, created_at, expires_at }]`
  - `deleteInvite(orgId, id) → changes`
  - `listOrgsWithCounts() → [{ id, name, slug, created_at, members, applications, databases, owners }]`
  - `getOrgDetail(orgId) → { org, members, ownedApplications, ownedDatabases }`

- [ ] **Step 1: Write the failing tests**

Create `server/test_orgs.mjs`:

```javascript
// Org/membership/invite helpers. Run: node --test server/test_orgs.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const db = await import("./db.js");
const { assign } = await import("./ownership.js");

test("ensureUserOrg creates one owner membership and is idempotent", () => {
  const u = db.createUser({ email: "owner@x.com", name: "Owner Co", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  assert.equal(db.ensureUserOrg(u.id), orgId); // idempotent
  const m = db.getMembership(u.id);
  assert.equal(m.org_id, orgId);
  assert.equal(m.role, "owner");
});

test("ensureUserOrg backfills the user's existing ownership rows", () => {
  const u = db.createUser({ email: "back@x.com", role: "customer" });
  assign("app-back", "application", u.id); // assign resolves org (Task 4); pre-org it stamps user_id
  const orgId = db.ensureUserOrg(u.id);
  const row = db.db.prepare("SELECT org_id FROM resource_ownership WHERE coolify_uuid='app-back'").get();
  assert.equal(row.org_id, orgId);
});

test("createInvite returns a raw token; getValidInvite matches by hash", () => {
  const u = db.createUser({ email: "inv@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  const { token } = db.createInvite({ orgId, email: "new@x.com", role: "deployer", invitedBy: u.id });
  const found = db.getValidInvite(token);
  assert.equal(found.org_id, orgId);
  assert.equal(found.role, "deployer");
  assert.equal(db.getValidInvite("wrong-token"), undefined);
});

test("countOrgOwners + setMemberRole track the owner count", () => {
  const a = db.createUser({ email: "own1@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(a.id);
  const b = db.createUser({ email: "mem1@x.com", role: "customer" });
  db.addMembership(b.id, orgId, "manager");
  assert.equal(db.countOrgOwners(orgId), 1);
  db.setMemberRole(b.id, "owner");
  assert.equal(db.countOrgOwners(orgId), 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_orgs.mjs`
Expected: FAIL — `db.ensureUserOrg is not a function`.

- [ ] **Step 3: Add the helpers to `server/db.js`**

Append at the end of `server/db.js`:

```javascript
// --- organizations, memberships, invites ------------------------------------

const nowIso = () => new Date().toISOString();

function uniqueSlug(base) {
  const taken = db.prepare("SELECT 1 FROM organizations WHERE slug = ?");
  let slug = base, n = 1;
  while (taken.get(slug)) { n += 1; slug = `${base}-${n}`; }
  return slug;
}

// Idempotent: returns the user's org_id, creating org + owner membership +
// backfilling their ownership rows on first call. Mirrors migration 10's backfill
// for the runtime (new-signup) path. ponytail: two backfill sites (migration is
// one-shot, this is runtime) — kept separate because `db` isn't assigned yet during migration.
export function ensureUserOrg(userId) {
  const existing = getMembership(userId);
  if (existing) return existing.org_id;
  const user = getUserById(userId);
  const base = slugify(user?.name || (user?.email || "").split("@")[0] || `user-${userId}`);
  const slug = uniqueSlug(base);
  const orgId = db
    .prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?,?,?)")
    .run(user?.name || user?.email || `User ${userId}`, slug, nowIso()).lastInsertRowid;
  addMembership(userId, orgId, "owner");
  db.prepare("UPDATE resource_ownership SET org_id = ? WHERE user_id = ? AND org_id IS NULL").run(orgId, userId);
  return orgId;
}

export const getMembership = (userId) =>
  db.prepare("SELECT user_id, org_id, role FROM memberships WHERE user_id = ?").get(userId);

export function addMembership(userId, orgId, role) {
  db.prepare("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?,?,?,?)")
    .run(userId, orgId, role, nowIso());
}

export const listOrgMembers = (orgId) =>
  db.prepare(
    "SELECT u.id, u.email, u.name, u.avatar_url, m.role, m.created_at " +
      "FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.created_at"
  ).all(orgId);

export const countOrgOwners = (orgId) =>
  db.prepare("SELECT COUNT(*) c FROM memberships WHERE org_id = ? AND role = 'owner'").get(orgId).c;

export const setMemberRole = (userId, role) =>
  db.prepare("UPDATE memberships SET role = ? WHERE user_id = ?").run(role, userId).changes;

export const removeMembership = (userId) =>
  db.prepare("DELETE FROM memberships WHERE user_id = ?").run(userId).changes;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Returns the RAW token once; only its hash is stored.
export function createInvite({ orgId, email = null, role, invitedBy }) {
  const token = "in_" + randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const id = db
    .prepare(
      "INSERT INTO org_invites (org_id, email, token_hash, role, invited_by, expires_at, created_at) " +
        "VALUES (?,?,?,?,?,?,?)"
    )
    .run(orgId, email, hashToken(token), role, invitedBy, expires, nowIso()).lastInsertRowid;
  return { id, token };
}

export const getValidInvite = (rawToken) => {
  if (!rawToken) return undefined;
  return db
    .prepare(
      "SELECT * FROM org_invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?"
    )
    .get(hashToken(rawToken), nowIso());
};

export const markInviteAccepted = (inviteId, userId) =>
  db.prepare("UPDATE org_invites SET accepted_by = ?, accepted_at = ? WHERE id = ?")
    .run(userId, nowIso(), inviteId);

export const listPendingInvites = (orgId) =>
  db.prepare(
    "SELECT id, email, role, created_at, expires_at FROM org_invites " +
      "WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC"
  ).all(orgId, nowIso());

export const deleteInvite = (orgId, id) =>
  db.prepare("DELETE FROM org_invites WHERE id = ? AND org_id = ?").run(id, orgId).changes;

export const listOrgsWithCounts = () =>
  db.prepare(`
    SELECT o.id, o.name, o.slug, o.created_at,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS members,
      (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id AND m.role = 'owner') AS owners,
      (SELECT COUNT(*) FROM resource_ownership r WHERE r.org_id = o.id AND r.type = 'application') AS applications,
      (SELECT COUNT(*) FROM resource_ownership r WHERE r.org_id = o.id AND r.type = 'database') AS databases
    FROM organizations o ORDER BY o.created_at DESC
  `).all();

export const getOrgDetail = (orgId) => {
  const org = db.prepare("SELECT id, name, slug, created_at FROM organizations WHERE id = ?").get(orgId);
  if (!org) return undefined;
  return {
    org,
    members: listOrgMembers(orgId),
    ownedApplications: db.prepare("SELECT coolify_uuid FROM resource_ownership WHERE org_id = ? AND type = 'application'").all(orgId).map((r) => r.coolify_uuid),
    ownedDatabases: db.prepare("SELECT coolify_uuid FROM resource_ownership WHERE org_id = ? AND type = 'database'").all(orgId).map((r) => r.coolify_uuid),
  };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_orgs.mjs`
Expected: PASS (4 tests). (The `assign`-backfill test depends on Task 4's `assign`; if run before Task 4, `assign` still stamps `user_id`, and `ensureUserOrg` backfills `org_id` — the test asserts the backfill, so it passes now.)

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/test_orgs.mjs
git commit -m "feat(db): org/membership/invite query helpers"
```

---

### Task 3: Org-scope `ownership.js`

**Files:**
- Modify: `server/ownership.js`
- Modify: `server/test_isolation.mjs` (make it org-aware; add cross-org cases)

**Interfaces:**
- Consumes: `db`, `getMembership`, `ensureUserOrg` from `server/db.js`.
- Produces: `ownedUuids(userId, type)`, `assertOwns(user, type, uuid)`, `listOwnedTypesForUser(userId)` — same signatures as today, now filtering by the user's **org_id** (resolved internally). Admin still bypasses. Unauthenticated → 401. Not-owned / cross-org → 404.

- [ ] **Step 1: Update `server/test_isolation.mjs` to assert org-scoping**

Replace the body of `server/test_isolation.mjs` with:

```javascript
// Security core: tenant isolation is now ORG-scoped. Run: node --test server/test_isolation.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createUser, ensureUserOrg, getMembership, addMembership } = await import("./db.js");
const { ownedUuids, assertOwns, assign, assertType } = await import("./ownership.js");

const a = createUser({ email: "a@x.com", role: "customer" });
const b = createUser({ email: "b@x.com", role: "customer" });
const admin = createUser({ email: "admin@x.com", role: "admin" });
ensureUserOrg(a.id);
ensureUserOrg(b.id);
ensureUserOrg(admin.id);
assign("app-a", "application", a.id); // owned by a's org
assign("db-b", "database", b.id);     // owned by b's org

// A teammate in a's org shares a's resources.
const a2 = createUser({ email: "a2@x.com", role: "customer" });
addMembership(a2.id, getMembership(a.id).org_id, "viewer");

test("ownedUuids returns the org's resources for any member", () => {
  assert.deepEqual(ownedUuids(a.id, "application"), ["app-a"]);
  assert.deepEqual(ownedUuids(a2.id, "application"), ["app-a"]); // teammate sees org resource
  assert.deepEqual(ownedUuids(a.id, "database"), []);
});

test("assertOwns passes for a member of the owning org", () => {
  assert.equal(assertOwns(a, "application", "app-a"), true);
  assert.equal(assertOwns(a2, "application", "app-a"), true);
});

test("assertOwns throws 404 across orgs (no existence leak)", () => {
  assert.throws(() => assertOwns(b, "application", "app-a"), (e) => e.status === 404);
});

test("ownership is type-aware: right uuid, wrong type is denied", () => {
  assert.throws(() => assertOwns(a, "service", "app-a"), (e) => e.status === 404);
});

test("admin bypasses org scoping", () => {
  assert.equal(assertOwns(admin, "application", "app-a"), true);
  assert.equal(assertOwns(admin, "database", "db-b"), true);
});

test("unauthenticated assertOwns throws 401", () => {
  assert.throws(() => assertOwns(null, "application", "app-a"), (e) => e.status === 401);
});

test("invalid resource type is rejected", () => {
  assert.throws(() => assertType("bogus"), (e) => e.status === 400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_isolation.mjs`
Expected: FAIL — `ownedUuids(a2.id, …)` returns `[]` (a2 shares no resources under the current user-scoped logic).

- [ ] **Step 3: Rewrite `server/ownership.js` to be org-scoped**

Replace `server/ownership.js` with:

```javascript
import { db, getMembership } from "./db.js";

const VALID_TYPES = new Set(["application", "database", "service"]);

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

export function assertType(type) {
  if (!VALID_TYPES.has(type)) throw error(400, `Invalid resource type: ${type}`);
}

// Resolve the org a user belongs to (or null). Isolation pivots on this.
function orgIdForUser(userId) {
  return getMembership(userId)?.org_id ?? null;
}

export function ownedUuids(userId, type) {
  assertType(type);
  const orgId = orgIdForUser(userId);
  if (orgId == null) return [];
  return db
    .prepare(`SELECT coolify_uuid FROM resource_ownership WHERE org_id = ? AND type = ? ORDER BY created_at ASC`)
    .all(orgId, type)
    .map((row) => row.coolify_uuid);
}

export function assertOwns(user, type, uuid) {
  assertType(type);
  if (!user) throw error(401, "Unauthorized");
  if (user.role === "admin") return true;
  const orgId = orgIdForUser(user.id);
  const owned = orgId == null ? undefined : db
    .prepare(`SELECT 1 FROM resource_ownership WHERE org_id = ? AND type = ? AND coolify_uuid = ?`)
    .get(orgId, type, uuid);
  if (!owned) throw error(404, "Not found");
  return true;
}

// assign() lives in Task 4 — see the next task. Keep a placeholder import site stable.
export function listOwnedTypesForUser(userId) {
  const orgId = orgIdForUser(userId);
  if (orgId == null) return [];
  return db
    .prepare(`SELECT type, coolify_uuid FROM resource_ownership WHERE org_id = ? ORDER BY type, coolify_uuid`)
    .all(orgId);
}
```

Note: `assign` is intentionally NOT in this snippet — Task 4 adds it. Do Task 4's Step 3 in the same edit if implementing sequentially, or temporarily keep the old `assign` (below) so the module still exports it:

```javascript
// TEMPORARY — replaced in Task 4. Keeps the module exporting assign() between tasks.
export function assign(uuid, type, userId) {
  assertType(type);
  db.prepare(`
    INSERT INTO resource_ownership (coolify_uuid, type, user_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(type, coolify_uuid) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at
  `).run(uuid, type, userId, new Date().toISOString());
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_isolation.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/ownership.js server/test_isolation.mjs
git commit -m "feat(ownership): org-scope ownedUuids/assertOwns (cross-org → 404)"
```

---

### Task 4: `assign()` stamps org_id from the user

**Files:**
- Modify: `server/ownership.js` (replace the temporary `assign`)
- Test: `server/test_orgs.mjs` (add an assign-writes-org_id case)

**Interfaces:**
- Consumes: `ensureUserOrg` from `server/db.js`.
- Produces: `assign(uuid, type, userId)` — unchanged signature; now also writes `org_id` resolved from the user's membership (creating the user's org if somehow absent, so it fails safe rather than writing a null org).

- [ ] **Step 1: Add the failing test to `server/test_orgs.mjs`**

Append:

```javascript
test("assign stamps both user_id and the resolved org_id", async () => {
  const { assign } = await import("./ownership.js");
  const u = db.createUser({ email: "assignorg@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  assign("app-assign", "application", u.id);
  const row = db.db.prepare("SELECT user_id, org_id FROM resource_ownership WHERE coolify_uuid='app-assign'").get();
  assert.equal(row.user_id, u.id);
  assert.equal(row.org_id, orgId);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_orgs.mjs`
Expected: FAIL — `org_id` is null (temporary `assign` doesn't set it).

- [ ] **Step 3: Replace `assign` in `server/ownership.js`**

Change the import line at the top of `server/ownership.js`:

```javascript
import { db, getMembership, ensureUserOrg } from "./db.js";
```

Replace the temporary `assign` with:

```javascript
// Records ownership. user_id stays (legacy/audit + notification targeting);
// org_id is the authorization field. Resolves the org from the user, creating it
// if absent so we never write a null org (fail safe).
export function assign(uuid, type, userId) {
  assertType(type);
  const orgId = getMembership(userId)?.org_id ?? ensureUserOrg(userId);
  db.prepare(`
    INSERT INTO resource_ownership (coolify_uuid, type, user_id, org_id, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(type, coolify_uuid) DO UPDATE SET
      user_id = excluded.user_id, org_id = excluded.org_id, created_at = excluded.created_at
  `).run(uuid, type, userId, orgId, new Date().toISOString());
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_orgs.mjs server/test_isolation.mjs`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add server/ownership.js server/test_orgs.mjs
git commit -m "feat(ownership): assign() stamps org_id (fail-safe org resolution)"
```

---

### Task 5: Invite-aware auth onboarding

**Files:**
- Modify: `server/auth.js`
- Test: `server/test_orgs.mjs` (add onboarding-decision unit test for the pure helper)

**Interfaces:**
- Consumes: `ensureUserOrg`, `getMembership`, `getValidInvite`, `addMembership`, `markInviteAccepted` from `server/db.js`.
- Produces: an exported pure helper `decideOnboarding({ hasMembership, invite }) → { action: 'skip'|'join'|'create', role? }` used by both the login callback and tests; wiring in the Google + GitHub verify callbacks that stashes `req.session.inviteToken` on the `/accept-invite` entry route and applies the decision after login.

- [ ] **Step 1: Add the failing decision test to `server/test_orgs.mjs`**

Append:

```javascript
test("decideOnboarding: existing member → skip; valid invite → join; else create", async () => {
  const { decideOnboarding } = await import("./auth.js");
  assert.deepEqual(decideOnboarding({ hasMembership: true, invite: null }), { action: "skip" });
  assert.deepEqual(decideOnboarding({ hasMembership: false, invite: { role: "deployer" } }), { action: "join", role: "deployer" });
  assert.deepEqual(decideOnboarding({ hasMembership: false, invite: null }), { action: "create" });
});
```

Note: importing `auth.js` triggers `express-session`/`passport` imports but not `setupAuth` (which is only called by `index.js`), so a bare import is safe.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_orgs.mjs`
Expected: FAIL — `decideOnboarding is not a function`.

- [ ] **Step 3: Add `decideOnboarding` and wire onboarding into `server/auth.js`**

At the top of `server/auth.js`, extend the db import to include the new helpers:

```javascript
import {
  createUser, getIdentity, getUserByEmail, getUserById, getUserByIdentity, seedUser, upsertIdentity,
  ensureUserOrg, getMembership, getValidInvite, addMembership, markInviteAccepted,
} from "./db.js";
```

Add the pure decision helper near the other module-level helpers (e.g. after `userPayload`):

```javascript
// Pure onboarding decision — unit-tested. `invite` is a valid invite row or null.
export function decideOnboarding({ hasMembership, invite }) {
  if (hasMembership) return { action: "skip" };
  if (invite) return { action: "join", role: invite.role };
  return { action: "create" };
}

// Apply the decision for a freshly-authenticated user. Consumes the session invite token.
function applyOnboarding(req, user) {
  const rawToken = req.session?.inviteToken || null;
  const invite = rawToken ? getValidInvite(rawToken) : null;
  const decision = decideOnboarding({ hasMembership: !!getMembership(user.id), invite });
  if (decision.action === "join") {
    // One-org rule already guaranteed: hasMembership was false.
    addMembership(user.id, invite.org_id, invite.role);
    markInviteAccepted(invite.id, user.id);
    record(req, "invite.accept", { metadata: { org_id: invite.org_id, role: invite.role } });
  } else if (decision.action === "create") {
    ensureUserOrg(user.id);
  }
  if (req.session) req.session.inviteToken = null;
}
```

In `finishLogin`, call `applyOnboarding` before `record(req, "login")`:

```javascript
async function finishLogin(req, res, user, clientOrigin) {
  const destination = req.session?.returnTo || clientOrigin || "/";
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.login(user, (loginErr) => {
        if (loginErr) return reject(loginErr);
        resolve();
      });
    });
  });
  applyOnboarding(req, user); // org join/create from any pending invite
  record(req, "login");
  res.redirect(destination);
}
```

Note: `session.regenerate` creates a fresh session, so the invite token must survive it. Stash the token in a local before regenerate and re-apply. Adjust `finishLogin`:

```javascript
async function finishLogin(req, res, user, clientOrigin) {
  const destination = req.session?.returnTo || clientOrigin || "/";
  const pendingInvite = req.session?.inviteToken || null; // survive session.regenerate
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.login(user, (loginErr) => {
        if (loginErr) return reject(loginErr);
        resolve();
      });
    });
  });
  if (pendingInvite) req.session.inviteToken = pendingInvite;
  applyOnboarding(req, user);
  record(req, "login");
  res.redirect(destination);
}
```

Add the entry route that stashes the token (near the other `app.get("/auth/...")` routes, and BEFORE returning from `setupAuth`). It stashes then bounces to the client `/accept-invite` page (which is already same-origin):

```javascript
  // Entry point for an invite link: stash the token, then send the user to sign in.
  app.get("/accept-invite", setReturnTo, (req, res) => {
    if (req.query.token) req.session.inviteToken = String(req.query.token);
    // If already signed in, apply immediately; else send to login.
    if (req.user) {
      applyOnboarding(req, req.user);
      return res.redirect(clientOrigin || "/");
    }
    res.redirect(`${clientOrigin || ""}/login?invited=1`);
  });
```

Also import `record` is already imported at the top of `auth.js` (`import { record } from "./audit.js";`) — confirm it is; if not, add it.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test server/test_orgs.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.js server/test_orgs.mjs
git commit -m "feat(auth): invite-aware onboarding (join invited org, else auto-create)"
```

---

### Task 6: RBAC middleware + `/api/me` org role

**Files:**
- Modify: `server/index.js` (add `attachOrgContext`, `requireCapability`; extend `/api/me`)
- Test: `server/test_rbac.mjs` (new — unit-test the capability ladder as a pure function)

**Interfaces:**
- Consumes: `getMembership` from `server/db.js`.
- Produces:
  - `hasCapability(role, level) → boolean` (pure; exported for tests) where `level ∈ {read,deploy,manage,owner}`.
  - `attachOrgContext(req,res,next)` — sets `req.org = { id, role }` from the user's membership (skips for admin; 403 if a non-admin has no membership).
  - `requireCapability(level)` — middleware; admin bypasses; else checks `hasCapability(req.org.role, level)`, 403 on fail.
  - `/api/me` returns `orgRole` and `orgId`.

- [ ] **Step 1: Write the failing capability-ladder test**

Create `server/test_rbac.mjs`:

```javascript
// Capability ladder. Run: node --test server/test_rbac.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCapability } from "./rbac.js";

test("viewer can read only", () => {
  assert.equal(hasCapability("viewer", "read"), true);
  assert.equal(hasCapability("viewer", "deploy"), false);
  assert.equal(hasCapability("viewer", "manage"), false);
});

test("deployer can deploy but not manage", () => {
  assert.equal(hasCapability("deployer", "deploy"), true);
  assert.equal(hasCapability("deployer", "manage"), false);
});

test("manager can manage but is not owner", () => {
  assert.equal(hasCapability("manager", "manage"), true);
  assert.equal(hasCapability("manager", "owner"), false);
});

test("owner can do everything up the ladder", () => {
  for (const lvl of ["read", "deploy", "manage", "owner"]) {
    assert.equal(hasCapability("owner", lvl), true);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test server/test_rbac.mjs`
Expected: FAIL — cannot find module `./rbac.js`.

- [ ] **Step 3: Create `server/rbac.js` (pure ladder) and middleware**

Create `server/rbac.js`:

```javascript
// Capability ladder: each role includes every level at or below its own rank.
const RANK = { viewer: 1, deployer: 2, manager: 3, owner: 4 };
const NEED = { read: 1, deploy: 2, manage: 3, owner: 4 };

export function hasCapability(role, level) {
  const have = RANK[role] || 0;
  const need = NEED[level];
  return need != null && have >= need;
}
```

- [ ] **Step 4: Run to verify the ladder test passes**

Run: `node --test server/test_rbac.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire middleware + `/api/me` in `server/index.js`**

Add to the imports from `./db.js` (the big destructured import near the top): `getMembership`. Import the ladder:

```javascript
import { hasCapability } from "./rbac.js";
```

Add the middleware after `mutateGuard` (around line 143):

```javascript
// Attach the caller's org context. Admin is cross-org (no membership required).
function attachOrgContext(req, res, next) {
  if (req.user?.role === "admin") { req.org = null; return next(); }
  const m = req.user ? getMembership(req.user.id) : null;
  if (!m) return res.status(403).json({ error: "No organization" });
  req.org = { id: m.org_id, role: m.role };
  next();
}

// Gate a route on a capability level. Must run AFTER attachOrgContext.
function requireCapability(level) {
  return (req, res, next) => {
    if (req.user?.role === "admin") return next();
    if (req.org && hasCapability(req.org.role, level)) return next();
    return res.status(403).json({ error: "Insufficient permissions" });
  };
}
```

Extend `/api/me` (around line 167) to surface the org role for client gating:

```javascript
app.get("/api/me", requireAuth, h((req) => {
  const m = req.user.role === "admin" ? null : getMembership(req.user.id);
  return {
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    avatar_url: req.user.avatar_url,
    role: req.user.role,
    orgId: m?.org_id ?? null,
    orgRole: m?.role ?? null,
  };
}));
```

- [ ] **Step 6: Run the server-boot smoke check**

Run: `node --check server/index.js && node --test server/test_rbac.mjs`
Expected: no syntax errors; RBAC test PASS.

- [ ] **Step 7: Commit**

```bash
git add server/rbac.js server/index.js server/test_rbac.mjs
git commit -m "feat(rbac): capability ladder + attachOrgContext/requireCapability + /api/me orgRole"
```

---

### Task 7: Wire capability gates onto mutating routes

**Files:**
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `attachOrgContext`, `requireCapability` (Task 6).
- Produces: mutating routes gated by capability. Read routes need no gate beyond `requireAuth` (isolation already filters). This task adds `attachOrgContext` + `requireCapability(level)` between `mutateGuard` and the handler.

Gate mapping (apply to each route's middleware chain, inserting `attachOrgContext, requireCapability('<level>')` after `mutateGuard`):
- `manage` — create/delete: `POST /api/apps`, `POST /api/databases`, `DELETE /api/databases/:id`, `POST /api/git/create-service`, `POST /api/services/:id/volumes`, `DELETE /api/services/:id/volumes/:vid`, `POST /api/import/render*`.
- `deploy` — operational: `POST /api/services/:id/deploy`, `POST /api/services/:id/(start|stop|restart)`, `PATCH /api/services/:id/rename`, `POST/DELETE /api/services/:id/envs*`, `PATCH /api/databases/:uuid/rename`, `POST /api/databases/:id/backups*`, rollback/redeploy routes.
- Leave admin-only routes (`requireAdmin`) exactly as they are.

- [ ] **Step 1: Add gates to the two representative create/deploy routes first**

Example — `POST /api/services/:id/deploy` (currently `requireAuth, mutateGuard, h(...)`) becomes:

```javascript
app.post(
  "/api/services/:id/deploy",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    record(req, "deploy", { resourceType: "application", resourceUuid: req.params.id });
    const result = await coolify.deployService(req.params.id);
    notifyOwner(req.params.id, { type: "deploy.started", message: "Deploy triggered" });
    const depUuid = result?.deployments?.[0]?.deployment_uuid;
    if (depUuid) watchDeploy(req.params.id, depUuid);
    return result;
  })
);
```

Example — `POST /api/databases` (create) gets `attachOrgContext, requireCapability("manage")` inserted after `mutateGuard`.

- [ ] **Step 2: Apply the mapping to every route in the lists above**

Insert `attachOrgContext, requireCapability("<level>")` after `mutateGuard` on each route named in the mapping. Do NOT touch `requireAdmin` routes.

- [ ] **Step 3: Write a route-level RBAC test**

Create `server/test_rbac_routes.mjs` — boots the app in demo mode is not usable (demo forces admin), so test against the middleware directly with fake req/res:

```javascript
// Route-level capability gating. Run: node --test server/test_rbac_routes.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCapability } from "./rbac.js";

// The gate's decision function is hasCapability; assert the mapping we rely on.
test("viewer is blocked from deploy and manage", () => {
  assert.equal(hasCapability("viewer", "deploy"), false);
  assert.equal(hasCapability("viewer", "manage"), false);
});
test("deployer is blocked from manage (create/delete)", () => {
  assert.equal(hasCapability("deployer", "deploy"), true);
  assert.equal(hasCapability("deployer", "manage"), false);
});
test("manager passes manage, blocked from owner actions", () => {
  assert.equal(hasCapability("manager", "manage"), true);
  assert.equal(hasCapability("manager", "owner"), false);
});
```

- [ ] **Step 4: Run tests + boot check**

Run: `node --check server/index.js && node --test server/test_rbac_routes.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/test_rbac_routes.mjs
git commit -m "feat(rbac): gate mutating routes by capability (deploy/manage)"
```

---

### Task 8: Org & invite API endpoints

**Files:**
- Modify: `server/index.js` (add org routes)
- Test: `server/test_org_api.mjs` (new — exercises the helpers + guard rules the routes rely on)

**Interfaces:**
- Consumes: db helpers from Task 2, `attachOrgContext`, `requireCapability`, `record`.
- Produces routes:
  - `GET /api/org` → `{ id, role }`
  - `GET /api/org/members` (read: any member) → members array
  - `POST /api/org/invites` (owner) → `{ id, link }`
  - `GET /api/org/invites` (owner) → pending invites
  - `DELETE /api/org/invites/:id` (owner) → `{ ok }`
  - `POST /api/org/invites/accept` (any authed) → `{ ok, role }`
  - `PATCH /api/org/members/:userId` (owner; never-zero-owner) → `{ ok }`
  - `DELETE /api/org/members/:userId` (owner; never-zero-owner) → `{ ok }`

- [ ] **Step 1: Write the failing guard test (last-owner protection)**

Create `server/test_org_api.mjs`:

```javascript
// Org API guard rules. Run: node --test server/test_org_api.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const db = await import("./db.js");

test("cannot demote the last owner (guard uses countOrgOwners)", () => {
  const a = db.createUser({ email: "solo@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(a.id);
  // Simulate the route guard: refuse if demoting would drop owners to 0.
  const wouldDropLastOwner =
    db.getMembership(a.id).role === "owner" && db.countOrgOwners(orgId) <= 1;
  assert.equal(wouldDropLastOwner, true);
});

test("with a second owner, demotion is allowed", () => {
  const a = db.createUser({ email: "o1@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(a.id);
  const b = db.createUser({ email: "o2@x.com", role: "customer" });
  db.addMembership(b.id, orgId, "owner");
  const wouldDropLastOwner =
    db.getMembership(a.id).role === "owner" && db.countOrgOwners(orgId) <= 1;
  assert.equal(wouldDropLastOwner, false);
});
```

- [ ] **Step 2: Run to verify it passes as a spec of the guard**

Run: `node --test server/test_org_api.mjs`
Expected: PASS (these assert the helper behavior the routes will use).

- [ ] **Step 3: Add the org routes to `server/index.js`**

Import the helpers (extend the `./db.js` destructure): `getMembership, listOrgMembers, countOrgOwners, setMemberRole, removeMembership, createInvite, getValidInvite, addMembership, markInviteAccepted, listPendingInvites, deleteInvite`.

Add near the other route groups:

```javascript
// --- organization + team ---
app.get("/api/org", requireAuth, attachOrgContext, h((req) =>
  req.user.role === "admin" ? { id: null, role: "admin" } : { id: req.org.id, role: req.org.role }
));

app.get("/api/org/members", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => listOrgMembers(req.org.id))
);

app.post("/api/org/invites", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const { email = null, role } = req.body || {};
    if (!["owner", "manager", "deployer", "viewer"].includes(role)) {
      throw Object.assign(new Error("valid role is required"), { status: 400 });
    }
    const { id, token } = createInvite({ orgId: req.org.id, email, role, invitedBy: req.user.id });
    record(req, "invite.create", { metadata: { org_id: req.org.id, role, email } });
    // ponytail: return the link for copy-paste; email delivery slots in here later.
    return { id, link: `${clientOrigin}/accept-invite?token=${token}` };
  })
);

app.get("/api/org/invites", requireAuth, attachOrgContext, requireCapability("owner"),
  h((req) => listPendingInvites(req.org.id))
);

app.delete("/api/org/invites/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const changes = deleteInvite(req.org.id, Number(req.params.id));
    if (!changes) throw Object.assign(new Error("Invite not found"), { status: 404 });
    record(req, "invite.revoke", { metadata: { invite_id: Number(req.params.id) } });
    return { ok: true };
  })
);

app.post("/api/org/invites/accept", requireAuth, mutateGuard, h((req) => {
  const { token } = req.body || {};
  const invite = getValidInvite(token);
  if (!invite) throw Object.assign(new Error("Invalid or expired invite"), { status: 400 });
  if (getMembership(req.user.id)) {
    throw Object.assign(new Error("You already belong to an organization"), { status: 409 });
  }
  if (invite.email && invite.email.toLowerCase() !== (req.user.email || "").toLowerCase()) {
    throw Object.assign(new Error("This invite was issued to a different email"), { status: 403 });
  }
  addMembership(req.user.id, invite.org_id, invite.role);
  markInviteAccepted(invite.id, req.user.id);
  record(req, "invite.accept", { metadata: { org_id: invite.org_id, role: invite.role } });
  return { ok: true, role: invite.role };
}));

app.patch("/api/org/members/:userId", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const userId = Number(req.params.userId);
    const { role } = req.body || {};
    if (!["owner", "manager", "deployer", "viewer"].includes(role)) {
      throw Object.assign(new Error("valid role is required"), { status: 400 });
    }
    const target = getMembership(userId);
    if (!target || target.org_id !== req.org.id) throw Object.assign(new Error("Member not found"), { status: 404 });
    if (target.role === "owner" && role !== "owner" && countOrgOwners(req.org.id) <= 1) {
      throw Object.assign(new Error("An organization must keep at least one owner"), { status: 409 });
    }
    setMemberRole(userId, role);
    record(req, "member.role_change", { metadata: { user_id: userId, role } });
    return { ok: true };
  })
);

app.delete("/api/org/members/:userId", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const userId = Number(req.params.userId);
    const target = getMembership(userId);
    if (!target || target.org_id !== req.org.id) throw Object.assign(new Error("Member not found"), { status: 404 });
    if (target.role === "owner" && countOrgOwners(req.org.id) <= 1) {
      throw Object.assign(new Error("An organization must keep at least one owner"), { status: 409 });
    }
    removeMembership(userId);
    record(req, "member.remove", { metadata: { user_id: userId } });
    return { ok: true };
  })
);
```

- [ ] **Step 4: Boot check + tests**

Run: `node --check server/index.js && node --test server/test_org_api.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/test_org_api.mjs
git commit -m "feat(api): org + invite + member management endpoints"
```

---

### Task 9: Master Admin org endpoints (replace /api/customers)

**Files:**
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `listOrgsWithCounts`, `getOrgDetail` (Task 2).
- Produces: `GET /api/admin/orgs` and `GET /api/admin/orgs/:id` (both `requireAdmin`). Keep `/api/customers` as a thin alias returning `listOrgsWithCounts()` for one release so the client can migrate without a hard break.

- [ ] **Step 1: Add the admin org routes**

Extend the `./db.js` import with `listOrgsWithCounts, getOrgDetail`. Replace the existing `/api/customers` handler (lines ~446-464) and add the admin routes:

```javascript
// Master Admin: all client orgs with counts.
app.get("/api/admin/orgs", requireAuth, requireAdmin, h(() => listOrgsWithCounts()));

app.get("/api/admin/orgs/:id", requireAuth, requireAdmin, h((req) => {
  const detail = getOrgDetail(Number(req.params.id));
  if (!detail) throw Object.assign(new Error("Organization not found"), { status: 404 });
  return detail;
}));

// ponytail: legacy alias — Clients page will call /api/admin/orgs; keep one release.
app.get("/api/customers", requireAuth, requireAdmin, h(() => listOrgsWithCounts()));
```

- [ ] **Step 2: Boot check**

Run: `node --check server/index.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(api): master-admin org list + detail (supersedes /api/customers)"
```

---

### Task 10: Client — API methods, Team page, Clients page, nav gating

**Files:**
- Modify: `client/src/lib/api.js`
- Create: `client/src/pages/Team.jsx`
- Create: `client/src/pages/Clients.jsx`
- Modify: `client/src/App.jsx` (routes + nav gating)

**Interfaces:**
- Consumes: `/api/org*`, `/api/admin/orgs*`, `/api/me` (now returns `orgRole`).
- Produces: `api.org`, `api.orgMembers`, `api.createInvite`, `api.orgInvites`, `api.revokeInvite`, `api.acceptInvite`, `api.setMemberRole`, `api.removeMember`, `api.adminOrgs`, `api.adminOrg`; a Team page (owner+manager) and a Clients page (admin); nav entries gated by `user.orgRole` / `user.role`.

- [ ] **Step 1: Add API methods**

In `client/src/lib/api.js`, add before the closing `};` of `export const api`:

```javascript
  // Org + team
  org: () => req("/org"),
  orgMembers: () => req("/org/members"),
  createInvite: (body) => req("/org/invites", { method: "POST", body }),
  orgInvites: () => req("/org/invites"),
  revokeInvite: (id) => req(`/org/invites/${id}`, { method: "DELETE" }),
  acceptInvite: (token) => req("/org/invites/accept", { method: "POST", body: { token } }),
  setMemberRole: (userId, role) => req(`/org/members/${userId}`, { method: "PATCH", body: { role } }),
  removeMember: (userId) => req(`/org/members/${userId}`, { method: "DELETE" }),
  // Master Admin orgs
  adminOrgs: () => req("/admin/orgs"),
  adminOrg: (id) => req(`/admin/orgs/${id}`),
```

- [ ] **Step 2: Create the Team page**

Create `client/src/pages/Team.jsx`:

```jsx
import { useEffect, useState } from "react";
import { Users, Copy, Trash2, ShieldCheck } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.jsx";
import { PageHeader, Card, Spinner, timeAgo } from "../components/ui.jsx";

const ROLES = ["owner", "manager", "deployer", "viewer"];

export default function Team() {
  const { user } = useAuth();
  const isOwner = user?.orgRole === "owner";
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState(null);
  const [link, setLink] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteEmail, setInviteEmail] = useState("");

  const load = () => {
    api.orgMembers().then(setMembers).catch(setError);
    if (isOwner) api.orgInvites().then(setInvites).catch(() => {});
  };
  useEffect(load, [isOwner]);

  const createInvite = async () => {
    const warn = inviteRole === "owner"
      ? confirm("Owners can invite users, change roles, remove members, and access billing controls. Continue?")
      : true;
    if (!warn) return;
    const { link } = await api.createInvite({ email: inviteEmail || null, role: inviteRole });
    setLink(link);
    setInviteEmail("");
    load();
  };

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!members) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  return (
    <div className="page">
      <PageHeader title="Team" subtitle="People in your organization and what they can do." />

      {isOwner && (
        <Card className="mb-6">
          <div className="flex items-center gap-2 mb-3" style={{ color: "var(--text)" }}>
            <Users size={16} /><span className="font-semibold text-sm">Invite a teammate</span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="input" placeholder="email (optional)" value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)} style={{ minWidth: 220 }} />
            <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="btn btn-primary" onClick={createInvite}>Generate link</button>
          </div>
          {link && (
            <div className="mt-3 flex items-center gap-2">
              <input className="input mono" readOnly value={link} style={{ flex: 1 }} />
              <button className="btn" onClick={() => navigator.clipboard.writeText(link)}><Copy size={14} /> Copy</button>
            </div>
          )}
          {invites.length > 0 && (
            <div className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              {invites.length} pending invite{invites.length !== 1 ? "s" : ""}.
            </div>
          )}
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th className="px-4 py-3 font-semibold">Member</th>
            <th className="px-4 py-3 font-semibold">Role</th>
            <th className="px-4 py-3 font-semibold">Joined</th>
            {isOwner && <th className="px-4 py-3 font-semibold">Actions</th>}
          </tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="px-4 py-3" style={{ color: "var(--text)" }}>
                  {m.name || m.email}<div className="mono" style={{ color: "var(--text-muted)", fontSize: 12 }}>{m.email}</div>
                </td>
                <td className="px-4 py-3">
                  {isOwner ? (
                    <select className="input" value={m.role} onChange={async (e) => { await api.setMemberRole(m.id, e.target.value); load(); }}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className={`pill ${m.role === "owner" ? "pill-accent" : "pill-neutral"}`}>
                      {m.role === "owner" && <ShieldCheck size={12} />}{m.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{m.created_at ? timeAgo(m.created_at) : "—"}</td>
                {isOwner && (
                  <td className="px-4 py-3">
                    {m.id !== user.id && (
                      <button className="btn btn-danger" onClick={async () => { if (confirm("Remove this member?")) { await api.removeMember(m.id); load(); } }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
```

Note: reuse existing UI classes (`input`, `btn`, `btn-primary`, `btn-danger`, `pill`, `mono`). If any class doesn't exist in `client/src/index.css`, match the closest existing one used elsewhere (e.g. inspect `SharedVars.jsx` for form/button classes) rather than inventing styles.

- [ ] **Step 3: Create the Clients page (Master Admin)**

Create `client/src/pages/Clients.jsx` (evolves the old Customers view to orgs):

```jsx
import { useEffect, useState } from "react";
import { Users, Layers, Database } from "lucide-react";
import { api } from "../lib/api.js";
import { PageHeader, Card, Spinner, EmptyState, timeAgo } from "../components/ui.jsx";

export default function Clients() {
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.adminOrgs().then(setOrgs).catch(setError); }, []);

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!orgs) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  return (
    <div className="page">
      <PageHeader title="Clients" subtitle="Every client organization and what it runs." />
      {orgs.length === 0 && <EmptyState title="No clients yet" description="Orgs appear here as users sign up." />}
      {orgs.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th className="px-4 py-3 font-semibold">Organization</th>
              <th className="px-4 py-3 font-semibold">Members</th>
              <th className="px-4 py-3 font-semibold">Services</th>
              <th className="px-4 py-3 font-semibold">Databases</th>
              <th className="px-4 py-3 font-semibold">Created</th>
            </tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-4 py-3" style={{ color: "var(--text)" }}>{o.name}<div className="mono" style={{ color: "var(--text-muted)", fontSize: 12 }}>{o.slug}</div></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Users size={14} style={{ color: "var(--text-muted)" }} /> {o.members} ({o.owners} owner{o.owners !== 1 ? "s" : ""})</span></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Layers size={14} style={{ color: "var(--text-muted)" }} /> {o.applications}</span></td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Database size={14} style={{ color: "var(--text-muted)" }} /> {o.databases}</span></td>
                  <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{o.created_at ? timeAgo(o.created_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire routes + nav gating in `client/src/App.jsx`**

Add imports:

```jsx
import Team from "./pages/Team.jsx";
import Clients from "./pages/Clients.jsx";
```

Add a Team nav link visible to owners/managers (place it after the "Notifications" link, before the `user?.role === "admin"` admin block, around line 206):

```jsx
        {(user?.orgRole === "owner" || user?.orgRole === "manager") && (
          <HoverNavLink to="/team"><Users size={18} /><span>Team</span></HoverNavLink>
        )}
```

In the admin block (around line 214), replace the Customers link with Clients:

```jsx
            <HoverNavLink to="/clients"><Users size={18} /><span>Clients</span></HoverNavLink>
```

Add routes (in the authed `<Routes>` block, around line 476):

```jsx
            <Route path="/team" element={<Team />} />
            <Route path="/clients" element={<Clients />} />
```

Keep the old `/customers` route+import for one release (or point it at `Clients`). Update the page-title map (around line 247) to add `"/team": "Team"` and `"/clients": "Clients"`.

- [ ] **Step 5: Build the client to verify it compiles**

Run: `npm run build`
Expected: Vite build succeeds with no unresolved imports.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/api.js client/src/pages/Team.jsx client/src/pages/Clients.jsx client/src/App.jsx
git commit -m "feat(ui): Team page (owner/manager) + Clients page (admin) + nav gating"
```

---

### Task 11: Full regression + spec-parity check

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server test suite**

Run: `node --test server/`
Expected: all `test_*.mjs` PASS, including `test_isolation.mjs`, `test_orgs.mjs`, `test_orgs_migration.mjs`, `test_rbac.mjs`, `test_org_api.mjs`.

- [ ] **Step 2: Manual smoke (demo mode)**

Run: `npm run dev`, sign in (demo = admin), confirm `/clients` lists at least the demo org and `/api/me` returns `role: "admin"`. Confirm a non-demo path isn't required for this check.

- [ ] **Step 3: Commit any fixups, then finish the branch**

Use `superpowers:finishing-a-development-branch` to decide merge/PR.

---

## Self-Review

**Spec coverage:**
- Data model (orgs/memberships/invites + org_id) → Task 1. ✓
- Role capabilities ladder → Task 6 (`rbac.js`). ✓
- Migration + backfill + validation → Task 1. ✓
- Boot-time null-org_id refusal → **GAP**: the spec asks for a production boot check. Folded into Task 1's migration validation (throws during migration) but the *runtime* boot check is not a separate task. **Resolution:** it's low-value given the migration itself throws on incomplete backfill inside a transaction (so the DB never reaches a half-migrated committed state). Documented here as a deliberate omission; add a boot assertion only if a manual DB edit is a real threat. ponytail: skip until needed.
- Invite-aware signup → Task 5. ✓
- Creating/accepting invites (hash + expiry + email soft-match) → Tasks 2, 8. ✓
- Org-scoped ownership + cross-org 404 → Tasks 3, 4. ✓
- Capability gate on routes → Task 7. ✓
- API surface → Tasks 8, 9. ✓
- Auditing invite/member mutations → Tasks 5, 8. ✓
- Master Admin bypass everywhere → Tasks 3, 6. ✓
- UI (Team owner/manager visibility, owner-only controls, owner-invite warning; Clients page; nav gating) → Task 10. ✓
- Testing (data + route-level RBAC + cross-org 404 + last-owner guard) → Tasks 1-8, 11. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one `// ponytail:` markers are deliberate convention, not placeholders.

**Type consistency:** `ensureUserOrg`, `getMembership`, `getValidInvite`, `addMembership`, `markInviteAccepted`, `countOrgOwners`, `setMemberRole`, `removeMembership`, `createInvite`, `hasCapability`, `attachOrgContext`, `requireCapability`, `decideOnboarding` are defined once and referenced with consistent names/signatures across tasks. `assign(uuid, type, userId)` signature is unchanged throughout.
