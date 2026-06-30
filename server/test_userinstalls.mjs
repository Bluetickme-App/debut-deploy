// Run with: node --test server/test_userinstalls.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createUser, addUserInstallation, listUserInstallations, findUserInstallationByAccount } =
  await import("./db.js");

const user = createUser({ email: "installs@x.com", role: "customer" });

test("add two different installations for one user → both returned", () => {
  addUserInstallation({ userId: user.id, installationId: 101, accountLogin: "acme", accountId: "gh_1" });
  addUserInstallation({ userId: user.id, installationId: 202, accountLogin: "widgets", accountId: "gh_2" });
  const rows = listUserInstallations(user.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.installation_id === 101));
  assert.ok(rows.some((r) => r.installation_id === 202));
});

test("re-adding same (userId, installationId) updates in place — still one row", () => {
  addUserInstallation({ userId: user.id, installationId: 101, accountLogin: "acme-renamed", accountId: "gh_1" });
  const rows = listUserInstallations(user.id).filter((r) => r.installation_id === 101);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_login, "acme-renamed");
});

test("findUserInstallationByAccount returns the right row by accountId", () => {
  const row = findUserInstallationByAccount(user.id, "gh_2");
  assert.ok(row);
  assert.equal(row.installation_id, 202);
  assert.equal(row.account_login, "widgets");
  assert.equal(findUserInstallationByAccount(user.id, "nope"), undefined);
});
