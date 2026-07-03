// node --test server/friendlyError.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyError } from "./friendlyError.js";

const appCtx = { step: "deploy", resource: { type: "application", id: "app-9" } };

test("build failure → BUILD_FAILED with an MCP fix referencing the service", () => {
  const f = friendlyError({ message: "nixpacks build failed: exit code 1" }, appCtx);
  assert.equal(f.code, "BUILD_FAILED");
  assert.equal(f.mcpFixable, true);
  assert.ok(f.mcp.tools.includes("service_build_logs"));
  assert.equal(f.mcp.resource.id, "app-9");
  assert.match(f.mcp.hint, /app-9/);
});

test("missing env → MISSING_ENV, MCP fix uses set_service_env + deploy", () => {
  const f = friendlyError({ message: "connect ECONNREFUSED 127.0.0.1:5432 (DATABASE_URL not set)" }, appCtx);
  assert.equal(f.code, "MISSING_ENV");
  assert.deepEqual(f.mcp.tools, ["service_envs", "set_service_env", "deploy_service"]);
});

test("Render 401 → RENDER_AUTH is honestly NOT mcp-fixable (credential problem)", () => {
  const f = friendlyError({ message: "Render GET /services → 401" }, appCtx);
  assert.equal(f.code, "RENDER_AUTH");
  assert.equal(f.mcpFixable, false);
  assert.equal(f.mcp, null);
});

test("pg version skew → PG_VERSION, not mcp-fixable", () => {
  const f = friendlyError({ message: "pg_restore: error: unrecognized configuration parameter \"transaction_timeout\"" }, appCtx);
  assert.equal(f.code, "PG_VERSION");
  assert.equal(f.mcpFixable, false);
});

test("unknown error with an app → generic MCP diagnose hint", () => {
  const f = friendlyError({ message: "kaboom" }, appCtx);
  assert.equal(f.code, "UNKNOWN");
  assert.equal(f.mcpFixable, true);
  assert.ok(f.mcp.tools.includes("service_logs"));
});

test("pre-create failure (no resource) → no MCP block", () => {
  const f = friendlyError({ message: "kaboom" }, { step: "resolve-server", resource: null });
  assert.equal(f.mcpFixable, false);
  assert.equal(f.mcp, null);
});
