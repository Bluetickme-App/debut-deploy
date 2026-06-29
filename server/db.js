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
