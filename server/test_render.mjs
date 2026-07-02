// node --test server/test_render.mjs
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Set demo mode before dynamic import so module-level DEMO is true
process.env.DEMO_MODE = "true";

const { listServices, getService, getEnvVars, listDatabases, normaliseService } = await import("./render.js");

describe("render.js normaliseService (real API shape)", () => {
  // Mirrors the live Render v1 shape verified 2026-07-02: list item wraps as
  // { cursor, service }; build/start under serviceDetails.envSpecificDetails.
  it("maps repo/branch top-level and build/start from envSpecificDetails", () => {
    const raw = {
      cursor: "c1",
      service: {
        id: "srv-x", name: "api", type: "web_service", repo: "https://github.com/o/r", branch: "main",
        rootDir: "", autoDeploy: "yes", dashboardUrl: "https://d",
        serviceDetails: {
          runtime: "node", region: "frankfurt", plan: "starter", healthCheckPath: "/health ",
          envSpecificDetails: { buildCommand: " npm ci && npm run build", startCommand: "node dist/server.js " },
        },
      },
    };
    const n = normaliseService(raw);
    assert.equal(n.id, "srv-x");
    assert.equal(n.repo, "https://github.com/o/r");
    assert.equal(n.branch, "main");
    assert.equal(n.buildCommand, "npm ci && npm run build", "build command must come from envSpecificDetails, trimmed");
    assert.equal(n.startCommand, "node dist/server.js");
    assert.equal(n.env, "node");
    assert.equal(n.region, "frankfurt");
    assert.equal(n.healthCheckPath, "/health");
  });
});

describe("render.js demo mode", () => {
  it("listServices() returns non-empty fixture array with id+name+repo", async () => {
    const services = await listServices();
    assert.ok(Array.isArray(services) && services.length > 0, "should be non-empty array");
    for (const s of services) {
      assert.ok(s.id, `missing id on item ${JSON.stringify(s)}`);
      assert.ok(s.name, `missing name on item ${JSON.stringify(s)}`);
      assert.ok(s.repo, `missing repo on item ${JSON.stringify(s)}`);
    }
  });

  it("getEnvVars() returns objects with key and value", async () => {
    const vars = await getEnvVars("srv-demo1");
    assert.ok(Array.isArray(vars) && vars.length > 0, "should be non-empty array");
    for (const v of vars) {
      assert.ok("key" in v, `missing key on ${JSON.stringify(v)}`);
      assert.ok("value" in v, `missing value on ${JSON.stringify(v)}`);
    }
  });

  it("getService('srv-demo1') returns the matching fixture", async () => {
    const svc = await getService("srv-demo1");
    assert.equal(svc.id, "srv-demo1");
    assert.ok(svc.name, "should have name");
  });
});
