// Run with: node --test server/test_db.mjs
// NOTE: set DATABASE_FILE before importing db.js. ESM hoists static imports
// above top-level code, so db.js is loaded via dynamic import() below.
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const { db, createUser, seedUser, getUserById, getUserByEmail, getUserByIdentity, upsertIdentity, listUsers } =
  await import("./db.js");

test("schema + pragmas are in place", () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["users", "identities", "resource_ownership", "audit_events"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.ok(db.pragma("user_version", { simple: true }) >= 1);
});

test("createUser + lookups", () => {
  const u = createUser({ email: "a@x.com", name: "A", avatar_url: null, role: "customer" });
  assert.ok(u.id);
  assert.equal(getUserById(u.id).email, "a@x.com");
  assert.equal(getUserByEmail("a@x.com").id, u.id);
  assert.equal(u.role, "customer");
});

test("identity linking resolves a user across providers", () => {
  const u = createUser({ email: "id@x.com", role: "customer" });
  upsertIdentity({ provider: "google", provider_user_id: "g1", user_id: u.id });
  upsertIdentity({ provider: "github", provider_user_id: "h9", user_id: u.id });
  assert.equal(getUserByIdentity("google", "g1").id, u.id);
  assert.equal(getUserByIdentity("github", "h9").id, u.id);
  assert.equal(getUserByIdentity("google", "nope"), undefined);
});

test("seedUser is idempotent by email", () => {
  const first = seedUser({ email: "demo@x.com", name: "Demo", role: "admin" });
  const again = seedUser({ email: "demo@x.com", name: "Demo", role: "admin" });
  assert.equal(first.id, again.id);
  assert.ok(listUsers().length >= 1);
});
