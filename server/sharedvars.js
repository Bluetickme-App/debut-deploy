// Shared environment variables — admin-managed, team-scoped.
//
// Coolify v4.1.2 has no shared-variables REST endpoint (verified live against
// http://167.233.206.184:8000 — all candidate paths return 404). We store
// shared vars in the local SQLite DB (migration 5) and push them into
// individual applications on demand via the caller. isDemo() branches follow
// the codebase pattern from lifecycle.js; cf() is unused here but kept as a
// placeholder for future Coolify API support.
// ponytail: local-DB only — if Coolify adds a shared-vars API, swap the live
// path to cf() calls and drop the shared_variables table migration.

import { isDemo } from "./coolify.js";
import { db } from "./db.js";

// Lazily run migration: adds shared_variables table if not present.
// Uses a separate pragma key (user_version tracks all migrations in db.js;
// we check for table existence instead to stay decoupled).
function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_variables (
      uuid TEXT PRIMARY KEY,
      key  TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      is_secret INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}
ensureTable();

// --- demo fixtures -----------------------------------------------------------

const DEMO_VARS = [
  { uuid: "sv-1", key: "NODE_ENV",      value: "production", is_secret: false, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  { uuid: "sv-2", key: "LOG_LEVEL",     value: "info",       is_secret: false, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  { uuid: "sv-3", key: "SENTRY_DSN",    value: "••••••",     is_secret: true,  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
];

// --- public API --------------------------------------------------------------

export async function listSharedVars() {
  if (isDemo()) return DEMO_VARS;
  return db.prepare(
    "SELECT uuid, key, value, is_secret, created_at, updated_at FROM shared_variables ORDER BY key"
  ).all().map((r) => ({ ...r, is_secret: !!r.is_secret }));
}

export async function upsertSharedVar({ key, value = "", is_secret = false }) {
  if (!key || typeof key !== "string" || !key.trim()) {
    throw Object.assign(new Error("key is required"), { status: 400 });
  }
  if (isDemo()) return { ok: true };
  const now = new Date().toISOString();
  // ponytail: crypto.randomUUID() is stdlib (Node 15+); no uuid package needed
  const { randomUUID } = await import("node:crypto");
  db.prepare(
    `INSERT INTO shared_variables (uuid, key, value, is_secret, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at`
  ).run(randomUUID(), key.trim(), value ?? "", is_secret ? 1 : 0, now, now);
  return { ok: true };
}

export async function deleteSharedVar(uuid) {
  if (!uuid || typeof uuid !== "string" || !uuid.trim()) {
    throw Object.assign(new Error("uuid is required"), { status: 400 });
  }
  if (isDemo()) return { ok: true };
  const info = db.prepare("DELETE FROM shared_variables WHERE uuid = ?").run(uuid.trim());
  if (info.changes === 0) {
    throw Object.assign(new Error("Shared variable not found"), { status: 404 });
  }
  return { ok: true };
}
