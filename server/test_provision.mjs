// Tests for server/provision.js
// Run: node --test server/test_provision.mjs

process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999";
process.env.COOLIFY_API_TOKEN = "test-token";

import { test } from "node:test";
import assert from "node:assert/strict";

const { provisionServer } = await import("./provision.js");

const noSleep = () => Promise.resolve();

test("demo provisionServer returns serverUuid, ip, status running, all steps ok", async () => {
  const result = await provisionServer({ name: "box1", serverType: "cx22", sleep: noSleep });

  assert.ok(result.serverUuid, "serverUuid should be truthy");
  assert.ok(result.ip, "ip should be truthy");
  assert.equal(result.status, "running");
  assert.ok(Array.isArray(result.steps), "steps should be an array");
  for (const s of result.steps) {
    assert.equal(s.status, "ok", `step "${s.step}" should have status ok`);
  }
});

test("missing name rejects with status 400", async () => {
  await assert.rejects(
    () => provisionServer({ serverType: "cx22", sleep: noSleep }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("missing serverType rejects with status 400", async () => {
  await assert.rejects(
    () => provisionServer({ name: "box1", sleep: noSleep }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("steps array includes create-server, await-running, register-coolify", async () => {
  const result = await provisionServer({ name: "box1", serverType: "cx22", sleep: noSleep });
  const stepNames = result.steps.map((s) => s.step);
  assert.ok(stepNames.includes("create-server"), "missing create-server step");
  assert.ok(stepNames.includes("await-running"), "missing await-running step");
  assert.ok(stepNames.includes("register-coolify"), "missing register-coolify step");
});
