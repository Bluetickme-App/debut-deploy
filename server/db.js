// SQLite layer: a single shared connection plus user/identity queries.
// The connection is a module singleton (imported as `db` by ownership.js and
// audit.js); auth.js imports the user/identity helpers. Schema is created and
// migrated on first import.
//
// DATABASE_FILE overrides the location; use ':memory:' in tests.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

// Lowercase, hyphenate, strip to [a-z0-9-]; used for org slugs.
export function slugify(input) {
  const s = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "org";
}

const MIGRATIONS = [
  // -> user_version 1
  (d) => {
    d.exec(`
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
        created_at TEXT NOT NULL,
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
  // -> user_version 2
  (d) => {
    d.exec(`
      CREATE TABLE github_installations (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        installation_id INTEGER NOT NULL,
        account_login TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE customer_projects (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        project_uuid TEXT NOT NULL,
        environment_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 3: one-time OAuth/install state nonces
  (d) => {
    d.exec(`
      CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 4: programmatic API tokens (hashed; for Claude Code / CI)
  (d) => {
    d.exec(`
      CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT,
        token_hash TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
    `);
  },
  // -> user_version 5: multi-installation support (one user, many GitHub App installs)
  (d) => {
    d.exec(`
      CREATE TABLE user_installations (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        installation_id INTEGER NOT NULL,
        account_login TEXT,
        account_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, installation_id)
      );
    `);
  },
  // -> user_version 6: per-user outbound webhook notification settings
  (d) => {
    d.exec(`
      CREATE TABLE notification_settings (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        webhook_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 7: which event types a webhook subscribes to (JSON array; null = all)
  (d) => {
    d.exec(`ALTER TABLE notification_settings ADD COLUMN events TEXT`);
  },
  // -> user_version 8: saved (named, encrypted) Render API keys for re-use
  (d) => {
    d.exec(`
      CREATE TABLE render_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        key_ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  },
  // -> user_version 9: encrypted key/value app settings (e.g. shared DB cluster URL)
  (d) => {
    d.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  },
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
];

function resolveDbFile() {
  const configured = process.env.DATABASE_FILE;
  if (configured) return configured;
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(serverDir, "data", "debut.db");
}

function openDb() {
  const file = resolveDbFile();
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("foreign_keys = ON");
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 5000");
  migrate(d);
  return d;
}

function migrate(d) {
  const version = d.pragma("user_version", { simple: true });
  for (let i = version; i < MIGRATIONS.length; i++) {
    const run = d.transaction(() => {
      MIGRATIONS[i](d);
      d.pragma(`user_version = ${i + 1}`);
    });
    run();
  }
}

export const db = openDb();

// --- user + identity queries -------------------------------------------------

export function createUser({ email, name = null, avatar_url = null, role = "customer" }) {
  const info = db
    .prepare("INSERT INTO users (email, name, avatar_url, role, created_at) VALUES (?,?,?,?,?)")
    .run(email, name, avatar_url, role, new Date().toISOString());
  return getUserById(info.lastInsertRowid);
}

// --- saved Render API keys (encrypted at rest; scoped to the owning user) -----
export function createRenderCredential({ userId, name, keyCiphertext }) {
  const info = db
    .prepare("INSERT INTO render_credentials (user_id, name, key_ciphertext, created_at) VALUES (?,?,?,?)")
    .run(userId, name, keyCiphertext, new Date().toISOString());
  return { id: info.lastInsertRowid, name };
}
// List NEVER returns the ciphertext — only id/name/created_at.
export function listRenderCredentials(userId) {
  return db.prepare("SELECT id, name, created_at FROM render_credentials WHERE user_id = ? ORDER BY created_at DESC").all(userId);
}
// Scoped to userId → no cross-tenant read of another user's key.
export function getRenderCredential(userId, id) {
  return db.prepare("SELECT * FROM render_credentials WHERE user_id = ? AND id = ?").get(userId, id);
}
export function deleteRenderCredential(userId, id) {
  return db.prepare("DELETE FROM render_credentials WHERE user_id = ? AND id = ?").run(userId, id).changes;
}

// --- key/value app settings (store encrypted values like the shared cluster URL) --
export function getSetting(key) {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value ?? null;
}
export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, value, new Date().toISOString());
  return value;
}

// Idempotent: returns the existing user for this email, or creates one.
export function seedUser(fields) {
  return getUserByEmail(fields.email) || createUser(fields);
}

export const getUserById = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
export const getUserByEmail = (email) => db.prepare("SELECT * FROM users WHERE email = ?").get(email);
export const listUsers = () => db.prepare("SELECT * FROM users ORDER BY id").all();

export const getIdentity = (provider, providerUserId) =>
  db.prepare("SELECT * FROM identities WHERE provider = ? AND provider_user_id = ?").get(provider, providerUserId);

export const getUserByIdentity = (provider, providerUserId) =>
  db
    .prepare(
      "SELECT users.* FROM users JOIN identities ON identities.user_id = users.id " +
        "WHERE identities.provider = ? AND identities.provider_user_id = ?"
    )
    .get(provider, providerUserId);

export function upsertIdentity({ provider, provider_user_id, user_id }) {
  db.prepare(
    "INSERT INTO identities (provider, provider_user_id, user_id, created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id"
  ).run(provider, provider_user_id, user_id, new Date().toISOString());
}

// --- github installation + customer project helpers -------------------------

export function setInstallation({ userId, installationId, accountLogin = null }) {
  db.prepare(
    "INSERT INTO github_installations (user_id, installation_id, account_login, created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(user_id) DO UPDATE SET installation_id = excluded.installation_id, account_login = excluded.account_login, created_at = excluded.created_at"
  ).run(userId, installationId, accountLogin, new Date().toISOString());
}

export const getInstallation = (userId) =>
  db.prepare("SELECT * FROM github_installations WHERE user_id = ?").get(userId);

export const deleteInstallation = (userId) =>
  db.prepare("DELETE FROM github_installations WHERE user_id = ?").run(userId);

export function setCustomerProject({ userId, projectUuid, environmentName }) {
  db.prepare(
    "INSERT INTO customer_projects (user_id, project_uuid, environment_name, created_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(user_id) DO UPDATE SET project_uuid = excluded.project_uuid, environment_name = excluded.environment_name, created_at = excluded.created_at"
  ).run(userId, projectUuid, environmentName, new Date().toISOString());
}

export const getCustomerProject = (userId) =>
  db.prepare("SELECT * FROM customer_projects WHERE user_id = ?").get(userId);

// reverse identity lookup: a user's linked account for a provider (used to
// verify a GitHub App installation belongs to the signed-in user).
export const getIdentityByUser = (userId, provider) =>
  db.prepare("SELECT * FROM identities WHERE user_id = ? AND provider = ?").get(userId, provider);

// --- one-time OAuth/install state nonces ------------------------------------

export function createOauthState({ state, userId }) {
  db.prepare("INSERT INTO oauth_states (state, user_id, created_at) VALUES (?,?,?)").run(
    state,
    userId,
    new Date().toISOString()
  );
}

// Single-use: returns the row (or undefined) and deletes it.
export function consumeOauthState(state) {
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
  if (row) db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  return row;
}

// --- programmatic API tokens (hashed at rest) -------------------------------

const hashToken = (raw) => createHash("sha256").update(raw).digest("hex");

// Returns { id, token } — the raw token is shown ONCE and never stored.
export function createApiToken(userId, name) {
  const token = "dd_" + randomBytes(24).toString("hex");
  const info = db
    .prepare("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?,?,?,?)")
    .run(userId, name || null, hashToken(token), new Date().toISOString());
  return { id: info.lastInsertRowid, token };
}

// Resolve a raw bearer token to its user (and stamp last_used_at), or undefined.
export function getUserByApiToken(rawToken) {
  if (!rawToken) return undefined;
  const row = db.prepare("SELECT * FROM api_tokens WHERE token_hash = ?").get(hashToken(rawToken));
  if (!row) return undefined;
  db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return getUserById(row.user_id);
}

export const listApiTokens = (userId) =>
  db.prepare("SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id DESC").all(userId);

export const deleteApiToken = (userId, id) =>
  db.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId);

// --- multi-installation helpers (user_installations table) -------------------

export function addUserInstallation({ userId, installationId, accountLogin = null, accountId = null }) {
  db.prepare(
    "INSERT INTO user_installations (user_id, installation_id, account_login, account_id, created_at) VALUES (?,?,?,?,?) " +
      "ON CONFLICT(user_id, installation_id) DO UPDATE SET account_login = excluded.account_login, account_id = excluded.account_id"
  ).run(userId, installationId, accountLogin, accountId, new Date().toISOString());
}

export const listUserInstallations = (userId) =>
  db.prepare("SELECT * FROM user_installations WHERE user_id = ? ORDER BY id").all(userId);

export const findUserInstallationByAccount = (userId, accountId) =>
  db.prepare("SELECT * FROM user_installations WHERE user_id = ? AND account_id = ?").get(userId, accountId);

export const findUserInstallationByLogin = (userId, accountLogin) =>
  db.prepare("SELECT * FROM user_installations WHERE user_id = ? AND account_login = ? COLLATE NOCASE").get(userId, accountLogin);
