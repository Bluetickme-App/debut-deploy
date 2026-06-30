// node:test suite for server/monitor.js
// Run: node --test server/test_monitor.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotOf, diffStatuses, runHealthCheck } from "./monitor.js";

// --- diffStatuses ---

test("(a) up→down transition emits event with down:true", () => {
  const prev = { "abc": { name: "site-a", status: "running", health: "healthy" } };
  const curr = [{ uuid: "abc", name: "site-a", status: "exited", health: "unknown" }];
  const events = diffStatuses(prev, curr);
  assert.equal(events.length, 1);
  assert.equal(events[0].uuid, "abc");
  assert.equal(events[0].from, "running:healthy");
  assert.equal(events[0].to, "exited:unknown");
  assert.equal(events[0].down, true);
});

test("(b) down→up recovery emits event with down:false", () => {
  const prev = { "abc": { name: "site-a", status: "exited", health: "unknown" } };
  const curr = [{ uuid: "abc", name: "site-a", status: "running", health: "healthy" }];
  const events = diffStatuses(prev, curr);
  assert.equal(events.length, 1);
  assert.equal(events[0].down, false);
  assert.equal(events[0].from, "exited:unknown");
  assert.equal(events[0].to, "running:healthy");
});

test("(c) unchanged service produces no event", () => {
  const prev = { "abc": { name: "site-a", status: "running", health: "healthy" } };
  const curr = [{ uuid: "abc", name: "site-a", status: "running", health: "healthy" }];
  assert.deepEqual(diffStatuses(prev, curr), []);
});

test("(d) first-sight service (not in prev) produces no event", () => {
  const prev = {};
  const curr = [{ uuid: "new-uuid", name: "brand-new", status: "exited", health: "unknown" }];
  assert.deepEqual(diffStatuses(prev, curr), []);
});

// --- runHealthCheck ---

test("(e) runHealthCheck calls onTransition for down service and returns snapshot", async () => {
  const services = [
    { uuid: "svc1", name: "site-1", status: "exited", health: "unknown" },
  ];
  const prev = snapshotOf([
    { uuid: "svc1", name: "site-1", status: "running", health: "healthy" },
  ]);

  const calls = [];
  const result = await runHealthCheck({
    listServices: async () => services,
    prev,
    onTransition: (t) => calls.push(t),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].down, true);
  assert.ok(result.snapshot["svc1"]);
  assert.equal(result.snapshot["svc1"].status, "exited");
  assert.equal(result.transitions.length, 1);
});

test("(f) runHealthCheck when listServices throws returns error:true and does not throw", async () => {
  const prev = { "x": { name: "x", status: "running", health: "healthy" } };
  const result = await runHealthCheck({
    listServices: async () => { throw new Error("Coolify blip"); },
    prev,
  });
  assert.equal(result.error, true);
  assert.deepEqual(result.transitions, []);
  assert.deepEqual(result.snapshot, prev);
});
