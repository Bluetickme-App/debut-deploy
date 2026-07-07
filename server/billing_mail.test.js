// Run: DATABASE_FILE=:memory: node --test server/billing_mail.test.js
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const { db } = await import("./db.js");
const { computeMonthlyCharge, mailChargePence } = await import("./billing.js");

test("email adds £2.99 per mailbox to the org's monthly charge (GBP-native)", () => {
  db.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (1,'Acme','acme','2026-01-01T00:00:00Z')").run();
  const ins = db.prepare("INSERT INTO mail_mailboxes (address,domain,org_id,created_at) VALUES (?,?,?,?)");
  for (const a of ["a@x.com", "b@x.com", "c@x.com"]) ins.run(a, "x.com", 1, "2026-01-01T00:00:00Z");

  assert.equal(mailChargePence(1), 3 * 299);       // 897p
  // No priced compute/DB resources → the whole monthly charge is the email line.
  assert.equal(computeMonthlyCharge(1), 897);

  // Deleting a mailbox row stops billing it.
  db.prepare("DELETE FROM mail_mailboxes WHERE address = 'c@x.com'").run();
  assert.equal(computeMonthlyCharge(1), 2 * 299);
});
