// Run: node --test server/plans.test.js
// detectComputePlan maps a service's live Docker limits back to a plan tier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectComputePlan } from "./plans.js";

test("matches a service's CPU+RAM to its plan tier", () => {
  assert.equal(detectComputePlan(1, "2G"), "pro");        // 1 vCPU · 2 GB
  assert.equal(detectComputePlan(2, "4G"), "proplus");    // 2 vCPU · 4 GB
  assert.equal(detectComputePlan(0.5, "512M"), "hobby");  // 0.5 vCPU · 512 MB
  assert.equal(detectComputePlan(0.5, "1G"), "starter");  // same CPU, RAM disambiguates
});

test("returns null when limits are unset/unlimited — no false guess", () => {
  assert.equal(detectComputePlan("0", "0"), null);
  assert.equal(detectComputePlan(null, null), null);
});

test("returns null when limits don't match any tier", () => {
  assert.equal(detectComputePlan(1, "3G"), null);
  assert.equal(detectComputePlan(8, "16G"), null);
});
