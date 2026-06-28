import { db } from "./db.js";

const VALID_TYPES = new Set(["application", "database", "service"]);

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

export function assertType(type) {
  if (!VALID_TYPES.has(type)) throw error(400, `Invalid resource type: ${type}`);
}

export function ownedUuids(userId, type) {
  assertType(type);
  return db
    .prepare(`SELECT coolify_uuid FROM resource_ownership WHERE user_id = ? AND type = ? ORDER BY created_at ASC`)
    .all(userId, type)
    .map((row) => row.coolify_uuid);
}

export function assertOwns(user, type, uuid) {
  assertType(type);
  if (!user) throw error(401, "Unauthorized");
  if (user.role === "admin") return true;
  const owned = db
    .prepare(`SELECT 1 FROM resource_ownership WHERE user_id = ? AND type = ? AND coolify_uuid = ?`)
    .get(user.id, type, uuid);
  if (!owned) throw error(404, "Not found");
  return true;
}

export function assign(uuid, type, userId) {
  assertType(type);
  db.prepare(`
    INSERT INTO resource_ownership (coolify_uuid, type, user_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(type, coolify_uuid) DO UPDATE SET
      user_id = excluded.user_id,
      created_at = excluded.created_at
  `).run(uuid, type, userId, new Date().toISOString());
}

export function listOwnedTypesForUser(userId) {
  return db
    .prepare(`SELECT type, coolify_uuid FROM resource_ownership WHERE user_id = ? ORDER BY type, coolify_uuid`)
    .all(userId);
}

