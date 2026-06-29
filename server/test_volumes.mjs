// node:test suite for server/volumes.js
// Runs in demo mode (no Coolify needed).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Force demo mode before importing the module
process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999";
process.env.COOLIFY_API_TOKEN = "test-token";
process.env.NODE_ENV = "test";

const { listVolumes, addVolume, deleteVolume } = await import("./volumes.js");

describe("volumes (demo)", () => {
  it("listVolumes returns empty array in demo", async () => {
    const vols = await listVolumes("any-uuid");
    assert.deepEqual(vols, []);
  });

  it("addVolume rejects empty mountPath", async () => {
    await assert.rejects(
      () => addVolume("any-uuid", { name: "vol", mountPath: "" }),
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /mountPath is required/);
        return true;
      }
    );
  });

  it("addVolume rejects missing mountPath", async () => {
    await assert.rejects(
      () => addVolume("any-uuid", { name: "vol" }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("addVolume rejects whitespace-only mountPath", async () => {
    await assert.rejects(
      () => addVolume("any-uuid", { mountPath: "   " }),
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("addVolume returns ok in demo", async () => {
    const r = await addVolume("any-uuid", { name: "data", mountPath: "/data" });
    assert.equal(r.ok, true);
  });

  it("deleteVolume returns ok in demo", async () => {
    const r = await deleteVolume("any-uuid", "vol-uuid");
    assert.equal(r.ok, true);
  });
});
