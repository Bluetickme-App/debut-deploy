// Security core: tenant isolation is now ORG-scoped. Run: node --test server/test_isolation.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createUser, ensureUserOrg, getMembership, addMembership } = await import("./db.js");
const { ownedUuids, assertOwns, assign, assertType } = await import("./ownership.js");

const a = createUser({ email: "a@x.com", role: "customer" });
const b = createUser({ email: "b@x.com", role: "customer" });
const admin = createUser({ email: "admin@x.com", role: "admin" });
ensureUserOrg(a.id);
ensureUserOrg(b.id);
ensureUserOrg(admin.id);
assign("app-a", "application", a.id); // owned by a's org
assign("db-b", "database", b.id);     // owned by b's org

// A teammate in a's org shares a's resources.
const a2 = createUser({ email: "a2@x.com", role: "customer" });
addMembership(a2.id, getMembership(a.id).org_id, "viewer");

test("ownedUuids returns the org's resources for any member", () => {
  assert.deepEqual(ownedUuids(a.id, "application"), ["app-a"]);
  assert.deepEqual(ownedUuids(a2.id, "application"), ["app-a"]); // teammate sees org resource
  assert.deepEqual(ownedUuids(a.id, "database"), []);
});

test("assertOwns passes for a member of the owning org", () => {
  assert.equal(assertOwns(a, "application", "app-a"), true);
  assert.equal(assertOwns(a2, "application", "app-a"), true);
});

test("assertOwns throws 404 across orgs (no existence leak)", () => {
  assert.throws(() => assertOwns(b, "application", "app-a"), (e) => e.status === 404);
});

test("ownership is type-aware: right uuid, wrong type is denied", () => {
  assert.throws(() => assertOwns(a, "service", "app-a"), (e) => e.status === 404);
});

test("admin bypasses org scoping", () => {
  assert.equal(assertOwns(admin, "application", "app-a"), true);
  assert.equal(assertOwns(admin, "database", "db-b"), true);
});

test("unauthenticated assertOwns throws 401", () => {
  assert.throws(() => assertOwns(null, "application", "app-a"), (e) => e.status === 401);
});

test("invalid resource type is rejected", () => {
  assert.throws(() => assertType("bogus"), (e) => e.status === 400);
});
