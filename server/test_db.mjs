import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createUser, getUserById, getUserByEmail, findIdentity, linkIdentity } from "./db.js";

test("openDb creates schema and sets user_version", () => {
  const db = openDb(":memory:");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["users", "identities", "resource_ownership", "audit_events"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.ok(db.pragma("user_version", { simple: true }) >= 1);
});

test("createUser + lookups + identity linking", () => {
  const db = openDb(":memory:");
  const u = createUser(db, { email: "a@x.com", name: "A", avatarUrl: null, role: "customer" });
  assert.ok(u.id);
  assert.equal(getUserById(db, u.id).email, "a@x.com");
  assert.equal(getUserByEmail(db, "a@x.com").id, u.id);
  linkIdentity(db, { provider: "google", providerUserId: "g1", userId: u.id });
  assert.equal(findIdentity(db, "google", "g1").user_id, u.id);
  assert.equal(findIdentity(db, "google", "nope"), undefined);
});
