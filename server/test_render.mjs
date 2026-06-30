// node --test server/test_render.mjs
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Set demo mode before dynamic import so module-level DEMO is true
process.env.DEMO_MODE = "true";

const { listServices, getService, getEnvVars } = await import("./render.js");

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
