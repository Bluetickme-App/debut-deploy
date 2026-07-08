// Run: node --test server/maildns.test.js
// The record→check contract the panel relies on, and the persisted-verify round-trip.
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const { setMailDomainOrg, getMailDnsChecks, setMailDnsChecks, deleteMailDomainRow } = await import("./db.js");
const { dnsRecords } = await import("./mail.js");

test("dnsRecords carries a key on every record incl webmail; required = mx/spf/dmarc", () => {
  const recs = dnsRecords("acme.com");
  assert.ok(recs.every((r) => r.key), "every record has a key to match its check");
  assert.ok(recs.some((r) => r.key === "webmail" && r.name === "webmail.acme.com"), "webmail is server-side + per-domain");
  assert.deepEqual(recs.filter((r) => r.required).map((r) => r.key).sort(), ["dmarc", "mx", "spf"]);
});

test("verify checks round-trip through the domain row until the next run", () => {
  setMailDomainOrg("acme.com", null); // domain row must exist (created when the domain is added)
  assert.equal(getMailDnsChecks("acme.com"), null, "nothing cached before the first Verify");
  const checks = [{ key: "mx", ok: true, required: true }, { key: "webmail", ok: false, required: false }];
  setMailDnsChecks("acme.com", checks);
  const got = getMailDnsChecks("acme.com");
  assert.deepEqual(got.checks, checks);
  assert.ok(got.checkedAt, "stamps when it was checked");
});

test("cached checks are dropped when the domain is removed", () => {
  setMailDomainOrg("gone.com", null);
  setMailDnsChecks("gone.com", [{ key: "mx", ok: true }]);
  deleteMailDomainRow("gone.com");
  assert.equal(getMailDnsChecks("gone.com"), null, "no orphaned checks after delete");
});
