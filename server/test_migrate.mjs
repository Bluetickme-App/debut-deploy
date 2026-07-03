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

// Shared stubs. fetchBlueprint stubbed to null so the blueprint step stays offline
// (no GitHub call) and deterministic unless a test overrides it.
const baseDeps = {
  assign: () => {},
  fetchBlueprint: async () => null,
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

// Regression: Render normalises a missing branch to "" (not undefined), which slips
// past createDeployKeyApp's `branch = "main"` default and 422s at Coolify. migrate.js
// must coerce an empty branch to "main" before the create call.
test("(g) empty Render branch → Coolify create gets git_branch 'main', not ''", async () => {
  let seenBranch = "unset";
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared" },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      getService: async () => ({ id: "srv-demo1", name: "QrConnect", repo: "https://github.com/Bluetickme-App/QrConnect", branch: "", buildCommand: "", startCommand: "" }),
      getEnvVars: async () => [],
      createDeployKeyApp: async ({ branch }) => { seenBranch = branch; return { uuid: "app-qr" }; },
    },
  });
  assert.equal(result.steps.find((s) => s.step === "create-app").status, "ok");
  assert.equal(seenBranch, "main", "empty branch must fall back to main");
});

// Image-based Render services have no git repo (repo: "") — cloning that would 422
// with a confusing message, so migrate.js rejects it up front with a clear one.
test("(h) empty Render repo → create-app errors clearly, assign never runs", async () => {
  let assigned = false;
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared" },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      getService: async () => ({ id: "srv-demo1", name: "img-svc", repo: "", branch: "main" }),
      getEnvVars: async () => [],
      // TODO(you): fail the test if createDeployKeyApp is ever reached — the guard
      // must short-circuit BEFORE any Coolify call. Set a flag or throw here.
      createDeployKeyApp: async () => ({ uuid: "should-not-happen" }),
      assign: () => { assigned = true; },
    },
  });
  // TODO(you): assert result.ok === false, the create-app step is "error", its detail
  // mentions the repo problem, and `assigned` stayed false.
});

// Render blueprint (render.yaml) → applies health/rootDir/build/start + non-secret
// env to the created app; secrets are surfaced, not set.
test("(i) blueprint present → patchApp + non-secret env applied, secrets surfaced", async () => {
  let patched = null; const envSet = [];
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared" },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      fetchBlueprint: async () => ({
        buildCommand: "pip install -r requirements.txt", startCommand: "python dashboard.py",
        healthCheckPath: "/healthz", rootDir: "",
        env: [{ key: "DASH_HOST", value: "0.0.0.0" }], secretKeys: ["DASH_USER", "DASH_PASS"],
      }),
      patchApp: async (_uuid, fields) => { patched = fields; return { ok: true }; },
      upsertEnv: async (_uuid, { key, value }) => { envSet.push([key, value]); return { ok: true }; },
    },
  });
  const step = result.steps.find((s) => s.step === "blueprint");
  assert.equal(step.status, "ok");
  assert.equal(patched.health_check_path, "/healthz");
  assert.equal(patched.start_command, "python dashboard.py");
  assert.ok(envSet.some(([k, v]) => k === "DASH_HOST" && v === "0.0.0.0"), "non-secret env applied");
  assert.ok(!envSet.some(([k]) => k === "DASH_USER"), "secret NOT auto-set");
  assert.deepEqual(step.detail.secretsNeeded, ["DASH_USER", "DASH_PASS"]);
});

test("(j) no blueprint → step skipped, migration still succeeds", async () => {
  const result = await importFromRender({
    renderServiceId: "srv-demo1", target: { mode: "shared" }, userId: 1, apiKey: "x",
    deps: { ...baseDeps, fetchBlueprint: async () => null },
  });
  assert.equal(result.steps.find((s) => s.step === "blueprint").status, "skipped");
  assert.equal(result.ok, true);
});

// Money path: a dedicated migration provisions a billed Hetzner VM at resolve-server.
// If create-app fails, the VM must be torn down so a failed migration never orphans it.
test("(k) dedicated create-app fails → provisioned server torn down (no billing orphan)", async () => {
  let deletedHetzner = null, removedCoolify = null;
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "dedicated", serverType: "cx23", location: "fsn1" },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      provisionServer: async () => ({ serverUuid: "cool-srv-1", hetznerId: 999, ip: "1.2.3.4" }),
      getDefaultDestination: async () => "dest-1",
      createDeployKeyApp: async () => { throw Object.assign(new Error("boom"), { status: 500 }); },
      deleteServer: async (id) => { deletedHetzner = id; },
      removeCoolifyServer: async (uuid) => { removedCoolify = uuid; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.steps.find((s) => s.step === "create-app").status, "error");
  assert.equal(deletedHetzner, 999, "the Hetzner VM must be deleted");
  assert.equal(removedCoolify, "cool-srv-1", "the Coolify server entry must be removed");
});

test("(l) dedicated create-app SUCCEEDS → server kept (app lives on it, not an orphan)", async () => {
  let deletedHetzner = null;
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "dedicated", serverType: "cx23", location: "fsn1" },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      provisionServer: async () => ({ serverUuid: "cool-srv-1", hetznerId: 999, ip: "1.2.3.4" }),
      getDefaultDestination: async () => "dest-1",
      createDeployKeyApp: async () => ({ uuid: "app-1" }),
      deleteServer: async (id) => { deletedHetzner = id; },
    },
  });
  assert.equal(result.steps.find((s) => s.step === "create-app").status, "ok");
  assert.equal(deletedHetzner, null, "must NOT delete the server once an app is created on it");
});

// Regression: push-env re-pushes ALL Render env vars, and Render apps carry their own
// DATABASE_URL. Without a guard, that stale value overwrites the migrated target URL
// set at migrate-db → the deployed app points back at Render's DB. When a migration
// ran, DATABASE_URL from Render must be skipped so the migrated URL is the last word.
test("(m) migration ran → push-env skips Render's stale DATABASE_URL, migrated URL wins", async () => {
  const dbUrls = [];
  await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared", datastoreId: "ds-1", dbTarget: { mode: "existing", uuid: "cool-db-1" } },
    userId: 1, apiKey: "x",
    deps: {
      ...baseDeps,
      getService: async () => ({ id: "srv-demo1", name: "Premium", repo: "https://github.com/Bluetickme-App/Premium-Agent-Hub", branch: "main", buildCommand: "", startCommand: "" }),
      getEnvVars: async () => [{ key: "DATABASE_URL", value: "postgres://render:STALE@ext:5432/app" }, { key: "OTHER", value: "keep" }],
      getConnectionInfo: async () => "postgres://render:pw@ext:5432/app",
      resolveDbUrl: async (uuid) => `postgres://cool:pw@db-${uuid}.internal:5432/app`,
      migratePostgres: async () => ({ ok: true }),
      upsertEnv: async (_u, { key, value }) => { if ((key || "").toUpperCase() === "DATABASE_URL") dbUrls.push(value); },
    },
  });
  assert.ok(!dbUrls.includes("postgres://render:STALE@ext:5432/app"), "Render's stale DATABASE_URL must never be applied");
  assert.equal(dbUrls.at(-1), "postgres://cool:pw@db-cool-db-1.internal:5432/app", "the migrated target URL must be the final DATABASE_URL");
});

test("(e) dbTarget none → migrate-db skipped even when a datastore exists", async () => {
  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared", datastoreId: "ds-1", dbTarget: { mode: "none" } },
    userId: 1, apiKey: "x", deps: baseDeps,
  });
  assert.equal(result.steps.find((s) => s.step === "migrate-db").status, "skipped");
});
