// node:test suite for server/sharedvars.js
// Run: node --test server/test_sharedvars.mjs

process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999"; // not called in demo
process.env.COOLIFY_API_TOKEN = "demo-token";
process.env.DATABASE_FILE = ":memory:";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { listSharedVars, upsertSharedVar, deleteSharedVar } = await import("./sharedvars.js");

describe("sharedvars (demo)", () => {
  it("listSharedVars returns demo fixture array", async () => {
    const vars = await listSharedVars();
    assert.ok(Array.isArray(vars));
    assert.ok(vars.length > 0);
    assert.ok(vars.every((v) => v.uuid && v.key));
  });

  it("upsertSharedVar rejects empty key", async () => {
    await assert.rejects(
      () => upsertSharedVar({ key: "" }),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /key is required/);
        return true;
      }
    );
  });

  it("upsertSharedVar rejects whitespace-only key", async () => {
    await assert.rejects(
      () => upsertSharedVar({ key: "   " }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("upsertSharedVar rejects missing key", async () => {
    await assert.rejects(
      () => upsertSharedVar({}),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("upsertSharedVar returns ok in demo", async () => {
    const r = await upsertSharedVar({ key: "MY_VAR", value: "hello" });
    assert.equal(r.ok, true);
  });

  it("upsertSharedVar accepts is_secret flag in demo", async () => {
    const r = await upsertSharedVar({ key: "SECRET_VAR", value: "s3cr3t", is_secret: true });
    assert.equal(r.ok, true);
  });

  it("deleteSharedVar rejects empty uuid", async () => {
    await assert.rejects(
      () => deleteSharedVar(""),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /uuid is required/);
        return true;
      }
    );
  });

  it("deleteSharedVar returns ok in demo", async () => {
    const r = await deleteSharedVar("sv-1");
    assert.equal(r.ok, true);
  });
});
