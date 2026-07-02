import { db, getMembership, ensureUserOrg } from "./db.js";

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

export function listOwnedTypesForUser(userId) {
  const orgId = orgIdForUser(userId);
  if (orgId == null) return [];
  return db
    .prepare(`SELECT type, coolify_uuid FROM resource_ownership WHERE org_id = ? ORDER BY type, coolify_uuid`)
    .all(orgId);
}
