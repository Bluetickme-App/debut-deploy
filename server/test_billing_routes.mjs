// Billing route gating + plan validation. Run: node --test server/test_billing_routes.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCapability } from "./rbac.js";
import { planPriceUsd } from "./plans.js";

test("all members read the wallet; only owner mutates (topup/portal)", () => {
  assert.equal(hasCapability("viewer", "read"), true);
  assert.equal(hasCapability("deployer", "read"), true);
  assert.equal(hasCapability("manager", "read"), true);
  assert.equal(hasCapability("viewer", "owner"), false);
  assert.equal(hasCapability("deployer", "owner"), false);
  assert.equal(hasCapability("manager", "owner"), false);
  assert.equal(hasCapability("owner", "owner"), true);
});

test("plan assignment is manage-gated; unknown plan id is invalid (price 0)", () => {
  assert.equal(hasCapability("deployer", "manage"), false);
  assert.equal(hasCapability("manager", "manage"), true);
  assert.equal(planPriceUsd("pro") > 0, true);   // valid plan
  assert.equal(planPriceUsd("not-a-plan"), 0);   // route rejects (see handler)
});
