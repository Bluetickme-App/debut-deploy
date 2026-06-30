// Set env before dynamic import so module-level DEMO checks see them.
process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://demo.local";
process.env.COOLIFY_API_TOKEN = "demo-token";
process.env.DATABASE_FILE = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { importFromRender } = await import("./migrate.js");

// Shared stubs
const baseDeps = {
  findUserInstallationByAccount: () => ({ installation_id: 42 }),
  assign: () => {},
};

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

test("(b) rollback: createPrivateGithubApp fails → ok:false, create-app error, no assign", async () => {
  let assigned = false;

  const result = await importFromRender({
    renderServiceId: "srv-demo1",
    target: { mode: "shared" },
    userId: 1,
    apiKey: undefined,
    deps: {
      ...baseDeps,
      createPrivateGithubApp: async () => {
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
