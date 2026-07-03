// Run: DATABASE_FILE=:memory: node --test server/transfer.test.js
// Covers transferProject: ownership (org_id + user_id) repoints, and destination
// slug collisions get suffixed instead of violating UNIQUE(org_id, slug).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:"; // must be set before db.js opens the singleton
const {
  db, createUser, getUserByEmail, ensureUserOrg,
  createProject, createEnvironment, transferProject,
} = await import("./db.js");

function mkUser(email) {
  createUser({ email, name: email.split("@")[0], role: "customer" });
  const u = getUserByEmail(email);
  ensureUserOrg(u.id); // give them an org
  return u;
}

function placeResource(uuid, envId, orgId, userId) {
  db.prepare(`INSERT INTO resource_ownership (coolify_uuid, type, user_id, org_id, environment_id, kind, created_at)
              VALUES (?, 'application', ?, ?, ?, 'web_service', datetime('now'))`)
    .run(uuid, userId, orgId, envId);
}

test("transfer repoints project + resource ownership to the target user's org", () => {
  const a = mkUser("a@x.com"), b = mkUser("b@x.com");
  const orgA = ensureUserOrg(a.id), orgB = ensureUserOrg(b.id);
  const proj = createProject(orgA, "Aurora Travel");
  const env = createEnvironment(orgA, proj.id, "Production");
  placeResource("res-1", env.id, orgA, a.id);

  const res = transferProject(proj.id, b.id);
  assert.equal(res.moved, 1);
  assert.equal(res.org_id, orgB);

  const p = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(proj.id);
  assert.equal(p.org_id, orgB, "project org moved to B");
  const r = db.prepare("SELECT org_id, user_id FROM resource_ownership WHERE coolify_uuid = 'res-1'").get();
  assert.equal(r.org_id, orgB, "resource org moved to B");
  assert.equal(r.user_id, b.id, "resource creator moved to B");
});

test("slug collision in destination org gets suffixed", () => {
  const a = mkUser("c@x.com"), b = mkUser("d@x.com");
  const orgA = ensureUserOrg(a.id), orgB = ensureUserOrg(b.id);
  createProject(orgB, "Shared");            // B already owns slug 'shared'
  const proj = createProject(orgA, "Shared"); // A's 'shared' will collide on move
  const res = transferProject(proj.id, b.id);
  assert.equal(res.slug, "shared-2", "destination slug suffixed to avoid UNIQUE clash");
});

test("transfer to the org that already owns it is a no-op", () => {
  const a = mkUser("e@x.com");
  const orgA = ensureUserOrg(a.id);
  const proj = createProject(orgA, "Same Owner");
  const res = transferProject(proj.id, a.id);
  assert.equal(res.moved, 0);
  assert.equal(res.org_id, orgA);
});
