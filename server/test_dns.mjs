// ponytail: assert-based self-check, no framework needed
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.COOLIFY_BASE_URL = "http://167.233.206.184:8000";
process.env.DEMO_MODE = "true";

const { verifyDomain } = await import("./dns.js");

test("rejects empty fqdn with status 400", async () => {
  await assert.rejects(
    () => verifyDomain(""),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test("rejects null fqdn with status 400", async () => {
  await assert.rejects(
    () => verifyDomain(null),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test("expectedIp derived from COOLIFY_BASE_URL", async () => {
  // Use a domain we expect to not resolve (or may resolve) — just check shape
  const result = await verifyDomain("example.com");
  assert.equal(result.expectedIp, "167.233.206.184");
  assert.equal(result.fqdn, "example.com");
  assert.ok(Array.isArray(result.resolvedIps));
  assert.ok(typeof result.pointsToServer === "boolean");
  assert.ok(result.instructions.includes("167.233.206.184"));
});
