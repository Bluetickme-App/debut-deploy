import { test } from "node:test";
import assert from "node:assert/strict";

// Set DEMO_MODE before dynamic import so isDemo() reads true at module load
process.env.DEMO_MODE = "true";
// Avoid the env-check throw in coolify.js (not imported here, but be safe)
process.env.COOLIFY_BASE_URL = "http://localhost";
process.env.COOLIFY_API_TOKEN = "test";

const { createDatabase } = await import("./databases.js");

test("createDatabase rejects invalid type with status 400", async () => {
  const err = await createDatabase({ type: "oracle", name: "x", projectUuid: "p", environmentName: "production", serverUuid: "s" })
    .then(() => null)
    .catch((e) => e);
  assert.ok(err, "should have thrown");
  assert.equal(err.status, 400);
});

test("createDatabase demo returns uuid", async () => {
  const result = await createDatabase({ type: "postgresql", name: "mydb", projectUuid: "p", environmentName: "production", serverUuid: "s" });
  assert.equal(result.uuid, "demo-db-mydb");
});
