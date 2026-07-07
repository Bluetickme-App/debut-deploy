// Run: node --test server/plans.test.js
// detectComputePlan maps a service's live Docker limits back to a plan tier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectComputePlan, mailPlans } from "./plans.js";

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

test("mailPlans: GBP-native £2.99 + margin math", () => {
  const p = mailPlans().find((x) => x.id === "mail-standard");
  assert.ok(p, "mail-standard plan exists");
  assert.equal(p.priceGbp, 2.99);   // exact £2.99, not USD→GBP converted
  assert.equal(p.costGbp, 0.55);
  assert.equal(p.marginGbp, 2.44);  // 299 - 55 = 244p
  assert.equal(p.marginPct, Math.round((244 / 55) * 100));
});
