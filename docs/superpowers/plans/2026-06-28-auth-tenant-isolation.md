# Auth + Tenant Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google + GitHub login and app-layer tenant isolation to the DebutDeploy Express proxy so customers only see and act on their own Coolify resources.

**Architecture:** A SQLite-backed persistence + auth layer is added to the existing Express server. Isolation lives in the proxy (Coolify cannot isolate within one team token): an ownership table maps each Coolify resource UUID → user, and every route filters reads / authorizes actions against it. The Express app is extracted into a `createApp({ coolify, db, config, authenticate })` factory so tests can inject a fake Coolify client (to assert "404 and zero upstream calls") and a stub authenticator.

**Tech Stack:** Node 22 (ESM), Express 4, `better-sqlite3`, Passport (`passport-google-oauth20`, `passport-github2`), `express-session` + `connect-sqlite3`, `node:test` for tests, React + Vite + react-router on the client.

## Global Constraints

- ESM everywhere (`"type": "module"`); use `import`, never `require`.
- Tests use the built-in `node:test` runner + `node:assert/strict`. No new test framework.
- Ownership key is `(type, coolify_uuid)` — never assume UUID global-uniqueness for a security check.
- Non-owned tenant resource → HTTP `404`, and **no Coolify call is made**. Admin-only infra endpoint → `403`.
- Demo auto-login engages **only** when `DEMO_MODE=true` AND `NODE_ENV !== 'production'`.
- In production, missing `SESSION_SECRET` (always) or missing OAuth creds (when not demo) → startup failure.
- Accounts linked only by a provider's **verified** email; reject login if no verified email.
- Session cookie: `httpOnly`, `sameSite=lax`, `secure` in production. Session regenerated on successful login.
- Mutations guarded by Origin/Referer allowlist (`ALLOWED_ORIGINS`) + JSON content-type, in addition to `sameSite=lax`.
- Keep `coolify.js` focused on demo/live branching; isolation logic stays in the route layer.
- Coolify resource `type` values: `application` | `database` | `service`.

---

### Task 1: Dependencies + database layer (`server/db.js`)

**Files:**
- Modify: `server/package.json` (add deps)
- Create: `server/db.js`
- Create: `server/test_db.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `openDb(filename)` → `Database` (better-sqlite3 handle) with pragmas set and schema migrated. `filename` may be `':memory:'`.
  - `getUserById(db, id)` → user row `{ id, email, name, avatar_url, role, created_at }` | `undefined`
  - `getUserByEmail(db, email)` → user row | `undefined`
  - `findIdentity(db, provider, providerUserId)` → `{ provider, provider_user_id, user_id }` | `undefined`
  - `createUser(db, { email, name, avatarUrl, role })` → full user row (includes generated `id`)
  - `linkIdentity(db, { provider, providerUserId, userId })` → `void`
  - Schema tables: `users`, `identities`, `resource_ownership`, `audit_events` (per spec).

- [ ] **Step 1: Add dependencies**

Edit `server/package.json` dependencies to:

```json
  "dependencies": {
    "better-sqlite3": "^11.8.0",
    "connect-sqlite3": "^0.9.15",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "express-session": "^1.18.1",
    "passport": "^0.7.0",
    "passport-github2": "^0.1.12",
    "passport-google-oauth20": "^2.0.0"
  }
```

Run: `npm --prefix server install`
Expected: installs without error.

- [ ] **Step 2: Write the failing test**

Create `server/test_db.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createUser, getUserById, getUserByEmail, findIdentity, linkIdentity } from "./db.js";

test("openDb creates schema and sets user_version", () => {
  const db = openDb(":memory:");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["users", "identities", "resource_ownership", "audit_events"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.ok(db.pragma("user_version", { simple: true }) >= 1);
});

test("createUser + lookups + identity linking", () => {
  const db = openDb(":memory:");
  const u = createUser(db, { email: "a@x.com", name: "A", avatarUrl: null, role: "customer" });
  assert.ok(u.id);
  assert.equal(getUserById(db, u.id).email, "a@x.com");
  assert.equal(getUserByEmail(db, "a@x.com").id, u.id);
  linkIdentity(db, { provider: "google", providerUserId: "g1", userId: u.id });
  assert.equal(findIdentity(db, "google", "g1").user_id, u.id);
  assert.equal(findIdentity(db, "google", "nope"), undefined);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test server/test_db.mjs`
Expected: FAIL — cannot find module `./db.js`.

- [ ] **Step 4: Write `server/db.js`**

```js
// SQLite layer: connection, pragmas, versioned migrations, user/identity queries.
import Database from "better-sqlite3";

const MIGRATIONS = [
  // index 0 -> user_version 1
  (db) => {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('admin','customer')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE identities (
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        PRIMARY KEY (provider, provider_user_id)
      );
      CREATE TABLE resource_ownership (
        coolify_uuid TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('application','database','service')),
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (type, coolify_uuid)
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_uuid TEXT,
        ip TEXT,
        user_agent TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  },
];

export function openDb(filename) {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db) {
  let version = db.pragma("user_version", { simple: true });
  for (let i = version; i < MIGRATIONS.length; i++) {
    const run = db.transaction(() => {
      MIGRATIONS[i](db);
      db.pragma(`user_version = ${i + 1}`);
    });
    run();
  }
}

export function createUser(db, { email, name, avatarUrl, role }) {
  const info = db
    .prepare("INSERT INTO users (email, name, avatar_url, role, created_at) VALUES (?,?,?,?,?)")
    .run(email, name ?? null, avatarUrl ?? null, role, new Date().toISOString());
  return getUserById(db, info.lastInsertRowid);
}

export const getUserById = (db, id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
export const getUserByEmail = (db, email) => db.prepare("SELECT * FROM users WHERE email=?").get(email);
export const findIdentity = (db, provider, providerUserId) =>
  db.prepare("SELECT * FROM identities WHERE provider=? AND provider_user_id=?").get(provider, providerUserId);

export function linkIdentity(db, { provider, providerUserId, userId }) {
  db.prepare("INSERT OR IGNORE INTO identities (provider, provider_user_id, user_id) VALUES (?,?,?)").run(
    provider,
    providerUserId,
    userId
  );
}
```

Note: `new Date().toISOString()` is fine in implementation code (the no-`Date.now()` rule applies only to workflow scripts, not app code).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test_db.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/db.js server/test_db.mjs
git commit -m "feat(server): add SQLite db layer with migrations + user/identity queries"
```

---

### Task 2: Ownership module (`server/ownership.js`)

**Files:**
- Create: `server/ownership.js`
- Create: `server/test_ownership.mjs`

**Interfaces:**
- Consumes: `openDb`, `createUser` from `./db.js`.
- Produces:
  - `ownedUuids(db, userId, type)` → `string[]`
  - `isOwner(db, userId, type, uuid)` → `boolean`
  - `assign(db, { uuid, type, userId })` → `void` (insert or replace owner)
  - `assertOwns(db, user, type, uuid)` → returns `true` if `user.role === 'admin'` or user owns it; otherwise throws an `Error` with `.status = 404`.

- [ ] **Step 1: Write the failing test**

Create `server/test_ownership.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createUser } from "./db.js";
import { ownedUuids, isOwner, assign, assertOwns } from "./ownership.js";

function seed() {
  const db = openDb(":memory:");
  const a = createUser(db, { email: "a@x.com", role: "customer" });
  const b = createUser(db, { email: "b@x.com", role: "customer" });
  const admin = createUser(db, { email: "admin@x.com", role: "admin" });
  assign(db, { uuid: "app-a", type: "application", userId: a.id });
  assign(db, { uuid: "db-b", type: "database", userId: b.id });
  return { db, a, b, admin };
}

test("ownedUuids returns only the user's resources of that type", () => {
  const { db, a } = seed();
  assert.deepEqual(ownedUuids(db, a.id, "application"), ["app-a"]);
  assert.deepEqual(ownedUuids(db, a.id, "database"), []);
});

test("isOwner is type-aware", () => {
  const { db, a } = seed();
  assert.equal(isOwner(db, a.id, "application", "app-a"), true);
  assert.equal(isOwner(db, a.id, "service", "app-a"), false); // wrong type
  assert.equal(isOwner(db, a.id, "database", "db-b"), false); // other user's
});

test("assertOwns throws 404 for non-owner, passes for owner and admin", () => {
  const { db, a, b, admin } = seed();
  assert.equal(assertOwns(db, a, "application", "app-a"), true);
  assert.equal(assertOwns(db, admin, "database", "db-b"), true); // admin bypass
  assert.throws(() => assertOwns(db, b, "application", "app-a"), (e) => e.status === 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_ownership.mjs`
Expected: FAIL — cannot find module `./ownership.js`.

- [ ] **Step 3: Write `server/ownership.js`**

```js
// Tenant isolation: maps Coolify resource UUIDs to users. Enforced in the route layer.
export const ownedUuids = (db, userId, type) =>
  db.prepare("SELECT coolify_uuid FROM resource_ownership WHERE user_id=? AND type=?").all(userId, type).map((r) => r.coolify_uuid);

export const isOwner = (db, userId, type, uuid) =>
  !!db.prepare("SELECT 1 FROM resource_ownership WHERE user_id=? AND type=? AND coolify_uuid=?").get(userId, type, uuid);

export function assign(db, { uuid, type, userId }) {
  db.prepare(
    "INSERT INTO resource_ownership (coolify_uuid, type, user_id, created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(type, coolify_uuid) DO UPDATE SET user_id=excluded.user_id"
  ).run(uuid, type, userId, new Date().toISOString());
}

export function assertOwns(db, user, type, uuid) {
  if (user?.role === "admin") return true;
  if (user && isOwner(db, user.id, type, uuid)) return true;
  throw Object.assign(new Error("Not found"), { status: 404 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_ownership.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/ownership.js server/test_ownership.mjs
git commit -m "feat(server): add type-aware ownership module with 404 assertOwns"
```

---

### Task 3: Audit module (`server/audit.js`)

**Files:**
- Create: `server/audit.js`
- Create: `server/test_audit.mjs`

**Interfaces:**
- Consumes: `openDb`, `createUser` from `./db.js`.
- Produces: `record(db, req, action, opts)` where `opts = { resourceType?, resourceUuid?, metadata? }`. Reads `req.user?.id`, `req.ip`, `req.get?.('user-agent')`. Never throws (audit failure must not break a request).

- [ ] **Step 1: Write the failing test**

Create `server/test_audit.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createUser } from "./db.js";
import { record } from "./audit.js";

const fakeReq = (user) => ({ user, ip: "1.2.3.4", get: () => "jest-ua" });

test("record inserts an audit row with user + metadata", () => {
  const db = openDb(":memory:");
  const u = createUser(db, { email: "a@x.com", role: "customer" });
  record(db, fakeReq(u), "deploy", { resourceType: "application", resourceUuid: "app-a", metadata: { trigger: "manual" } });
  const row = db.prepare("SELECT * FROM audit_events").get();
  assert.equal(row.user_id, u.id);
  assert.equal(row.action, "deploy");
  assert.equal(row.resource_uuid, "app-a");
  assert.equal(JSON.parse(row.metadata_json).trigger, "manual");
});

test("record never throws on a malformed request", () => {
  const db = openDb(":memory:");
  assert.doesNotThrow(() => record(db, {}, "login", {}));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_audit.mjs`
Expected: FAIL — cannot find module `./audit.js`.

- [ ] **Step 3: Write `server/audit.js`**

```js
// Append-only audit trail for a hosting control panel. Best-effort: never throws.
export function record(db, req, action, opts = {}) {
  try {
    db.prepare(
      "INSERT INTO audit_events (user_id, action, resource_type, resource_uuid, ip, user_agent, metadata_json, created_at) " +
        "VALUES (?,?,?,?,?,?,?,?)"
    ).run(
      req?.user?.id ?? null,
      action,
      opts.resourceType ?? null,
      opts.resourceUuid ?? null,
      req?.ip ?? null,
      req?.get?.("user-agent") ?? null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      new Date().toISOString()
    );
  } catch (e) {
    console.error("audit failed:", e.message);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_audit.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/audit.js server/test_audit.mjs
git commit -m "feat(server): add best-effort audit logging"
```

---

### Task 4: Auth helpers — identity resolution + guard middleware (`server/authcore.js`)

This task holds the pure, testable auth logic (verified-email linking, role assignment) and the request guards, separate from the Passport/OAuth wiring (Task 6) so it can be unit-tested without OAuth.

**Files:**
- Create: `server/authcore.js`
- Create: `server/test_authcore.mjs`

**Interfaces:**
- Consumes: `getUserByEmail`, `createUser`, `findIdentity`, `getUserById`, `linkIdentity` from `./db.js`.
- Produces:
  - `resolveIdentity(db, profile, adminEmails)` where `profile = { provider, providerUserId, email, emailVerified, name, avatarUrl }`. Returns a user row. Throws `Error` with `.status = 401` if `!email || !emailVerified`. Resolution order: existing identity → existing user by email (links identity) → create user. Role = `admin` if `adminEmails` (array, lowercased) includes the email, else `customer`.
  - `requireAuth(req, res, next)` → `401` if no `req.user`.
  - `requireAdmin(req, res, next)` → `403` if `req.user?.role !== 'admin'`.
  - `mutationGuard(allowedOrigins)` → middleware; for methods other than GET/HEAD, requires the request `Origin` (or `Referer` host) to be in `allowedOrigins`, else `403`. (Empty `allowedOrigins` → allow all, for tests/local.)

- [ ] **Step 1: Write the failing test**

Create `server/test_authcore.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, getUserById } from "./db.js";
import { resolveIdentity, requireAuth, requireAdmin, mutationGuard } from "./authcore.js";

const prof = (over = {}) => ({
  provider: "google", providerUserId: "g1", email: "a@x.com",
  emailVerified: true, name: "A", avatarUrl: null, ...over,
});

test("resolveIdentity rejects unverified or missing email", () => {
  const db = openDb(":memory:");
  assert.throws(() => resolveIdentity(db, prof({ emailVerified: false }), []), (e) => e.status === 401);
  assert.throws(() => resolveIdentity(db, prof({ email: null }), []), (e) => e.status === 401);
});

test("resolveIdentity creates, then reuses by identity, then links by email", () => {
  const db = openDb(":memory:");
  const u1 = resolveIdentity(db, prof(), ["admin@x.com"]);
  assert.equal(u1.role, "customer");
  // same identity again -> same user
  assert.equal(resolveIdentity(db, prof(), []).id, u1.id);
  // different provider, same verified email -> links to same user
  const u2 = resolveIdentity(db, prof({ provider: "github", providerUserId: "h9" }), []);
  assert.equal(u2.id, u1.id);
});

test("resolveIdentity assigns admin role by email allowlist", () => {
  const db = openDb(":memory:");
  const u = resolveIdentity(db, prof({ email: "admin@x.com", providerUserId: "g2" }), ["admin@x.com"]);
  assert.equal(u.role, "admin");
});

test("requireAuth / requireAdmin gate on req.user", () => {
  const res = () => { const r = { code: 0, body: null }; r.status = (c) => ((r.code = c), r); r.json = (b) => ((r.body = b), r); return r; };
  let nexted = false;
  requireAuth({ user: { id: 1 } }, res(), () => (nexted = true));
  assert.equal(nexted, true);
  const r1 = res(); requireAuth({}, r1, () => {}); assert.equal(r1.code, 401);
  const r2 = res(); requireAdmin({ user: { role: "customer" } }, r2, () => {}); assert.equal(r2.code, 403);
});

test("mutationGuard blocks cross-origin writes, allows reads", () => {
  const res = () => { const r = { code: 0 }; r.status = (c) => ((r.code = c), r); r.json = () => r; return r; };
  const guard = mutationGuard(["http://localhost:5180"]);
  let ok = false;
  guard({ method: "GET", get: () => undefined }, res(), () => (ok = true));
  assert.equal(ok, true);
  const bad = res();
  guard({ method: "POST", get: (h) => (h === "origin" ? "http://evil.com" : undefined) }, bad, () => {});
  assert.equal(bad.code, 403);
  let ok2 = false;
  guard({ method: "POST", get: (h) => (h === "origin" ? "http://localhost:5180" : undefined) }, res(), () => (ok2 = true));
  assert.equal(ok2, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_authcore.mjs`
Expected: FAIL — cannot find module `./authcore.js`.

- [ ] **Step 3: Write `server/authcore.js`**

```js
// Pure auth logic + request guards. No Passport/OAuth here (see auth.js).
import { getUserByEmail, createUser, findIdentity, getUserById, linkIdentity } from "./db.js";

export function resolveIdentity(db, profile, adminEmails = []) {
  const { provider, providerUserId, email, emailVerified, name, avatarUrl } = profile;
  if (!email || !emailVerified) {
    throw Object.assign(new Error("A verified email is required to sign in"), { status: 401 });
  }
  const existing = findIdentity(db, provider, providerUserId);
  if (existing) return getUserById(db, existing.user_id);

  const lower = email.toLowerCase();
  const role = adminEmails.map((e) => e.toLowerCase()).includes(lower) ? "admin" : "customer";

  let user = getUserByEmail(db, email);
  if (!user) user = createUser(db, { email, name, avatarUrl, role });
  linkIdentity(db, { provider, providerUserId, userId: user.id });
  return user;
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

export function mutationGuard(allowedOrigins = []) {
  const allow = new Set(allowedOrigins);
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    if (allow.size === 0) return next(); // local/test: no allowlist configured
    const origin = req.get("origin") || originFromReferer(req.get("referer"));
    if (origin && allow.has(origin)) return next();
    return res.status(403).json({ error: "Bad origin" });
  };
}

function originFromReferer(referer) {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_authcore.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/authcore.js server/test_authcore.mjs
git commit -m "feat(server): add identity resolution + auth/admin/mutation guards"
```

---

### Task 5: App factory + isolated routes + isolation test (`server/app.js`)

This is the security core: route handlers wired with `requireAuth`, ownership filtering on lists, and `assertOwns` before any Coolify call on item/action routes. The app is a factory so the test can inject a fake Coolify client that counts calls.

**Files:**
- Create: `server/app.js`
- Create: `server/test_isolation.mjs`

**Interfaces:**
- Consumes: `ownedUuids`, `assertOwns`, `assign` from `./ownership.js`; `record` from `./audit.js`; guards from `./authcore.js`.
- Produces:
  - `createApp({ coolify, db, config, authenticate })` → Express `app`.
    - `coolify` is any object with the same method names as `server/coolify.js`.
    - `config = { allowedOrigins: string[] }` (more fields added in Task 7; only `allowedOrigins` used here).
    - `authenticate` is a middleware that sets `req.user` (or leaves it undefined). Tests pass a stub reading `x-test-user-id`.
  - Route map (all under `/api`, all behind `requireAuth` except `/api/health`):
    - `GET /api/health` (no auth) → `{ ok, mode }`
    - `GET /api/me` → `req.user` projection or `401`
    - `GET /api/services` → list filtered to owned `application` + `service` UUIDs (admin: all)
    - `GET /api/databases` → list filtered to owned `database` UUIDs (admin: all)
    - `GET /api/services/:id` → `assertOwns` then `coolify.getService`
    - `POST /api/services/:id/deploy` → `assertOwns` then `coolify.deployService` (+ audit)
    - `POST /api/services/:id/:action(start|stop|restart)` → `assertOwns` then `coolify.controlService` (+ audit)
    - `GET /api/services/:id/deployments` → `assertOwns` then `coolify.listDeployments`
    - `GET /api/services/:id/logs` → `assertOwns` then `coolify.getLogLines`
    - `GET /api/services/:id/envs` → `assertOwns` then `coolify.listEnvs`
    - `POST /api/services/:id/envs` → `assertOwns` then `coolify.upsertEnv` (+ audit)
    - `DELETE /api/services/:id/envs/:envId` → `assertOwns` then `coolify.deleteEnv` (+ audit)
    - `GET /api/servers` → `requireAdmin` then `coolify.listServers`
    - `POST /api/admin/assign` → `requireAdmin`, validate body, `assign` (+ audit)
  - Service ownership note: a `:id` may be an `application` or a `service`. `assertOwns` is checked against both types — owns if either matches; admin bypasses.

- [ ] **Step 1: Write the failing test**

Create `server/test_isolation.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createUser } from "./db.js";
import { assign } from "./ownership.js";
import { createApp } from "./app.js";

// Fake Coolify client that counts calls so we can assert "never called" on denials.
function fakeCoolify() {
  const calls = { count: 0 };
  const all = [
    { uuid: "app-a", name: "A-app", type: "web" },
    { uuid: "svc-b", name: "B-svc", type: "service" },
  ];
  const bump = (v) => ((calls.count += 1), v);
  return {
    calls,
    isDemo: () => false,
    listServices: async () => bump(all),
    getService: async (id) => bump(all.find((s) => s.uuid === id) || null),
    deployService: async (id) => bump({ ok: true, uuid: id }),
    controlService: async (id, a) => bump({ ok: true, uuid: id, action: a }),
    listDeployments: async () => bump([]),
    getLogLines: async () => bump(["log"]),
    listEnvs: async () => bump([]),
    upsertEnv: async () => bump({ ok: true }),
    deleteEnv: async () => bump({ ok: true }),
    listDatabases: async () => bump([{ uuid: "db-b", name: "B-db" }]),
    listServers: async () => bump([{ uuid: "srv1" }]),
  };
}

function makeApp() {
  const db = openDb(":memory:");
  const a = createUser(db, { email: "a@x.com", role: "customer" });
  const b = createUser(db, { email: "b@x.com", role: "customer" });
  const admin = createUser(db, { email: "admin@x.com", role: "admin" });
  assign(db, { uuid: "app-a", type: "application", userId: a.id });
  assign(db, { uuid: "svc-b", type: "service", userId: b.id });
  assign(db, { uuid: "db-b", type: "database", userId: b.id });
  const coolify = fakeCoolify();
  // Stub authenticator: x-test-user-id header -> req.user
  const authenticate = (req, _res, next) => {
    const id = req.get("x-test-user-id");
    if (id) req.user = db.prepare("SELECT * FROM users WHERE id=?").get(Number(id));
    next();
  };
  const app = createApp({ coolify, db, config: { allowedOrigins: [] }, authenticate });
  return { app, a, b, admin, coolify };
}

// Minimal supertest-free HTTP helper using the running server.
import { once } from "node:events";
async function req(app, method, path, { userId, body } = {}) {
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const headers = { "content-type": "application/json" };
  if (userId) headers["x-test-user-id"] = String(userId);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  server.close();
  await once(server, "close");
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test("unauthenticated /api/services -> 401", async () => {
  const { app } = makeApp();
  assert.equal((await req(app, "GET", "/api/services")).status, 401);
});

test("customer list is filtered to owned resources", async () => {
  const { app, a } = makeApp();
  const r = await req(app, "GET", "/api/services", { userId: a.id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((s) => s.uuid), ["app-a"]);
});

test("admin sees all services", async () => {
  const { app, admin } = makeApp();
  const r = await req(app, "GET", "/api/services", { userId: admin.id });
  assert.deepEqual(r.json.map((s) => s.uuid).sort(), ["app-a", "svc-b"]);
});

test("customer /api/servers -> 403", async () => {
  const { app, a } = makeApp();
  assert.equal((await req(app, "GET", "/api/servers", { userId: a.id })).status, 403);
});

test("non-owned resource -> 404 AND no Coolify call", async () => {
  const { app, b, coolify } = makeApp();
  const before = coolify.calls.count;
  const r = await req(app, "GET", "/api/services/app-a", { userId: b.id }); // b doesn't own app-a
  assert.equal(r.status, 404);
  assert.equal(coolify.calls.count, before, "Coolify must not be called on a denied request");
});

test("non-owned logs/deployments/envs -> 404", async () => {
  const { app, b } = makeApp();
  for (const p of ["/logs", "/deployments", "/envs"]) {
    assert.equal((await req(app, "GET", `/api/services/app-a${p}`, { userId: b.id })).status, 404);
  }
});

test("non-owned deploy action -> 404 and no Coolify call", async () => {
  const { app, b, coolify } = makeApp();
  const before = coolify.calls.count;
  const r = await req(app, "POST", "/api/services/app-a/deploy", { userId: b.id });
  assert.equal(r.status, 404);
  assert.equal(coolify.calls.count, before);
});

test("admin assign with invalid user -> 400/404", async () => {
  const { app, admin } = makeApp();
  const r = await req(app, "POST", "/api/admin/assign", { userId: admin.id, body: { uuid: "x", type: "application", userId: 9999 } });
  assert.ok([400, 404].includes(r.status));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_isolation.mjs`
Expected: FAIL — cannot find module `./app.js`.

- [ ] **Step 3: Write `server/app.js`**

```js
import express from "express";
import cors from "cors";
import { ownedUuids, assertOwns, assign } from "./ownership.js";
import { requireAuth, requireAdmin, mutationGuard } from "./authcore.js";
import { record } from "./audit.js";
import { getUserById } from "./db.js";

// async handler wrapper (same pattern as the original index.js)
const h = (fn) => async (req, res, next) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    next(e);
  }
};

// A :id service route may reference an application OR a service. Owns if either.
function assertOwnsService(db, user, id) {
  if (user?.role === "admin") return true;
  try {
    return assertOwns(db, user, "application", id);
  } catch {
    return assertOwns(db, user, "service", id); // throws 404 if neither
  }
}

export function createApp({ coolify, db, config, authenticate }) {
  const app = express();
  app.set("trust proxy", true);
  app.use(cors({ origin: config.allowedOrigins?.length ? config.allowedOrigins : true, credentials: true }));
  app.use(express.json());
  app.use(mutationGuard(config.allowedOrigins || []));

  app.get("/api/health", (_req, res) => res.json({ ok: true, mode: coolify.isDemo() ? "demo" : "live" }));

  app.use(authenticate);

  app.get("/api/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    const { id, email, name, avatar_url, role } = req.user;
    res.json({ id, email, name, avatar_url, role });
  });

  // everything below requires auth
  app.use("/api", requireAuth);

  app.get("/api/services", h(async (req) => {
    const all = await coolify.listServices();
    if (req.user.role === "admin") return all;
    const owned = new Set([...ownedUuids(db, req.user.id, "application"), ...ownedUuids(db, req.user.id, "service")]);
    return all.filter((s) => owned.has(s.uuid));
  }));

  app.get("/api/databases", h(async (req) => {
    const all = await coolify.listDatabases();
    if (req.user.role === "admin") return all;
    const owned = new Set(ownedUuids(db, req.user.id, "database"));
    return all.filter((d) => owned.has(d.uuid));
  }));

  app.get("/api/services/:id", h((req) => {
    assertOwnsService(db, req.user, req.params.id);
    return coolify.getService(req.params.id);
  }));

  app.post("/api/services/:id/deploy", h(async (req) => {
    assertOwnsService(db, req.user, req.params.id);
    const r = await coolify.deployService(req.params.id);
    record(db, req, "deploy", { resourceType: "service", resourceUuid: req.params.id });
    return r;
  }));

  app.post("/api/services/:id/:action(start|stop|restart)", h(async (req) => {
    assertOwnsService(db, req.user, req.params.id);
    const r = await coolify.controlService(req.params.id, req.params.action);
    record(db, req, req.params.action, { resourceType: "service", resourceUuid: req.params.id });
    return r;
  }));

  app.get("/api/services/:id/deployments", h((req) => {
    assertOwnsService(db, req.user, req.params.id);
    return coolify.listDeployments(req.params.id);
  }));

  app.get("/api/services/:id/logs", h((req) => {
    assertOwnsService(db, req.user, req.params.id);
    return coolify.getLogLines(req.params.id);
  }));

  app.get("/api/services/:id/envs", h((req) => {
    assertOwnsService(db, req.user, req.params.id);
    return coolify.listEnvs(req.params.id);
  }));

  app.post("/api/services/:id/envs", h(async (req) => {
    assertOwnsService(db, req.user, req.params.id);
    const r = await coolify.upsertEnv(req.params.id, req.body);
    record(db, req, "env.upsert", { resourceType: "service", resourceUuid: req.params.id, metadata: { key: req.body?.key } });
    return r;
  }));

  app.delete("/api/services/:id/envs/:envId", h(async (req) => {
    assertOwnsService(db, req.user, req.params.id);
    const r = await coolify.deleteEnv(req.params.id, req.params.envId);
    record(db, req, "env.delete", { resourceType: "service", resourceUuid: req.params.id });
    return r;
  }));

  app.get("/api/servers", requireAdmin, h(() => coolify.listServers()));

  app.post("/api/admin/assign", requireAdmin, h((req) => {
    const { uuid, type, userId } = req.body || {};
    if (!uuid || !["application", "database", "service"].includes(type) || !userId) {
      throw Object.assign(new Error("uuid, valid type, and userId are required"), { status: 400 });
    }
    if (!getUserById(db, userId)) throw Object.assign(new Error("user not found"), { status: 404 });
    assign(db, { uuid, type, userId });
    record(db, req, "ownership.assign", { resourceType: type, resourceUuid: uuid, metadata: { userId } });
    return { ok: true };
  }));

  app.use((err, _req, res, _next) => {
    if (!err.status || err.status >= 500) console.error(err.message, err.detail || "");
    res.status(err.status || 500).json({ error: err.message, detail: err.detail });
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_isolation.mjs`
Expected: PASS (8 tests). The critical one is "non-owned resource -> 404 AND no Coolify call".

- [ ] **Step 5: Commit**

```bash
git add server/app.js server/test_isolation.mjs
git commit -m "feat(server): app factory with tenant-isolated routes + isolation tests"
```

---

### Task 6: Passport OAuth wiring (`server/auth.js`)

**Files:**
- Create: `server/auth.js`
- Create: `server/test_auth_routes.mjs`

**Interfaces:**
- Consumes: `resolveIdentity` from `./authcore.js`; `getUserById` from `./db.js`; `passport` instance.
- Produces:
  - `buildPassport(db, config)` → a configured `passport` instance. Registers Google + GitHub strategies only if their creds exist in `config`. `serializeUser` stores `user.id`; `deserializeUser` loads via `getUserById`. Each strategy's verify callback maps the provider profile to the `resolveIdentity` profile shape (GitHub: pick the primary verified email from `profile.emails`).
  - `mountAuthRoutes(app, { passport, config })` → adds:
    - `GET /auth/google`, `GET /auth/google/callback`
    - `GET /auth/github`, `GET /auth/github/callback`
    - `POST /auth/logout`
    - Each callback uses `req.session.regenerate` before `req.login` (anti-fixation), then redirects to `config.postLoginRedirect` (default `/`).
  - `config` fields used: `googleClientId/Secret`, `githubClientId/Secret`, `callbackBase`, `adminEmails`, `postLoginRedirect`.

- [ ] **Step 1: Write the failing test**

Create `server/test_auth_routes.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import session from "express-session";
import { buildPassport, mountAuthRoutes } from "./auth.js";
import { openDb } from "./db.js";

function appWithAuth() {
  const db = openDb(":memory:");
  const config = {
    googleClientId: "gid", googleClientSecret: "gsec",
    githubClientId: "", githubClientSecret: "",
    callbackBase: "http://localhost:8787", adminEmails: [], postLoginRedirect: "/",
  };
  const passport = buildPassport(db, config);
  const app = express();
  app.use(session({ secret: "t", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  mountAuthRoutes(app, { passport, config });
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
  server.close();
  await once(server, "close");
  return res;
}

test("GET /auth/google redirects to Google (strategy registered)", async () => {
  const res = await get(appWithAuth(), "/auth/google");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /accounts\.google\.com/);
});

test("GitHub route is absent when creds are missing -> 404", async () => {
  const res = await get(appWithAuth(), "/auth/github");
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_auth_routes.mjs`
Expected: FAIL — cannot find module `./auth.js`.

- [ ] **Step 3: Write `server/auth.js`**

```js
import passportLib from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { resolveIdentity } from "./authcore.js";
import { getUserById } from "./db.js";

export function buildPassport(db, config) {
  const passport = new passportLib.Passport();

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    try {
      done(null, getUserById(db, id) || false);
    } catch (e) {
      done(e);
    }
  });

  const verify = (provider) => (_at, _rt, profile, done) => {
    try {
      const email = pickEmail(provider, profile);
      const user = resolveIdentity(
        db,
        {
          provider,
          providerUserId: profile.id,
          email: email?.value || null,
          emailVerified: email?.verified ?? false,
          name: profile.displayName || profile.username || null,
          avatarUrl: profile.photos?.[0]?.value || null,
        },
        config.adminEmails || []
      );
      done(null, user);
    } catch (e) {
      done(null, false, { message: e.message });
    }
  };

  if (config.googleClientId && config.googleClientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.googleClientId,
          clientSecret: config.googleClientSecret,
          callbackURL: `${config.callbackBase}/auth/google/callback`,
          scope: ["profile", "email"],
        },
        verify("google")
      )
    );
  }

  if (config.githubClientId && config.githubClientSecret) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.githubClientId,
          clientSecret: config.githubClientSecret,
          callbackURL: `${config.callbackBase}/auth/github/callback`,
          scope: ["user:email"],
        },
        verify("github")
      )
    );
  }

  return passport;
}

// Google marks the primary email verified via `email_verified`; passport-google
// exposes emails as [{ value, verified }]. GitHub's primary verified email is in profile.emails.
function pickEmail(provider, profile) {
  const emails = profile.emails || [];
  if (provider === "github") {
    const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
    return primary ? { value: primary.value, verified: true } : null;
  }
  const e = emails[0];
  if (!e) return null;
  return { value: e.value, verified: e.verified ?? profile._json?.email_verified ?? false };
}

export function mountAuthRoutes(app, { passport, config }) {
  const redirect = config.postLoginRedirect || "/";

  const callback = (provider) => [
    passport.authenticate(provider, { failureRedirect: "/login?error=auth", session: false }),
    (req, res, next) => {
      // regenerate session (anti-fixation) then establish the login
      const user = req.user;
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.login(user, (err2) => (err2 ? next(err2) : res.redirect(redirect)));
      });
    },
  ];

  if (config.googleClientId && config.googleClientSecret) {
    app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
    app.get("/auth/google/callback", ...callback("google"));
  }
  if (config.githubClientId && config.githubClientSecret) {
    app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));
    app.get("/auth/github/callback", ...callback("github"));
  }

  app.post("/auth/logout", (req, res) => {
    const done = () => res.json({ ok: true });
    if (req.logout) return req.logout(() => (req.session ? req.session.destroy(done) : done()));
    done();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_auth_routes.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/auth.js server/test_auth_routes.mjs
git commit -m "feat(server): passport google+github strategies with verified-email + session regen"
```

---

### Task 7: Server wiring, config validation, env/gitignore (`server/index.js`)

**Files:**
- Modify: `server/index.js` (replace inline routes with the factory + auth modes)
- Create: `server/config.js`
- Create: `server/test_config.mjs`
- Modify: `server/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `loadConfig(env)` → config object: `{ port, demo, isProd, sessionSecret, googleClientId, googleClientSecret, githubClientId, githubClientSecret, callbackBase, adminEmails: string[], databaseFile, allowedOrigins: string[], postLoginRedirect }`. `demo = env.DEMO_MODE !== 'false' && env.NODE_ENV !== 'production'`.
  - `validateConfig(config)` → throws `Error` if `isProd` and (`!sessionSecret`), or `isProd && !demo && no OAuth creds`. Returns `config` otherwise.

- [ ] **Step 1: Write the failing test**

Create `server/test_config.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateConfig } from "./config.js";

test("demo is forced off in production", () => {
  const c = loadConfig({ NODE_ENV: "production", DEMO_MODE: "true", SESSION_SECRET: "s", GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" });
  assert.equal(c.demo, false);
});

test("prod without SESSION_SECRET throws", () => {
  const c = loadConfig({ NODE_ENV: "production", DEMO_MODE: "false", GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" });
  assert.throws(() => validateConfig(c), /SESSION_SECRET/);
});

test("prod, not demo, no OAuth creds throws", () => {
  const c = loadConfig({ NODE_ENV: "production", DEMO_MODE: "false", SESSION_SECRET: "s" });
  assert.throws(() => validateConfig(c), /OAuth/);
});

test("local demo config is valid", () => {
  const c = loadConfig({ DEMO_MODE: "true" });
  assert.equal(c.demo, true);
  assert.doesNotThrow(() => validateConfig(c));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test_config.mjs`
Expected: FAIL — cannot find module `./config.js`.

- [ ] **Step 3: Write `server/config.js`**

```js
export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === "production";
  const demo = env.DEMO_MODE !== "false" && !isProd;
  return {
    port: Number(env.PORT) || 8787,
    isProd,
    demo,
    sessionSecret: env.SESSION_SECRET || "",
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    githubClientId: env.GITHUB_CLIENT_ID || "",
    githubClientSecret: env.GITHUB_CLIENT_SECRET || "",
    callbackBase: env.OAUTH_CALLBACK_BASE || `http://localhost:${Number(env.PORT) || 8787}`,
    adminEmails: (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean),
    databaseFile: env.DATABASE_FILE || "./data/debut.db",
    allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    postLoginRedirect: env.POST_LOGIN_REDIRECT || "/",
  };
}

export function validateConfig(config) {
  if (config.isProd && !config.sessionSecret) {
    throw new Error("SESSION_SECRET is required in production");
  }
  const hasOAuth =
    (config.googleClientId && config.googleClientSecret) || (config.githubClientId && config.githubClientSecret);
  if (config.isProd && !config.demo && !hasOAuth) {
    throw new Error("OAuth credentials (Google or GitHub) are required in production when not in demo mode");
  }
  return config;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/test_config.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewrite `server/index.js`**

```js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import * as coolify from "./coolify.js";
import { openDb, getUserById } from "./db.js";
import { loadConfig, validateConfig } from "./config.js";
import { createApp } from "./app.js";
import { buildPassport, mountAuthRoutes } from "./auth.js";
import { record } from "./audit.js";

const config = validateConfig(loadConfig());

// ensure the data dir exists
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
const db = openDb(config.databaseFile);

let authenticate;
let mountAuth = null;

if (config.demo) {
  // ponytail: demo auto-login — only reachable because loadConfig forces demo=false in prod.
  const demoUser =
    getUserById(db, 1) ||
    db.prepare("INSERT INTO users (email, name, role, created_at) VALUES (?,?,?,?)").run(
      "demo@debutdeploy.local", "Demo Admin", "admin", new Date().toISOString()
    ) && getUserById(db, 1);
  authenticate = (req, _res, next) => {
    req.user = demoUser;
    next();
  };
  console.log("AUTH: demo mode (auto-login as Demo Admin)");
} else {
  const SQLiteStore = connectSqlite3(session);
  const passport = buildPassport(db, config);
  const sessionMw = session({
    store: new SQLiteStore({ db: "sessions.db", dir: path.dirname(config.databaseFile) }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: config.isProd },
  });
  authenticate = [sessionMw, passport.initialize(), passport.session()];
  mountAuth = (app) => mountAuthRoutes(app, { passport, config });
  console.log("AUTH: OAuth mode (google/github)");
}

const app = createApp({ coolify, db, config, authenticate, mountAuth });

app.listen(config.port, () => {
  console.log(`DebutDeploy API on :${config.port}  [${coolify.isDemo() ? "DEMO data" : "LIVE → Coolify"}]`);
});
```

Then update `createApp` in `server/app.js` to accept and mount the optional auth routes **before** the error handler. Modify the signature and add the mount call:

- Change `export function createApp({ coolify, db, config, authenticate }) {` to `export function createApp({ coolify, db, config, authenticate, mountAuth }) {`
- `authenticate` may be a single middleware or an array — normalize: replace `app.use(authenticate);` with `app.use(...[].concat(authenticate));`
- Immediately before the `app.use((err, ...))` error handler, add: `if (mountAuth) mountAuth(app);`

- [ ] **Step 6: Update `server/.env.example`**

```
# --- DebutDeploy server configuration ---
PORT=8787

# Demo mode: built-in sample data + auto-login. Forced OFF when NODE_ENV=production.
DEMO_MODE=true

# Coolify (live mode)
COOLIFY_BASE_URL=
COOLIFY_API_TOKEN=

# --- Auth (required in production) ---
SESSION_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
# Public base URL the OAuth provider redirects back to
OAUTH_CALLBACK_BASE=http://localhost:8787
# Comma-separated emails granted the admin role on first login
ADMIN_EMAILS=
# Comma-separated allowed browser origins for state-changing requests
ALLOWED_ORIGINS=http://localhost:5180
# SQLite file location
DATABASE_FILE=./data/debut.db

# Optional: Hetzner Cloud API token (future provisioning)
HETZNER_API_TOKEN=
```

- [ ] **Step 7: Update `.gitignore`**

Add these lines:

```
server/data/
*.db
*.db-journal
*.db-wal
*.db-shm
```

- [ ] **Step 8: Verify the full server test suite + boot**

Run: `node --test server/*.mjs`
Expected: PASS (all suites).

Run: `node --prefix server -e "0" 2>/dev/null; (cd server && DEMO_MODE=true node index.js & sleep 1; curl -s localhost:8787/api/health; curl -s localhost:8787/api/services | head -c 80; kill %1)`
Expected: health returns `{"ok":true,"mode":"demo"}`; `/api/services` returns the demo list (demo auto-login as admin sees all).

- [ ] **Step 9: Commit**

```bash
git add server/index.js server/config.js server/test_config.mjs server/app.js server/.env.example .gitignore
git commit -m "feat(server): wire auth modes, config validation, env + gitignore"
```

---

### Task 8: Client — auth context, login page, route guard, logout

The client has no test framework; verification is manual via the browser. Keep changes minimal and follow the existing `client/src/lib/api.js` + `pages/` patterns.

**Files:**
- Create: `client/src/lib/auth.jsx` (auth context + `useAuth` + `RequireAuth`)
- Create: `client/src/pages/Login.jsx`
- Modify: `client/src/App.jsx` (wrap routes, add `/login`, guard the rest)
- Modify: `client/src/lib/api.js` (add `getMe`, `logout`; 401 handling)
- Modify: the sidebar/nav component to add a logout button + hide Servers for non-admins (locate via grep in Step 1)

**Interfaces:**
- Consumes: `/api/me`, `/auth/google`, `/auth/github`, `/auth/logout`.
- Produces: `useAuth()` → `{ user, loading, logout }`; `<RequireAuth>` wrapper that redirects to `/login` when unauthenticated.

- [ ] **Step 1: Locate the existing API + nav patterns**

Run: `cat client/src/lib/api.js; echo "---APP---"; cat client/src/App.jsx`
Run: `grep -rn "Servers\|Sidebar\|NavLink\|nav" client/src/components client/src/pages | head -30`
Expected: shows the fetch helper shape and where nav items (incl. "Servers"/"Databases") are rendered. Use these exact patterns below.

- [ ] **Step 2: Add API helpers**

In `client/src/lib/api.js`, add (matching the file's existing fetch style):

```js
export async function getMe() {
  const res = await fetch("/api/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to load session");
  return res.json();
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST", headers: { "content-type": "application/json" } });
}
```

If the file has a shared request helper, make it treat a `401` by returning/throwing in a way the auth context can detect (e.g. throw an error with `.status = 401`). Match the existing helper; do not introduce a second fetch pattern.

- [ ] **Step 3: Create the auth context**

Create `client/src/lib/auth.jsx`:

```jsx
import { createContext, useContext, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getMe, logout as apiLogout } from "./api.js";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await apiLogout();
    setUser(null);
    window.location.href = "/login";
  };

  return <AuthCtx.Provider value={{ user, loading, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
```

- [ ] **Step 4: Create the login page**

Create `client/src/pages/Login.jsx` (use the existing UI/Tailwind classes from `client/src/components/ui.jsx` where applicable):

```jsx
import { Github } from "lucide-react";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-8 space-y-4">
        <h1 className="text-xl font-semibold">Sign in to DebutDeploy</h1>
        <a href="/auth/google" className="flex items-center justify-center gap-2 w-full rounded-lg bg-white text-slate-900 py-2 font-medium hover:bg-slate-100">
          Continue with Google
        </a>
        <a href="/auth/github" className="flex items-center justify-center gap-2 w-full rounded-lg bg-slate-800 py-2 font-medium hover:bg-slate-700">
          <Github size={18} /> Continue with GitHub
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire routes + guard in `App.jsx`**

Wrap the app in `<AuthProvider>`, add a public `/login` route, and wrap the existing routed pages in `<RequireAuth>`. Example shape (adapt to the actual existing router in `App.jsx`):

```jsx
import { Routes, Route } from "react-router-dom";
import { AuthProvider, RequireAuth } from "./lib/auth.jsx";
import Login from "./pages/Login.jsx";
// ...existing imports (Dashboard, ServiceDetail, Databases, layout)

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              {/* existing layout + nested routes go here, unchanged */}
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 6: Add logout button + hide Servers for non-admins**

In the nav/sidebar component found in Step 1, import `useAuth`, render a logout button calling `logout()`, and conditionally render the "Servers" nav item only when `user?.role === "admin"`:

```jsx
import { useAuth } from "../lib/auth.jsx";
// inside the component:
const { user, logout } = useAuth();
// ...render the Servers link only when admin:
{user?.role === "admin" && (/* existing Servers NavLink */ null)}
// ...add a logout control:
<button onClick={logout} className="text-sm text-slate-400 hover:text-slate-200">Sign out</button>
```

- [ ] **Step 7: Manual verification**

Run (server in OAuth mode requires real creds; for a quick UI smoke test use demo mode which auto-logins, OR set OAuth creds):

```bash
npm run dev
```

Verify:
- With `DEMO_MODE=true`: app loads straight into the dashboard (auto-login admin), Servers nav visible, Sign out present.
- Temporarily set `DEMO_MODE=false` + `NODE_ENV=production` + OAuth creds + `SESSION_SECRET` in `server/.env`, restart: visiting the app redirects to `/login`; the Google/GitHub buttons start the OAuth flow; after login you land on the dashboard.

Confirm `client/vite.config.js` proxies both `/api` and `/auth` to `:8787` (already configured).

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/auth.jsx client/src/pages/Login.jsx client/src/App.jsx client/src/lib/api.js client/src/components
git commit -m "feat(client): auth context, login page, route guard, logout, admin-only Servers nav"
```

---

## Final Verification

- [ ] Run the full server suite: `node --test server/*.mjs` → all PASS.
- [ ] Boot in demo: `npm run dev` → dashboard loads, `/api/health` reports `mode: demo`.
- [ ] Spot-check isolation manually (optional): create two users + assignments via SQLite, hit `/api/services` with each session, confirm disjoint lists.

## Notes on scope

This plan implements the foundation spec only: accounts, Google + GitHub login, and control-plane isolation. Self-serve create/deploy, GitHub repo linking, quotas, and billing are deliberately out of scope and become their own specs/plans.
