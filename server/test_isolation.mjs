// Security core: tenant isolation. Run with: node --test server/test_isolation.mjs
// NOTE: set DATABASE_FILE before importing db.js (ESM hoists static imports),
// so db.js + ownership.js (which shares the connection) are loaded dynamically.
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createUser } = await import("./db.js");
const { ownedUuids, assertOwns, assign, assertType } = await import("./ownership.js");

const a = createUser({ email: "a@x.com", role: "customer" });
const b = createUser({ email: "b@x.com", role: "customer" });
const admin = createUser({ email: "admin@x.com", role: "admin" });
assign("app-a", "application", a.id);
assign("db-b", "database", b.id);

test("ownedUuids returns only the user's resources of that type", () => {
  assert.deepEqual(ownedUuids(a.id, "application"), ["app-a"]);
  assert.deepEqual(ownedUuids(a.id, "database"), []);
});

test("assertOwns passes for the owner", () => {
  assert.equal(assertOwns(a, "application", "app-a"), true);
});

test("assertOwns throws 404 for a non-owner (no existence leak)", () => {
  assert.throws(() => assertOwns(b, "application", "app-a"), (e) => e.status === 404);
});

test("ownership is type-aware: right uuid, wrong type is denied", () => {
  assert.throws(() => assertOwns(a, "service", "app-a"), (e) => e.status === 404);
});

test("admin bypasses ownership", () => {
  assert.equal(assertOwns(admin, "application", "app-a"), true);
  assert.equal(assertOwns(admin, "database", "db-b"), true);
});

test("unauthenticated assertOwns throws 401", () => {
  assert.throws(() => assertOwns(null, "application", "app-a"), (e) => e.status === 401);
});

test("invalid resource type is rejected", () => {
  assert.throws(() => assertType("bogus"), (e) => e.status === 400);
});
