// The ONLY writer of resource_ownership.environment_id. Every route/import/admin path
// funnels through here so both ownership and the target env's org are always validated.
import { db, getEnvironmentWithOrg, getMembership } from "./db.js";
import { assertOwns } from "./ownership.js";

export function placeResourceInEnvironment({ user, type, resourceUuid, environmentId }) {
  assertOwns(user, type, resourceUuid); // 404 if caller's org doesn't own the resource

  if (environmentId === null) {
    if (user?.role !== "admin") throw Object.assign(new Error("Cannot unplace a resource"), { status: 400 });
    db.prepare("UPDATE resource_ownership SET environment_id = NULL WHERE type = ? AND coolify_uuid = ?").run(type, resourceUuid);
    return { ok: true };
  }

  const env = getEnvironmentWithOrg(environmentId);
  if (!env) throw Object.assign(new Error("Not found"), { status: 404 });
  if (user?.role !== "admin") {
    const callerOrg = getMembership(user.id)?.org_id;   // admins may place across orgs deliberately
    if (env.org_id !== callerOrg) throw Object.assign(new Error("Not found"), { status: 404 });
  }
  db.prepare("UPDATE resource_ownership SET environment_id = ? WHERE type = ? AND coolify_uuid = ?").run(env.id, type, resourceUuid);
  return { ok: true };
}
