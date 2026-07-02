// Org API guard rules. Run: node --test server/test_org_api.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const db = await import("./db.js");

test("cannot demote the last owner (guard uses countOrgOwners)", () => {
  const a = db.createUser({ email: "solo@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(a.id);
  // Simulate the route guard: refuse if demoting would drop owners to 0.
  const wouldDropLastOwner =
    db.getMembership(a.id).role === "owner" && db.countOrgOwners(orgId) <= 1;
  assert.equal(wouldDropLastOwner, true);
});

test("with a second owner, demotion is allowed", () => {
  const a = db.createUser({ email: "o1@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(a.id);
  const b = db.createUser({ email: "o2@x.com", role: "customer" });
  db.addMembership(b.id, orgId, "owner");
  const wouldDropLastOwner =
    db.getMembership(a.id).role === "owner" && db.countOrgOwners(orgId) <= 1;
  assert.equal(wouldDropLastOwner, false);
});
