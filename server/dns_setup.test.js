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

test("setDnsSetupStatus transitions pending to applied and stamps applied_at", () => {
  upsertDnsSetup({ orgId: "org2", domain: "d.com", kind: "mail", provider: null, status: "pending" });
  const beforeUpdate = getDnsSetup("org2", "d.com", "mail");
  assert.equal(beforeUpdate.status, "pending");
  assert.equal(beforeUpdate.applied_at, null);

  setDnsSetupStatus({ orgId: "org2", domain: "d.com", kind: "mail", status: "applied" });
  const afterUpdate = getDnsSetup("org2", "d.com", "mail");
  assert.equal(afterUpdate.status, "applied");
  assert.ok(afterUpdate.applied_at, "applied_at should be set");
});

test("upsert preserves applied_at on repeated applied status (no clobber)", async () => {
  upsertDnsSetup({ orgId: "org3", domain: "e.com", kind: "hosting", provider: null, status: "pending" });
  upsertDnsSetup({ orgId: "org3", domain: "e.com", kind: "hosting", provider: "IONOS", status: "applied" });
  const row1 = getDnsSetup("org3", "e.com", "hosting");
  assert.equal(row1.status, "applied");
  assert.ok(row1.applied_at, "applied_at stamped on first applied upsert");
  const appliedAtFirst = row1.applied_at;

  // Small delay to ensure timestamp would differ if rewritten
  await new Promise((resolve) => setTimeout(resolve, 10));

  upsertDnsSetup({ orgId: "org3", domain: "e.com", kind: "hosting", provider: "IONOS", status: "applied" });
  const row2 = getDnsSetup("org3", "e.com", "hosting");
  assert.equal(row2.applied_at, appliedAtFirst, "applied_at should NOT change on repeat applied upsert");
});
