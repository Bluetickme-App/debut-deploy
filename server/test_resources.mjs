// node:test suite for server/resources.js
// Run: node --test server/test_resources.mjs
//
// Uses DEMO_MODE=true so no live Coolify calls are made.

process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999"; // not called in demo
process.env.COOLIFY_API_TOKEN = "demo-token";

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic import AFTER env is set (isDemo() reads env at module load)
const { setLimits, setHealthcheck, getResourceUsage } = await import("./resources.js");

// --- setLimits ---

test("setLimits rejects empty uuid", async () => {
  await assert.rejects(
    () => setLimits("", { memory: "512M", cpus: "0.5" }),
    (e) => e.status === 400
  );
});

test("setLimits rejects missing memory and cpus", async () => {
  await assert.rejects(
    () => setLimits("some-uuid", {}),
    (e) => e.status === 400
  );
});

test("setLimits demo echoes memory and cpus", async () => {
  const result = await setLimits("demo-uuid", { memory: "512M", cpus: "0.5" });
  assert.equal(result.ok, true);
  assert.equal(result.memory, "512M");
  assert.equal(result.cpus, "0.5");
});

test("setLimits demo works with only memory", async () => {
  const result = await setLimits("demo-uuid", { memory: "1G" });
  assert.equal(result.ok, true);
  assert.equal(result.memory, "1G");
});

// --- setHealthcheck ---

test("setHealthcheck rejects empty uuid", async () => {
  await assert.rejects(
    () => setHealthcheck("", { enabled: true, path: "/health", port: 3000 }),
    (e) => e.status === 400
  );
});

test("setHealthcheck demo returns ok", async () => {
  const result = await setHealthcheck("demo-uuid", { enabled: true, path: "/health", port: 3000 });
  assert.equal(result.ok, true);
});

test("setHealthcheck demo works with enabled=false", async () => {
  const result = await setHealthcheck("demo-uuid", { enabled: false });
  assert.equal(result.ok, true);
});

// --- getResourceUsage ---

test("getResourceUsage rejects empty serverUuid", async () => {
  await assert.rejects(
    () => getResourceUsage(""),
    (e) => e.status === 400
  );
});

test("getResourceUsage demo returns fixture numbers", async () => {
  const result = await getResourceUsage("demo-server-uuid");
  assert.equal(result.cpu, 12);
  assert.equal(result.memory, 34);
  assert.equal(result.disk, 21);
});
