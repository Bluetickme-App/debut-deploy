// Org/membership/invite helpers. Run: node --test server/test_orgs.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";

const db = await import("./db.js");
const { assign } = await import("./ownership.js");

test("ensureUserOrg creates one owner membership and is idempotent", () => {
  const u = db.createUser({ email: "owner@x.com", name: "Owner Co", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  assert.equal(db.ensureUserOrg(u.id), orgId); // idempotent
  const m = db.getMembership(u.id);
  assert.equal(m.org_id, orgId);
  assert.equal(m.role, "owner");
});

test("ensureUserOrg backfills the user's existing ownership rows", () => {
  const u = db.createUser({ email: "back@x.com", role: "customer" });
  assign("app-back", "application", u.id); // assign resolves org (Task 4); pre-org it stamps user_id
  const orgId = db.ensureUserOrg(u.id);
  const row = db.db.prepare("SELECT org_id FROM resource_ownership WHERE coolify_uuid='app-back'").get();
  assert.equal(row.org_id, orgId);
});

test("createInvite returns a raw token; getValidInvite matches by hash", () => {
  const u = db.createUser({ email: "inv@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(u.id);
  const { token } = db.createInvite({ orgId, email: "new@x.com", role: "deployer", invitedBy: u.id });
  const found = db.getValidInvite(token);
  assert.equal(found.org_id, orgId);
  assert.equal(found.role, "deployer");
  assert.equal(db.getValidInvite("wrong-token"), undefined);
});

test("countOrgOwners + setMemberRole track the owner count", () => {
  const a = db.createUser({ email: "own1@x.com", role: "customer" });
  const orgId = db.ensureUserOrg(a.id);
  const b = db.createUser({ email: "mem1@x.com", role: "customer" });
  db.addMembership(b.id, orgId, "manager");
  assert.equal(db.countOrgOwners(orgId), 1);
  db.setMemberRole(b.id, "owner");
  assert.equal(db.countOrgOwners(orgId), 2);
});
