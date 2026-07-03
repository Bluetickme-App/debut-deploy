process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const dbm = await import("./db.js");
const { assign } = await import("./ownership.js");
const { buildProjectDetail } = await import("./projectview.js");

function seed(email) {
  const u = dbm.createUser({ email, role: "customer" });
  return { user: { id: u.id, role: "customer" }, orgId: dbm.ensureUserOrg(u.id) };
}

test("buildProjectDetail groups resources by kind with every category present", () => {
  const { user, orgId } = seed("rv1@x.com");
  const p = dbm.createProject(orgId, "Aurora Travel");
  const e = dbm.createEnvironment(orgId, p.id, "Production");
  assign("web-1", "application", user.id);
  dbm.db.prepare("UPDATE resource_ownership SET environment_id=?, kind='web_service' WHERE coolify_uuid='web-1'").run(e.id);
  assign("pg-1", "database", user.id);
  dbm.db.prepare("UPDATE resource_ownership SET environment_id=?, kind='postgres' WHERE coolify_uuid='pg-1'").run(e.id);

  const detail = buildProjectDetail(orgId, p.id);
  assert.equal(detail.project.slug, "aurora-travel");
  const env = detail.environments[0];
  assert.deepEqual(env.resourcesByKind.web_service.map((r) => r.coolify_uuid), ["web-1"]);
  assert.deepEqual(env.resourcesByKind.postgres.map((r) => r.coolify_uuid), ["pg-1"]);
  // every category key exists (empty arrays included) so the UI renders consistently
  assert.deepEqual(
    Object.keys(env.resourcesByKind).sort(),
    ["background_worker","cron_job","key_value","postgres","static_site","web_service"]
  );
});

test("buildProjectDetail returns undefined for another org's project", () => {
  const a = seed("rv2a@x.com"), b = seed("rv2b@x.com");
  const p = dbm.createProject(a.orgId, "A");
  assert.equal(buildProjectDetail(b.orgId, p.id), undefined);
});
