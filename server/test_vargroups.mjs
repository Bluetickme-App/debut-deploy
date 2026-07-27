// node:test suite for server/vargroups.js
// Run: node --test server/test_vargroups.mjs
//
// Demo mode + in-memory DB: the Coolify pushes are no-ops (coolify.js branches on
// isDemo()), so this exercises the group/var/link bookkeeping and its guards.

process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999"; // not called in demo
process.env.COOLIFY_API_TOKEN = "demo-token";
process.env.DATABASE_FILE = ":memory:";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const vg = await import("./vargroups.js");

const ORG = 1;
const OTHER_ORG = 2;

describe("vargroups", () => {
  it("creates a group with vars and lists it back masked", async () => {
    const g = await vg.createGroup(ORG, {
      name: "payments",
      scope: "Global",
      vars: [
        { key: "STRIPE_KEY", value: "sk_live_1", is_secret: true },
        { key: "LOG_LEVEL", value: "info", is_secret: false },
      ],
    });
    const [found] = vg.listGroups(ORG).filter((x) => x.id === g.id);
    assert.equal(found.name, "payments");
    assert.equal(found.vars.length, 2);
    const secret = found.vars.find((v) => v.key === "STRIPE_KEY");
    assert.equal(secret.value, "", "secret value is withheld unless reveal");
    assert.equal(found.vars.find((v) => v.key === "LOG_LEVEL").value, "info");
  });

  it("reveals secret values only when asked", async () => {
    const g = vg.listGroups(ORG, { reveal: true }).find((x) => x.name === "payments");
    assert.equal(g.vars.find((v) => v.key === "STRIPE_KEY").value, "sk_live_1");
  });

  it("rejects a duplicate group name in the same org", async () => {
    await assert.rejects(() => vg.createGroup(ORG, { name: "payments" }), (e) => e.status === 409);
  });

  it("allows the same name in a different org, and hides it from the first", async () => {
    await vg.createGroup(OTHER_ORG, { name: "payments" });
    assert.equal(vg.listGroups(ORG).filter((g) => g.name === "payments").length, 1);
    assert.equal(vg.listGroups(OTHER_ORG).length, 1);
  });

  it("rejects an empty name", async () => {
    await assert.rejects(() => vg.createGroup(ORG, { name: "  " }), (e) => e.status === 400);
  });

  it("rejects an invalid variable name", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    await assert.rejects(
      () => vg.setVars(ORG, g.id, { key: "not a key", value: "x" }),
      (e) => e.status === 400
    );
  });

  it("upserts a variable and overwrites on repeat", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    await vg.setVars(ORG, g.id, { key: "LOG_LEVEL", value: "debug" });
    const after = vg.listGroups(ORG, { reveal: true }).find((x) => x.id === g.id);
    assert.equal(after.vars.filter((v) => v.key === "LOG_LEVEL").length, 1);
    assert.equal(after.vars.find((v) => v.key === "LOG_LEVEL").value, "debug");
  });

  it("renames a variable in place", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    await vg.renameVar(ORG, g.id, "LOG_LEVEL", "LOG_LVL");
    const after = vg.listGroups(ORG, { reveal: true }).find((x) => x.id === g.id);
    assert.ok(!after.vars.some((v) => v.key === "LOG_LEVEL"));
    assert.equal(after.vars.find((v) => v.key === "LOG_LVL").value, "debug");
  });

  it("refuses to rename onto an existing key", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    await assert.rejects(() => vg.renameVar(ORG, g.id, "LOG_LVL", "STRIPE_KEY"), (e) => e.status === 409);
  });

  it("attaches and detaches services", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    await vg.attachService(ORG, g.id, "svc-a");
    await vg.attachService(ORG, g.id, "svc-b");
    await vg.attachService(ORG, g.id, "svc-a"); // idempotent
    assert.deepEqual(vg.listGroups(ORG).find((x) => x.id === g.id).services.sort(), ["svc-a", "svc-b"]);
    assert.deepEqual(vg.groupsForService(ORG, "svc-a").map((x) => x.name), ["payments"]);

    await vg.detachService(ORG, g.id, "svc-b");
    assert.deepEqual(vg.listGroups(ORG).find((x) => x.id === g.id).services, ["svc-a"]);
  });

  it("forgetService drops every link for a deleted service", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    vg.forgetService("svc-a");
    assert.deepEqual(vg.listGroups(ORG).find((x) => x.id === g.id).services, []);
  });

  it("deletes a variable", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    await vg.deleteVar(ORG, g.id, "LOG_LVL");
    assert.ok(!vg.listGroups(ORG).find((x) => x.id === g.id).vars.some((v) => v.key === "LOG_LVL"));
    await assert.rejects(() => vg.deleteVar(ORG, g.id, "LOG_LVL"), (e) => e.status === 404);
  });

  it("never touches another org's group", async () => {
    const other = vg.listGroups(OTHER_ORG)[0];
    await assert.rejects(() => vg.deleteGroup(ORG, other.id), (e) => e.status === 404);
    await assert.rejects(() => vg.setVars(ORG, other.id, { key: "X", value: "1" }), (e) => e.status === 404);
    await assert.rejects(() => vg.attachService(ORG, other.id, "svc-a"), (e) => e.status === 404);
  });

  it("deletes a group and its vars + links", async () => {
    const g = vg.listGroups(ORG).find((x) => x.name === "payments");
    await vg.attachService(ORG, g.id, "svc-c");
    await vg.deleteGroup(ORG, g.id);
    assert.equal(vg.listGroups(ORG).length, 0);
    assert.equal(vg.groupsForService(ORG, "svc-c").length, 0);
  });
});
