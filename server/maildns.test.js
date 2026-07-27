// Run: node --test server/maildns.test.js
// The record→check contract the panel relies on, and the persisted-verify round-trip.
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const { setMailDomainOrg, getMailDnsChecks, setMailDnsChecks, deleteMailDomainRow } = await import("./db.js");
const { dnsRecords, webmailUrl, generatePassword, setMailboxPassword } = await import("./mail.js");

// ── temporary passwords (mailcow stores a hash; a reset is the only recovery path) ──

test("generatePassword: 4x4 groups, no look-alike characters", () => {
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword();
    assert.match(pw, /^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/, pw);
    // 0/O and 1/l/I are excluded so the value survives being read down a phone line.
    assert.ok(!/[0O1lI]/.test(pw), `ambiguous character in ${pw}`);
    assert.ok(pw.replace(/-/g, "").length >= 8, "comfortably over the 8-char minimum");
  }
});

test("generatePassword: does not repeat", () => {
  const seen = new Set(Array.from({ length: 500 }, () => generatePassword()));
  assert.equal(seen.size, 500, "500 generated passwords must all differ");
});

test("setMailboxPassword: rejects a too-short password before calling the mail server", async () => {
  await assert.rejects(() => setMailboxPassword("a@b.com", "short"), (e) => e.status === 400);
  await assert.rejects(() => setMailboxPassword("a@b.com", ""), (e) => e.status === 400);
  await assert.rejects(() => setMailboxPassword("a@b.com", undefined), (e) => e.status === 400);
});

test("dnsRecords carries a key on every record; required = mx/spf/dmarc", () => {
  const recs = dnsRecords("acme.com");
  assert.ok(recs.every((r) => r.key), "every record has a key to match its check");
  assert.deepEqual(recs.filter((r) => r.required).map((r) => r.key).sort(), ["dmarc", "mx", "spf"]);
});

// A webmail.<domain> CNAME to the mail host resolves fine but fails TLS — SNI is
// webmail.<customer-domain>, which that host's cert never carries. We stopped publishing
// it; this guards the regression, since re-adding it hands every customer a cert warning.
test("dnsRecords does NOT publish a webmail.<domain> CNAME", () => {
  const recs = dnsRecords("acme.com");
  assert.ok(!recs.some((r) => r.key === "webmail"), "no webmail record");
  assert.ok(!recs.some((r) => String(r.name).startsWith("webmail.")), "no webmail.* hostname");
});

test("webmailUrl is the one working URL, on the mail host, path-based", () => {
  assert.match(webmailUrl(), /^https:\/\/[^/]+\/SOGo$/);
  assert.ok(!webmailUrl().includes("//webmail."), "never a webmail.* subdomain");
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
