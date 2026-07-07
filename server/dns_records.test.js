// node --test server/dns_records.test.js
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRecords, verifyMail, expectedIp } from "./dns.js";

test("appRecords returns apex A -> expectedIp and www CNAME -> apex", () => {
  const recs = appRecords("acme.com");
  const a = recs.find((r) => r.type === "A");
  const cname = recs.find((r) => r.type === "CNAME");
  assert.equal(a.name, "acme.com");
  assert.equal(a.value, expectedIp);
  assert.equal(cname.name, "www.acme.com");
  assert.equal(cname.value, "acme.com");
});

test("verifyMail reports pointsToMail true when MX resolves to the mail host", async () => {
  const resolveMx = async () => [{ exchange: "mail.debutdepoly.com", priority: 10 }];
  const r = await verifyMail("acme.com", { resolveMx });
  assert.equal(r.pointsToMail, true);
  assert.deepEqual(r.resolvedMx, ["mail.debutdepoly.com"]);
});

test("verifyMail tolerates a domain with no MX yet (pointsToMail false)", async () => {
  const resolveMx = async () => { const e = new Error("not found"); e.code = "ENOTFOUND"; throw e; };
  const r = await verifyMail("acme.com", { resolveMx });
  assert.equal(r.pointsToMail, false);
  assert.deepEqual(r.resolvedMx, []);
});
