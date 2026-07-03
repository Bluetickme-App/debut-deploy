// Run with: node --test server/test_apitokens.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createUser, createApiToken, getUserByApiToken, listApiTokens, deleteApiToken } = await import("./db.js");

test("token round-trips to its user; raw token is not stored", () => {
  const u = createUser({ email: "t@x.com", role: "customer" });
  const { id, token } = createApiToken(u.id, "ci");
  assert.match(token, /^dd_[0-9a-f]{48}$/);
  assert.equal(getUserByApiToken(token).id, u.id);     // resolves
  assert.equal(getUserByApiToken("dd_bogus"), undefined); // unknown -> undefined
  // listing never exposes the raw token or hash
  const list = listApiTokens(u.id);
  assert.equal(list[0].id, id);
  assert.ok(!("token" in list[0]) && !("token_hash" in list[0]));
});

test("tokens are scoped + revocable per user", () => {
  const a = createUser({ email: "a2@x.com", role: "customer" });
  const b = createUser({ email: "b2@x.com", role: "customer" });
  const { id, token } = createApiToken(a.id, "k");
  deleteApiToken(b.id, id);                 // wrong owner: no-op
  assert.equal(getUserByApiToken(token).id, a.id);
  deleteApiToken(a.id, id);                 // owner revokes
  assert.equal(getUserByApiToken(token), undefined);
});

test("scope: default full, read persists, bad value coerces to full", () => {
  const u = createUser({ email: "s@x.com", role: "customer" });
  const full = createApiToken(u.id, "f");                 // default
  const read = createApiToken(u.id, "r", "read");
  const bad  = createApiToken(u.id, "b", "banana");       // invalid → full

  assert.equal(getUserByApiToken(full.token).tokenScope, "full");
  assert.equal(getUserByApiToken(read.token).tokenScope, "read");
  assert.equal(getUserByApiToken(bad.token).tokenScope, "full");

  const byId = Object.fromEntries(listApiTokens(u.id).map((k) => [k.id, k.scope]));
  assert.equal(byId[full.id], "full");
  assert.equal(byId[read.id], "read");
  assert.equal(byId[bad.id], "full");
});

// Mirror the index.js Bearer guard: a read key may only make safe requests.
// (Same predicate as the route; kept in sync here per house test style.)
const readKeyBlocks = (scope, method) =>
  scope === "read" && method !== "GET" && method !== "HEAD";

test("read-only guard: blocks writes, allows reads; full is unrestricted", () => {
  assert.equal(readKeyBlocks("read", "POST"), true);
  assert.equal(readKeyBlocks("read", "DELETE"), true);
  assert.equal(readKeyBlocks("read", "PATCH"), true);
  assert.equal(readKeyBlocks("read", "GET"), false);
  assert.equal(readKeyBlocks("read", "HEAD"), false);
  assert.equal(readKeyBlocks("full", "POST"), false);
  assert.equal(readKeyBlocks("full", "DELETE"), false);
});
