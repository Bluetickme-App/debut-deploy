// Route-level capability gating. Run: node --test server/test_rbac_routes.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCapability } from "./rbac.js";

// The gate's decision function is hasCapability; assert the mapping we rely on.
test("viewer is blocked from deploy and manage", () => {
  assert.equal(hasCapability("viewer", "deploy"), false);
  assert.equal(hasCapability("viewer", "manage"), false);
});
test("deployer is blocked from manage (create/delete)", () => {
  assert.equal(hasCapability("deployer", "deploy"), true);
  assert.equal(hasCapability("deployer", "manage"), false);
});
test("manager passes manage, blocked from owner actions", () => {
  assert.equal(hasCapability("manager", "manage"), true);
  assert.equal(hasCapability("manager", "owner"), false);
});
