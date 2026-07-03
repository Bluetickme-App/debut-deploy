process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const dbm = await import("./db.js");
const { assign } = await import("./ownership.js");
const { placeResourceInEnvironment } = await import("./placement.js");

function seed(email) {
  const u = dbm.createUser({ email, role: "customer" });
  const orgId = dbm.ensureUserOrg(u.id);
  return { user: { id: u.id, role: "customer" }, orgId };
}

test("places an owned resource into an env in the caller's org", () => {
  const { user, orgId } = seed("pl1@x.com");
  assign("app-pl1", "application", user.id);
  const p = dbm.createProject(orgId, "Proj");
  const e = dbm.createEnvironment(orgId, p.id, "Production");
  const r = placeResourceInEnvironment({ user, type: "application", resourceUuid: "app-pl1", environmentId: e.id });
  assert.deepEqual(r, { ok: true });
  assert.equal(dbm.db.prepare("SELECT environment_id FROM resource_ownership WHERE coolify_uuid='app-pl1'").get().environment_id, e.id);
});

test("rejects placing into another org's environment (404)", () => {
  const a = seed("pl2a@x.com"), b = seed("pl2b@x.com");
  assign("app-pl2", "application", a.user.id);
  const pB = dbm.createProject(b.orgId, "B Proj");
  const eB = dbm.createEnvironment(b.orgId, pB.id, "Production");
  assert.throws(
    () => placeResourceInEnvironment({ user: a.user, type: "application", resourceUuid: "app-pl2", environmentId: eB.id }),
    (err) => err.status === 404
  );
});

test("rejects placing a resource the caller doesn't own (404)", () => {
  const a = seed("pl3a@x.com"), b = seed("pl3b@x.com");
  assign("app-pl3", "application", b.user.id); // owned by B
  const pA = dbm.createProject(a.orgId, "A Proj");
  const eA = dbm.createEnvironment(a.orgId, pA.id, "Production");
  assert.throws(
    () => placeResourceInEnvironment({ user: a.user, type: "application", resourceUuid: "app-pl3", environmentId: eA.id }),
    (err) => err.status === 404
  );
});

test("non-admin cannot unplace (environmentId null)", () => {
  const { user, orgId } = seed("pl4@x.com");
  assign("app-pl4", "application", user.id);
  assert.throws(
    () => placeResourceInEnvironment({ user, type: "application", resourceUuid: "app-pl4", environmentId: null }),
    (err) => err.status === 400
  );
});
