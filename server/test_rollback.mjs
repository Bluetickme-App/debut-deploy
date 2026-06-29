import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "";
process.env.COOLIFY_API_TOKEN = "";

const { rollback } = await import("./coolify.js");

test("rollback demo returns ok with uuid and commit", async () => {
  const r = await rollback("app-uuid-x", "abc1234");
  assert.equal(r.ok, true);
  assert.equal(r.uuid, "app-uuid-x");
  assert.equal(r.commit, "abc1234");
});
