// Tests for server/hetzner.js — runs entirely in demo mode (no real API calls).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DEMO_MODE = "true";
// HETZNER_API_TOKEN intentionally not set → isDemo() is true regardless

const { createServer, listServerTypes } = await import("./hetzner.js");

test("createServer demo returns object with id and ip", async () => {
  const result = await createServer({ name: "test-srv", serverType: "cx22" });
  assert.ok(result.id !== undefined, "should have id");
  assert.ok(result.ip !== undefined, "should have ip");
});

test("createServer rejects missing name with status 400", async () => {
  await assert.rejects(
    () => createServer({ serverType: "cx22" }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("createServer rejects missing serverType with status 400", async () => {
  await assert.rejects(
    () => createServer({ name: "test-srv" }),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("listServerTypes demo returns non-empty array with name on each item", async () => {
  const types = await listServerTypes();
  assert.ok(Array.isArray(types) && types.length > 0, "should be non-empty array");
  for (const t of types) {
    assert.ok(typeof t.name === "string", "each item should have a name string");
  }
});
