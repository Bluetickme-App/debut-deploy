// Run: DATABASE_FILE=:memory: node --test server/placement.test.js
// Covers claim-on-place: placing a resource that has no ownership row (deployed
// straight in Coolify, never imported) creates the row owned by the env's org.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
const { db, createUser, getUserByEmail, ensureUserOrg, createProject, createEnvironment } = await import("./db.js");
const { placeResourceInEnvironment } = await import("./placement.js");

function mkUser(email, role) {
  createUser({ email, name: email.split("@")[0], role });
  const u = getUserByEmail(email);
  ensureUserOrg(u.id);
  return u;
}
const mkAdmin = (email) => mkUser(email, "admin");

test("claim-on-place creates ownership for a never-imported resource", () => {
  const admin = mkAdmin("ops@x.com");
  const org = ensureUserOrg(admin.id);
  const proj = createProject(org, "Ops");
  const env = createEnvironment(org, proj.id, "Production");

  const r = placeResourceInEnvironment({ user: admin, type: "application", resourceUuid: "coolify-xyz", environmentId: env.id });
  assert.equal(r.ok, true);

  const row = db.prepare("SELECT org_id, environment_id FROM resource_ownership WHERE type='application' AND coolify_uuid='coolify-xyz'").get();
  assert.ok(row, "ownership row created");
  assert.equal(row.environment_id, env.id, "placed into the target env");
  assert.equal(row.org_id, org, "owned by the env's org");
});

test("a non-admin cannot claim an unowned resource (no IDOR)", () => {
  const cust = mkUser("c1@x.com", "customer");
  const org = ensureUserOrg(cust.id);
  const proj = createProject(org, "Cust");
  const env = createEnvironment(org, proj.id, "Production");
  assert.throws(
    () => placeResourceInEnvironment({ user: cust, type: "application", resourceUuid: "ghost-uuid", environmentId: env.id }),
    /Not found/,
  );
  const row = db.prepare("SELECT 1 FROM resource_ownership WHERE coolify_uuid='ghost-uuid'").get();
  assert.equal(row, undefined, "no ownership row was created");
});

test("re-placing an existing resource updates (no duplicate row)", () => {
  const admin = mkAdmin("ops2@x.com");
  const org = ensureUserOrg(admin.id);
  const proj = createProject(org, "Ops2");
  const e1 = createEnvironment(org, proj.id, "Production");
  const e2 = createEnvironment(org, proj.id, "Staging");

  placeResourceInEnvironment({ user: admin, type: "application", resourceUuid: "app-1", environmentId: e1.id });
  placeResourceInEnvironment({ user: admin, type: "application", resourceUuid: "app-1", environmentId: e2.id });

  const rows = db.prepare("SELECT environment_id FROM resource_ownership WHERE type='application' AND coolify_uuid='app-1'").all();
  assert.equal(rows.length, 1, "still one row");
  assert.equal(rows[0].environment_id, e2.id, "moved to the second env");
});
