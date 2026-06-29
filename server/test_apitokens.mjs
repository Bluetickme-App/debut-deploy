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
