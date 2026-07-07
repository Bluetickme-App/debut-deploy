// node --test server/dns_routes.test.js
process.env.DATABASE_FILE = ":memory:";
process.env.SESSION_SECRET = "test-secret";
import { test } from "node:test";
import assert from "node:assert/strict";
const { applyCallbackResult } = await import("./domainconnect.js");
const { getDnsSetup, upsertDnsSetup } = await import("./db.js");

test("applyCallbackResult error param marks the row failed", async () => {
  upsertDnsSetup({ orgId: "o1", domain: "acme.com", kind: "mail", provider: "GoDaddy", status: "pending" });
  await applyCallbackResult({ orgId: "o1", domain: "acme.com", kind: "mail", error: "access_denied", verify: async () => true });
  assert.equal(getDnsSetup("o1", "acme.com", "mail").status, "failed");
});

test("applyCallbackResult success verifies and marks verified", async () => {
  upsertDnsSetup({ orgId: "o1", domain: "b.com", kind: "hosting", provider: "IONOS", status: "pending" });
  await applyCallbackResult({ orgId: "o1", domain: "b.com", kind: "hosting", error: null, verify: async () => true });
  const row = getDnsSetup("o1", "b.com", "hosting");
  assert.equal(row.status, "verified");
  assert.ok(row.verified_at);
});

test("applyCallbackResult success but not-yet-propagated stays applied", async () => {
  upsertDnsSetup({ orgId: "o1", domain: "c.com", kind: "mail", provider: "GoDaddy", status: "pending" });
  await applyCallbackResult({ orgId: "o1", domain: "c.com", kind: "mail", error: null, verify: async () => false });
  assert.equal(getDnsSetup("o1", "c.com", "mail").status, "applied");
});
