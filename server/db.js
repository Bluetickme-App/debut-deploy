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
