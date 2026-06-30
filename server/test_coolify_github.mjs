// node:test suite for server/coolify-github.js
// Run: node --test server/test_coolify_github.mjs

process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999"; // not called in demo
process.env.COOLIFY_API_TOKEN = "demo-token";

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic import AFTER env is set (isDemo() reads env at module load)
const { ensureCoolifySourceForInstallation } = await import("./coolify-github.js");

test("demo returns stub uuid containing the installationId", async () => {
  const result = await ensureCoolifySourceForInstallation("12345");
  assert.ok(result.github_app_uuid.includes("12345"));
});

test("missing installationId rejects with status 400", async () => {
  await assert.rejects(
    () => ensureCoolifySourceForInstallation(null),
    (e) => e.status === 400
  );
});
