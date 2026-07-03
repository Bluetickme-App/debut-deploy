// node --test server/import_cleanup.test.js
// Verifies shared-mode import cleans up a half-created app on a pre-deploy failure,
// leaves it on success, and never deletes on dedicated mode (would strand a paid VM).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DEMO_MODE = "true"; // coolify.js throws at load without creds unless demo
const { importFromRender } = await import("./migrate.js");

function baseDeps(deleted) {
  return {
    getService: async () => ({ id: "srv1", name: "app", repo: "https://github.com/o/r", branch: "main", buildCommand: "", startCommand: "" }),
    getEnvVars: async () => [{ key: "FOO", value: "bar" }],
    ensureAccountKey: async () => ({ uuid: "key-1" }),
    toSshUrl: (r) => r,
    ownerRepo: () => null,          // skip blueprint
    fetchBlueprint: async () => null,
    createDeployKeyApp: async () => ({ uuid: "app-x" }),
    upsertEnv: async () => ({}),
    assign: () => {},
    deleteApp: async (u) => { deleted.push(u); },
  };
}

test("shared import: pre-deploy failure tears down the orphaned app", async () => {
  const deleted = [];
  const r = await importFromRender({
    renderServiceId: "srv1", userId: 1, apiKey: "k",
    target: { mode: "shared", dbTarget: { mode: "none" } },
    deps: { ...baseDeps(deleted), deployService: async () => { throw new Error("deploy boom"); } },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(deleted, ["app-x"], "created app was deleted on failure");
});

test("shared import: full success leaves the app in place", async () => {
  const deleted = [];
  const r = await importFromRender({
    renderServiceId: "srv1", userId: 1, apiKey: "k",
    target: { mode: "shared", dbTarget: { mode: "none" } },
    deps: { ...baseDeps(deleted), deployService: async () => ({ ok: true }) },
  });
  assert.equal(r.ok, true);
  assert.equal(r.appUuid, "app-x");
  assert.deepEqual(deleted, [], "successful import must not delete the app");
});

test("grouped dedicated: reuses an existing box, provisions nothing", async () => {
  const deleted = [];
  let provisionCalls = 0, appArgs = null;
  const r = await importFromRender({
    renderServiceId: "srv1", userId: 1, apiKey: "k",
    target: { mode: "dedicated", serverUuid: "box-1", dbTarget: { mode: "none" } },
    deps: {
      ...baseDeps(deleted),
      provisionServer: async () => { provisionCalls++; return { serverUuid: "NEW", hetznerId: "h" }; },
      getDefaultDestination: async () => "dest-1",
      createDeployKeyApp: async (a) => { appArgs = a; return { uuid: "app-x" }; },
      deployService: async () => ({ ok: true }),
    },
  });
  assert.equal(r.ok, true);
  assert.equal(provisionCalls, 0, "must not provision — reuse the existing box");
  assert.equal(appArgs.serverUuid, "box-1", "deployed onto the existing box");
});

test("grouped dedicated: a failed sibling is cleaned up but the shared box is left", async () => {
  const deleted = [];
  const r = await importFromRender({
    renderServiceId: "srv1", userId: 1, apiKey: "k",
    target: { mode: "dedicated", serverUuid: "box-1", dbTarget: { mode: "none" } },
    deps: {
      ...baseDeps(deleted),
      getDefaultDestination: async () => "dest-1",
      deployService: async () => { throw new Error("boom"); },
    },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(deleted, ["app-x"], "failed app cleaned up; box shared by the group untouched");
});

test("dedicated import: failure does NOT delete the app (would strand the paid server)", async () => {
  const deleted = [];
  const r = await importFromRender({
    renderServiceId: "srv1", userId: 1, apiKey: "k",
    target: { mode: "dedicated", serverType: "cx22", location: "hel1", dbTarget: { mode: "none" } },
    deps: {
      ...baseDeps(deleted),
      provisionServer: async () => ({ serverUuid: "srv-1", hetznerId: "h1" }),
      getDefaultDestination: async () => "dest-1",
      removeCoolifyServer: async () => {},
      deleteServer: async () => {},
      deployService: async () => { throw new Error("deploy boom"); },
    },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(deleted, [], "dedicated mode must not auto-delete the app");
});
