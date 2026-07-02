// Set env before dynamic import so module-level DEMO checks see them.
process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://demo.local";
process.env.COOLIFY_API_TOKEN = "demo-token";
process.env.DATABASE_FILE = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { importFromRender, assertPgUrl } = await import("./migrate.js");
const { addUserInstallation, findUserInstallationByLogin, seedUser } = await import("./db.js");

// Security: pg connection URL validation (argument-injection guard)
test("assertPgUrl accepts postgres:// and postgresql:// URLs", () => {
  assert.equal(assertPgUrl("postgres://u:p@h:5432/db"), "postgres://u:p@h:5432/db");
  assert.equal(assertPgUrl("postgresql://u:p@h/db"), "postgresql://u:p@h/db");
});

test("assertPgUrl rejects flag-smuggling / non-postgres values with 400", () => {
  for (const bad of ["--version", "-X", "file:///etc/passwd", "", null]) {
    assert.throws(() => assertPgUrl(bad), (e) => e.status === 400);
  }
});

// Shared stubs
const baseDeps = {
  assign: () => {},
};

// Real db helper: login-keyed lookup must be case-insensitive (the bug was
// keying by numeric account_id while migrate.js only has the login string).
test("findUserInstallationByLogin matches account_login case-insensitively", () => {
  const user = seedUser({ email: "login-test@example.com" }); // FK target for user_installations
  addUserInstallation({ userId: user.id, installationId: 99, accountLogin: "Acme", accountId: "12345" });
  const row = findUserInstallationByLogin(user.id, "acme");
  assert.ok(row, "should find the row by login regardless of case");
  assert.equal(row.installation_id, 99);
});

test("(a) happy path: ok:true, truthy appUuid, all non-skipped steps ok", async () => {
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared" },
    userId: 1,
    apiKey: undefined,
    deps: baseDeps,
  });

  assert.equal(result.ok, true, "ok should be true");
  assert.ok(result.appUuid, "appUuid should be truthy");

  const nonSkipped = result.steps.filter((s) => s.status !== "skipped");
  for (const s of nonSkipped) {
    assert.equal(s.status, "ok", `step "${s.step}" should be ok, got: ${s.status}`);
  }
});

test("(b) rollback: createDeployKeyApp fails → ok:false, create-app error, no assign", async () => {
  let assigned = false;

  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared" },
    userId: 1,
    apiKey: undefined,
    deps: {
      ...baseDeps,
      createDeployKeyApp: async () => {
        throw Object.assign(new Error("boom"), { status: 500 });
      },
      assign: () => {
        assigned = true;
      },
    },
  });

  assert.equal(result.ok, false, "ok should be false");
  const errStep = result.steps.find((s) => s.step === "create-app");
  assert.ok(errStep, "create-app step should exist");
  assert.equal(errStep.status, "error", "create-app step should be error");
  assert.equal(assigned, false, "assign should NOT have been called");
});

test("(c) steps includes read-render and deploy", async () => {
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared" },
    userId: 1,
    apiKey: undefined,
    deps: baseDeps,
  });

  const names = result.steps.map((s) => s.step);
  assert.ok(names.includes("read-render"), "steps should include read-render");
  assert.ok(names.includes("deploy"), "steps should include deploy");
});

test("(d) dbTarget existing → migrate-db runs, resolves target, wires DATABASE_URL to the target", async () => {
  let migrateArgs = null, dbUrlSet = null;
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared", datastoreId: "ds-1", dbTarget: { mode: "existing", uuid: "cool-db-1" } },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      getConnectionInfo: async () => "postgres://render:pw@ext:5432/app",
      resolveDbUrl: async (uuid) => `postgres://cool:pw@db-${uuid}.internal:5432/app`,
      migratePostgres: async ({ source, target }) => { migrateArgs = { source, target }; return { ok: true }; },
      upsertEnv: async (_uuid, { key, value }) => { if (key === "DATABASE_URL") dbUrlSet = value; },
    },
  });
  assert.equal(result.steps.find((s) => s.step === "migrate-db").status, "ok");
  assert.equal(migrateArgs.source, "postgres://render:pw@ext:5432/app");
  assert.equal(migrateArgs.target, "postgres://cool:pw@db-cool-db-1.internal:5432/app");
  assert.equal(dbUrlSet, "postgres://cool:pw@db-cool-db-1.internal:5432/app", "DATABASE_URL must point at the Coolify target, never the Render source");
});

test("(f) dbTarget shared → provisions a fresh logical DB as the target", async () => {
  let created = false, dbUrlSet = null, migrated = null;
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared", dbTarget: { mode: "shared", source: "dpg-x" } },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      getConnectionInfo: async () => "postgres://render:pw@ext:5432/app",
      createProjectDatabase: async () => ({ url: "postgresql://premium_u:pw@shared:5432/premium" }),
      migratePostgres: async ({ source, target }) => { created = true; migrated = { source, target }; return { ok: true }; },
      upsertEnv: async (_u, { key, value }) => { if (key === "DATABASE_URL") dbUrlSet = value; },
    },
  });
  assert.equal(result.steps.find((s) => s.step === "migrate-db").status, "ok");
  assert.ok(created, "migratePostgres ran into the provisioned target");
  assert.equal(migrated.target, "postgresql://premium_u:pw@shared:5432/premium");
  assert.equal(dbUrlSet, "postgresql://premium_u:pw@shared:5432/premium", "DATABASE_URL points at the fresh shared-cluster DB");
});

test("(e) dbTarget none → migrate-db skipped even when a datastore exists", async () => {
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared", datastoreId: "ds-1", dbTarget: { mode: "none" } },
    userId: 1, apiKey: "x", deps: baseDeps,
  });
  assert.equal(result.steps.find((s) => s.step === "migrate-db").status, "skipped");
});
