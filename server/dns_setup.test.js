// node --test server/dns_setup.test.js
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const { upsertDnsSetup, getDnsSetup, setDnsSetupStatus } = await import("./db.js");

test("upsert creates a row, second upsert updates in place (org null coerced)", () => {
  upsertDnsSetup({ orgId: null, domain: "acme.com", kind: "mail", provider: null, status: "pending" });
  upsertDnsSetup({ orgId: null, domain: "acme.com", kind: "mail", provider: "GoDaddy", status: "applied" });
  const row = getDnsSetup(null, "acme.com", "mail");
  assert.equal(row.org_id, "");
  assert.equal(row.provider, "GoDaddy");
  assert.equal(row.status, "applied");
  assert.ok(row.applied_at, "applied_at stamped when status becomes applied");
});

test("setDnsSetupStatus verified stamps verified_at", () => {
  upsertDnsSetup({ orgId: "org1", domain: "b.com", kind: "hosting", provider: "IONOS", status: "applied" });
  setDnsSetupStatus({ orgId: "org1", domain: "b.com", kind: "hosting", status: "verified", verified: true });
  const row = getDnsSetup("org1", "b.com", "hosting");
  assert.equal(row.status, "verified");
  assert.ok(row.verified_at);
});

test("rows are keyed by (org, domain, kind) — different kind is a different row", () => {
  upsertDnsSetup({ orgId: "org1", domain: "c.com", kind: "mail", provider: null, status: "manual" });
  upsertDnsSetup({ orgId: "org1", domain: "c.com", kind: "hosting", provider: null, status: "pending" });
  assert.equal(getDnsSetup("org1", "c.com", "mail").status, "manual");
  assert.equal(getDnsSetup("org1", "c.com", "hosting").status, "pending");
});
