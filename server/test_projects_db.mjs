process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const db = await import("./db.js");

function newOrg(email) {
  const u = db.createUser({ email, role: "customer" });
  return db.ensureUserOrg(u.id);
}

test("createProject slugifies and is org-unique-scoped", () => {
  const org = newOrg("p1@x.com");
  const p = db.createProject(org, "Aurora Travel");
  assert.equal(p.slug, "aurora-travel");
  assert.ok(p.id);
  assert.throws(() => db.createProject(org, "Aurora Travel")); // UNIQUE(org_id, slug)
});

test("createProject in a different org with the same name is allowed", () => {
  const a = newOrg("p2a@x.com"), b = newOrg("p2b@x.com");
  db.createProject(a, "Shared Name");
  assert.ok(db.createProject(b, "Shared Name").id); // different org
});

test("getProject is org-scoped (another org's project is invisible)", () => {
  const a = newOrg("p3a@x.com"), b = newOrg("p3b@x.com");
  const p = db.createProject(a, "Only A");
  assert.ok(db.getProject(a, p.id));
  assert.equal(db.getProject(b, p.id), undefined);
});

test("createEnvironment rejects a project outside the caller's org", () => {
  const a = newOrg("p4a@x.com"), b = newOrg("p4b@x.com");
  const p = db.createProject(a, "A Proj");
  assert.throws(() => db.createEnvironment(b, p.id, "Production"), (e) => e.status === 404);
  assert.ok(db.createEnvironment(a, p.id, "Production").id);
});

test("ensureDefaultProjectEnv is idempotent", () => {
  const org = newOrg("p5@x.com");
  const first = db.ensureDefaultProjectEnv(org);
  const second = db.ensureDefaultProjectEnv(org);
  assert.deepEqual(first, second);
  assert.equal(db.listProjects(org).filter((p) => p.slug === "default").length, 1);
});

test("getEnvironmentWithOrg resolves env → project → org", () => {
  const org = newOrg("p6@x.com");
  const p = db.createProject(org, "Proj");
  const e = db.createEnvironment(org, p.id, "Production");
  assert.deepEqual(db.getEnvironmentWithOrg(e.id), { id: e.id, project_id: p.id, org_id: org });
});
