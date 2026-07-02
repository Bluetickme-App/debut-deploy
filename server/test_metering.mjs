// Metering rate + rollup. Run: node --test server/test_metering.mjs
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { planById, planRatePencePerHour, planStorageGb } from "./metering.js";

test("planById finds compute and db plans", () => {
  assert.equal(planById("pro")?.priceMo, 15);
  assert.equal(planById("db-pro")?.priceMo, 45);
  assert.equal(planById("nope"), undefined);
});

test("planRatePencePerHour: pro → round(usdToPence(15) / 730.5)", () => {
  // usdToPence(15) with default rate 0.79 = round(15 * 0.79 * 100) = 1185 pence/mo.
  // 1185 / 730.5 = 1.622… → round → 2 pence/hour.
  assert.equal(planRatePencePerHour("pro"), 2);
  assert.equal(planRatePencePerHour("unknown"), 0);
});

test("planStorageGb parses the plan storage string", () => {
  assert.equal(planStorageGb("pro"), 80);       // COMPUTE_PLANS pro: disk "80 GB"
  assert.equal(planStorageGb("db-pro"), 50);    // DB_PLANS db-pro: storage "50 GB"
  assert.equal(planStorageGb("unknown"), 0);
});
