// The ONLY writer of resource_ownership.environment_id. Every route/import/admin path
// funnels through here so both ownership and the target env's org are always validated.
import { db, getEnvironmentWithOrg, getMembership } from "./db.js";
import { assertOwns } from "./ownership.js";

export function placeResourceInEnvironment({ user, type, resourceUuid, environmentId }) {
  assertOwns(user, type, resourceUuid); // 404 if caller's org doesn't own the resource

  if (environmentId === null) {
    if (user?.role !== "admin") throw Object.assign(new Error("Cannot unplace a resource"), { status: 400 });
    const res = db.prepare("UPDATE resource_ownership SET environment_id = NULL WHERE type = ? AND coolify_uuid = ?").run(type, resourceUuid);
    if (!res.changes) throw Object.assign(new Error("Not found"), { status: 404 });
    return { ok: true };
  }

  const env = getEnvironmentWithOrg(environmentId);
  if (!env) throw Object.assign(new Error("Not found"), { status: 404 });
  if (user?.role !== "admin") {
    const callerOrg = getMembership(user.id)?.org_id;   // admins may place across orgs deliberately
    if (env.org_id !== callerOrg) throw Object.assign(new Error("Not found"), { status: 404 });
  }
  // Set org_id = env.org_id too: a resource must belong to whichever org's environment
  // it sits in, else an admin cross-org placement leaves a split org/env state that
  // leaks the resource into the target org's project view. No-op for same-org placement.
  const res = db.prepare("UPDATE resource_ownership SET environment_id = ?, org_id = ? WHERE type = ? AND coolify_uuid = ?").run(env.id, env.org_id, type, resourceUuid);
  if (!res.changes) {
    // No ownership row yet — the resource was deployed straight in Coolify and never
    // claimed through the panel. Placing it claims it for the target env's org.
    // ADMIN-ONLY: claiming an arbitrary Coolify UUID is a cross-tenant takeover if a
    // non-admin could reach it. assertOwns already 404s non-admins on unowned UUIDs,
    // but gate it explicitly here so the invariant doesn't depend on assertOwns internals.
    if (user?.role !== "admin") throw Object.assign(new Error("Not found"), { status: 404 });
    db.prepare(`INSERT INTO resource_ownership (coolify_uuid, type, user_id, org_id, environment_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(resourceUuid, type, user.id, env.org_id, env.id, new Date().toISOString());
  }
  return { ok: true };
}
