import { db } from "./db.js";

const INSERT = `
  INSERT INTO audit_events (
    user_id, action, resource_type, resource_uuid, ip, user_agent, metadata_json, created_at
  ) VALUES (
    @user_id, @action, @resource_type, @resource_uuid, @ip, @user_agent, @metadata_json, @created_at
  )`;

export function recordSystem(action, { resourceType = null, resourceUuid = null, metadata = null } = {}) {
  db.prepare(INSERT).run({
    user_id: null,
    action,
    resource_type: resourceType,
    resource_uuid: resourceUuid,
    ip: null,
    user_agent: "system",
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    created_at: new Date().toISOString(),
  });
}

export function record(req, action, { resourceType = null, resourceUuid = null, metadata = null } = {}) {
  db.prepare(INSERT).run({
    user_id: req.user?.id || null,
    action,
    resource_type: resourceType,
    resource_uuid: resourceUuid,
    ip: req.ip || req.headers["x-forwarded-for"] || null,
    user_agent: req.get ? req.get("user-agent") : req.headers["user-agent"] || null,
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    created_at: new Date().toISOString(),
  });
}

