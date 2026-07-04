// Run: node --test server/subscriptions.test.js
// Regression: orgCurrency queries organizations.billing_country. That column was never
// migrated in, so every call threw "no such column" and 500'd the admin billing view
// (stuck spinner) and startSubscriptionCheckout.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
const { db, createUser, getUserByEmail, ensureUserOrg } = await import("./db.js");
const subs = await import("./subscriptions.js");

function mkOrg(email, country) {
  createUser({ email, name: "t", role: "admin" });
  const org = ensureUserOrg(getUserByEmail(email).id);
  if (country) db.prepare("UPDATE organizations SET billing_country = ? WHERE id = ?").run(country, org);
  return org;
}

test("orgCurrency does not throw and defaults to gbp", () => {
  assert.equal(subs.orgCurrency(mkOrg("a@x.com")), "gbp");
});

test("orgCurrency derives usd from a non-UK billing country", () => {
  assert.equal(subs.orgCurrency(mkOrg("b@x.com", "US")), "usd");
});

test("orgCurrency derives gbp from a UK billing country", () => {
  assert.equal(subs.orgCurrency(mkOrg("c@x.com", "GB")), "gbp");
});
