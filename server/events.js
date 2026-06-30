import { db } from "./db.js";

// _uid is selected for access decisions only (redaction); shape() strips it so
// it never reaches the client.
const SELECT = `
  SELECT
    e.id, e.action, e.resource_type, e.resource_uuid,
    e.user_id AS _uid, u.email AS actor_email, u.name AS actor_name,
    e.metadata_json, e.created_at
  FROM audit_events e
  LEFT JOIN users u ON u.id = e.user_id`;

// viewerId/isAdmin gate actor identity: a customer must not see the email/name
// of a DIFFERENT tenant who acted on a resource before it was reassigned to
// them (admin_assign / Render importer can re-home a resource). System events
// (_uid IS NULL) carry no identity. Admins see everything.
function shaper({ viewerId = null, isAdmin = false } = {}) {
  return (row) => {
    const { metadata_json, _uid, ...rest } = row;
    rest.metadata = metadata_json ? JSON.parse(metadata_json) : null;
    if (!isAdmin && _uid !== null && _uid !== viewerId) {
      rest.actor_email = null;
      rest.actor_name = null;
    }
    return rest;
  };
}

// Global activity feed. Admin (userId null) → all events. Customer → their own
// events PLUS system events (user_id NULL) on resources they own, so the
// headline service.down/up alerts actually appear in their feed.
export function listEvents({ userId = null, ownedUuids = [], limit = 100 } = {}) {
  const cap = Math.max(1, Math.min(limit, 500));
  if (userId === null) {
    return db.prepare(`${SELECT} ORDER BY e.id DESC LIMIT ?`).all(cap).map(shaper({ isAdmin: true }));
  }
  if (ownedUuids.length) {
    const ph = ownedUuids.map(() => "?").join(",");
    return db
      .prepare(`${SELECT} WHERE e.user_id = ? OR (e.user_id IS NULL AND e.resource_uuid IN (${ph})) ORDER BY e.id DESC LIMIT ?`)
      .all(userId, ...ownedUuids, cap)
      .map(shaper({ viewerId: userId }));
  }
  return db
    .prepare(`${SELECT} WHERE e.user_id = ? ORDER BY e.id DESC LIMIT ?`)
    .all(userId, cap)
    .map(shaper({ viewerId: userId }));
}

// Per-resource feed. The route enforces ownership before calling this; we still
// redact actor identity on rows that belonged to a prior owner (non-admins).
export function listEventsForResource(resourceUuid, { limit = 100, viewerId = null, isAdmin = false } = {}) {
  const cap = Math.max(1, Math.min(limit, 500));
  return db
    .prepare(`${SELECT} WHERE e.resource_uuid = ? ORDER BY e.id DESC LIMIT ?`)
    .all(resourceUuid, cap)
    .map(shaper({ viewerId, isAdmin }));
}
