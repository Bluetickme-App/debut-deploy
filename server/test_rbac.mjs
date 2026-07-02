// Capability ladder. Run: node --test server/test_rbac.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCapability } from "./rbac.js";

test("viewer can read only", () => {
  assert.equal(hasCapability("viewer", "read"), true);
  assert.equal(hasCapability("viewer", "deploy"), false);
  assert.equal(hasCapability("viewer", "manage"), false);
});

test("deployer can deploy but not manage", () => {
  assert.equal(hasCapability("deployer", "deploy"), true);
  assert.equal(hasCapability("deployer", "manage"), false);
});

test("manager can manage but is not owner", () => {
  assert.equal(hasCapability("manager", "manage"), true);
  assert.equal(hasCapability("manager", "owner"), false);
});

test("owner can do everything up the ladder", () => {
  for (const lvl of ["read", "deploy", "manage", "owner"]) {
    assert.equal(hasCapability("owner", lvl), true);
  }
});
