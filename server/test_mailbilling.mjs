// node:test suite for server/mailbilling.js — the billing-attribution reconcile.
// Run: node --test server/test_mailbilling.mjs
//
// Every app module is a DYNAMIC import: ESM hoists static imports above these env lines,
// which would open the real server/data/debut.db instead of :memory:.

process.env.DATABASE_FILE = ":memory:";
process.env.DEMO_MODE = "true";

import { test } from "node:test";
import assert from "node:assert/strict";

const { db, setMailDomainOrg, addMailboxRow } = await import("./db.js");
const { reconcile } = await import("./mailbilling.js");

// Fake mail server. listMailboxes throws for any domain in `broken`.
function fakeMail(map, broken = new Set()) {
  return {
    listDomains: async () => Object.keys(map).map((domain) => ({ domain })),
    listMailboxes: async (d) => {
      if (broken.has(d)) throw new Error("upstream 502");
      return (map[d] || []).map((address) => ({ address }));
    },
  };
}

// org_id carries a FOREIGN KEY to organizations(id) and foreign_keys is ON, so the orgs
// these tests assign to have to actually exist.
for (const id of [3, 7]) {
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (?,?,?,?)")
    .run(id, `Org ${id}`, `org-${id}`, new Date().toISOString());
}

const reset = () => { db.exec("DELETE FROM mail_mailboxes; DELETE FROM mail_domains;"); };
const orgOf = (address) => db.prepare("SELECT org_id FROM mail_mailboxes WHERE address = ?").get(address)?.org_id;
const addresses = () => db.prepare("SELECT address FROM mail_mailboxes ORDER BY address").all().map((r) => r.address);

test("imports domains and mailboxes that exist only upstream", async () => {
  reset();
  const s = await reconcile({ mail: fakeMail({ "acme.com": ["a@acme.com", "b@acme.com"] }) });
  assert.equal(s.domainsAdded, 1);
  assert.equal(s.mailboxesAdded, 2);
  assert.deepEqual(addresses(), ["a@acme.com", "b@acme.com"]);
  // Imported with no owner — surfaced so the operator knows it bills nobody yet.
  assert.deepEqual(s.unassigned, ["acme.com"]);
});

test("is idempotent — a second run changes nothing", async () => {
  const s = await reconcile({ mail: fakeMail({ "acme.com": ["a@acme.com", "b@acme.com"] }) });
  assert.equal(s.domainsAdded, 0);
  assert.equal(s.mailboxesAdded, 0);
  assert.equal(s.mailboxesRemoved, 0);
  assert.equal(s.mailboxesReStamped, 0);
});

test("re-stamps mailbox rows from their domain's org — the fix that makes billing count them", async () => {
  reset();
  const mail = fakeMail({ "acme.com": ["a@acme.com", "b@acme.com"] });
  await reconcile({ mail });
  assert.equal(orgOf("a@acme.com"), null, "imported unassigned");

  // Operator assigns the DOMAIN. Mailbox rows still carry the old null until reconcile.
  setMailDomainOrg("acme.com", 7);
  const s = await reconcile({ mail });
  assert.equal(s.mailboxesReStamped, 2);
  assert.equal(orgOf("a@acme.com"), 7);
  assert.equal(orgOf("b@acme.com"), 7);
  assert.deepEqual(s.unassigned, [], "no longer reported as unassigned");
});

test("unassigning a domain cascades back to null (IS NOT is null-safe)", async () => {
  const mail = fakeMail({ "acme.com": ["a@acme.com", "b@acme.com"] });
  setMailDomainOrg("acme.com", null);
  const s = await reconcile({ mail });
  assert.equal(s.mailboxesReStamped, 2);
  assert.equal(orgOf("a@acme.com"), null);
});

test("drops mailboxes deleted upstream so they stop being billed", async () => {
  reset();
  const before = fakeMail({ "acme.com": ["a@acme.com", "gone@acme.com"] });
  await reconcile({ mail: before });
  const after = fakeMail({ "acme.com": ["a@acme.com"] });
  const s = await reconcile({ mail: after });
  assert.equal(s.mailboxesRemoved, 1);
  assert.deepEqual(addresses(), ["a@acme.com"]);
});

// The dangerous failure mode: one transient upstream error must never be read as
// "this domain has no mailboxes" and wipe real, billable rows.
test("a failing mailbox listing NEVER deletes that domain's rows", async () => {
  reset();
  await reconcile({ mail: fakeMail({ "acme.com": ["a@acme.com", "b@acme.com"] }) });
  assert.equal(addresses().length, 2);

  const s = await reconcile({ mail: fakeMail({ "acme.com": ["a@acme.com", "b@acme.com"] }, new Set(["acme.com"])) });
  assert.equal(s.mailboxesRemoved, 0, "no deletions from a failed listing");
  assert.deepEqual(addresses(), ["a@acme.com", "b@acme.com"], "rows survive the outage");
});

test("one domain failing doesn't stop the others reconciling", async () => {
  reset();
  const s = await reconcile({
    mail: fakeMail({ "acme.com": ["a@acme.com"], "beta.com": ["x@beta.com"] }, new Set(["acme.com"])),
  });
  assert.equal(s.domainsAdded, 2, "both domain rows created");
  assert.equal(s.mailboxesAdded, 1, "only the reachable domain's mailbox imported");
  assert.deepEqual(addresses(), ["x@beta.com"]);
});

test("pre-existing rows keep their address; import doesn't duplicate", async () => {
  reset();
  setMailDomainOrg("acme.com", 3);
  addMailboxRow("a@acme.com", "acme.com", 3);
  const s = await reconcile({ mail: fakeMail({ "acme.com": ["a@acme.com"] }) });
  assert.equal(s.mailboxesAdded, 0);
  assert.equal(addresses().length, 1);
  assert.equal(orgOf("a@acme.com"), 3);
});
