// Run: node --test server/gate.test.js
// The deploy-gate decision: who may deploy an app given comp/subscription/plan state.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
await import("./db.js");
const { deployGateDecision } = await import("./subscriptions.js");

const DAY = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000; // fixed clock
const withinGrace = now - 1 * DAY;   // failed yesterday — still in the 14-day window
const pastGrace = now - 20 * DAY;    // failed 20 days ago — past grace

test("comp org always deploys — even with no plan and a suspended sub", () => {
  assert.equal(deployGateDecision({ comp: true, subStatus: "suspended", planId: null, nowMs: now }).allow, true);
});

test("suspended → 402 account_suspended", () => {
  const d = deployGateDecision({ comp: false, subStatus: "suspended", planId: "pro", nowMs: now });
  assert.deepEqual(d, { allow: false, status: 402, code: "account_suspended" });
});

test("past_due past grace → 402 account_suspended (even before the sweep runs)", () => {
  const d = deployGateDecision({ comp: false, subStatus: "past_due", failedAt: pastGrace, planId: "pro", nowMs: now });
  assert.equal(d.code, "account_suspended");
});

test("past_due within grace + plan → allowed", () => {
  const d = deployGateDecision({ comp: false, subStatus: "past_due", failedAt: withinGrace, planId: "pro", nowMs: now });
  assert.equal(d.allow, true);
});

test("active/trialing sub + plan → allowed", () => {
  assert.equal(deployGateDecision({ comp: false, subStatus: "active", planId: "pro", nowMs: now }).allow, true);
  assert.equal(deployGateDecision({ comp: false, subStatus: "trialing", planId: "pro", nowMs: now }).allow, true);
});

test("no plan on the app → 402 plan_required (the free-hosting bypass)", () => {
  const d = deployGateDecision({ comp: false, subStatus: "active", planId: null, nowMs: now });
  assert.deepEqual(d, { allow: false, status: 402, code: "plan_required" });
});

test("priced app but no live subscription → 402 billing_setup_required", () => {
  const d = deployGateDecision({ comp: false, subStatus: null, planId: "pro", nowMs: now });
  assert.deepEqual(d, { allow: false, status: 402, code: "billing_setup_required" });
});
