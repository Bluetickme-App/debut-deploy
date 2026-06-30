import { db } from "./db.js";

const SELECT = `
  SELECT
    e.id, e.action, e.resource_type, e.resource_uuid,
    u.email AS actor_email, u.name AS actor_name,
    e.metadata_json, e.created_at
  FROM audit_events e
  LEFT JOIN users u ON u.id = e.user_id`;

function shape(row) {
  const { metadata_json, ...rest } = row;
  rest.metadata = metadata_json ? JSON.parse(metadata_json) : null;
  return rest;
}

export function listEvents({ userId = null, limit = 100 } = {}) {
  const cap = Math.min(limit, 500);
  if (userId !== null) {
    return db
      .prepare(`${SELECT} WHERE e.user_id = ? ORDER BY e.id DESC LIMIT ?`)
      .all(userId, cap)
      .map(shape);
  }
  return db.prepare(`${SELECT} ORDER BY e.id DESC LIMIT ?`).all(cap).map(shape);
}

export function listEventsForResource(resourceUuid, { limit = 100 } = {}) {
  const cap = Math.min(limit, 500);
  return db
    .prepare(`${SELECT} WHERE e.resource_uuid = ? ORDER BY e.id DESC LIMIT ?`)
    .all(resourceUuid, cap)
    .map(shape);
}
