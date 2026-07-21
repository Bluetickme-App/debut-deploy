import test from "node:test";
import assert from "node:assert/strict";
import { buildProgress } from "./buildeta.js";

const T0 = Date.parse("2026-07-20T00:00:00.000Z");
const at = (sec) => T0 + sec * 1000;
const row = (over = {}) => ({ uuid: "app1", status: "in_progress", startedAt: "2026-07-20T00:00:00.000Z", ...over });

test("halfway through the median build reads ~50%", () => {
  const p = buildProgress(row(), { app1: 100 }, at(50));
  assert.equal(p.pct, 50);
  assert.equal(p.etaSec, 50);
});

test("an overrunning build clamps to 99, never 100+", () => {
  // 88026s wedged-but-'finished' builds are real on this fleet; the bar must not wrap.
  assert.equal(buildProgress(row(), { app1: 100 }, at(1000)).pct, 99);
  assert.equal(buildProgress(row(), { app1: 100 }, at(1000)).etaSec, 0, "ETA floors at 0, no negatives");
});

test("no history means no bar, not a fabricated one", () => {
  assert.equal(buildProgress(row(), {}, at(50)), null);
  assert.equal(buildProgress(row(), { app1: 0 }, at(50)), null);
});

test("queued builds get no progress — only what's actually running", () => {
  assert.equal(buildProgress(row({ status: "queued" }), { app1: 100 }, at(50)), null);
});

test("unparseable or future start times degrade to no bar", () => {
  assert.equal(buildProgress(row({ startedAt: null }), { app1: 100 }, at(50)), null);
  assert.equal(buildProgress(row(), { app1: 100 }, at(-10)), null, "clock skew must not render a negative bar");
});
