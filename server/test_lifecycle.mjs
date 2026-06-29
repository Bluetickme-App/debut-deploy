import { test } from "node:test";
import assert from "node:assert/strict";

// Force demo mode so coolify.js doesn't throw on missing env
process.env.DEMO_MODE = "true";
process.env.NODE_ENV = "test";

const { deleteApp, setDomain } = await import("./lifecycle.js");

test("deleteApp demo returns ok", async () => {
  const r = await deleteApp("any-uuid");
  assert.equal(r.ok, true);
});

test("setDomain rejects empty fqdn with status 400", async () => {
  for (const bad of ["", "   ", null, undefined]) {
    await assert.rejects(
      () => setDomain("any-uuid", bad),
      (err) => err.status === 400
    );
  }
});

test("setDomain demo returns ok + fqdn", async () => {
  const r = await setDomain("any-uuid", "app.example.com");
  assert.equal(r.ok, true);
  assert.equal(r.fqdn, "app.example.com");
});
