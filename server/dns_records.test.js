// node --test server/dns_records.test.js
process.env.COOLIFY_BASE_URL = "http://167.233.206.184:8000";
import { test } from "node:test";
import assert from "node:assert/strict";
const { appRecords, verifyMail, expectedIp } = await import("./dns.js");

test("appRecords returns apex A -> expectedIp and www CNAME -> apex", () => {
  const recs = appRecords("acme.com");
  const a = recs.find((r) => r.type === "A");
  const cname = recs.find((r) => r.type === "CNAME");
  assert.equal(a.name, "acme.com");
  assert.equal(a.value, expectedIp);
  assert.equal(cname.name, "www.acme.com");
  assert.equal(cname.value, "acme.com");
});

test("appRecords does NOT double the www when the domain is already a www subdomain", () => {
  const recs = appRecords("www.u079.me");
  // Only the primary record — no www.www.u079.me CNAME.
  assert.equal(recs.length, 1);
  assert.equal(recs[0].name, "www.u079.me");
  assert.equal(recs[0].value, expectedIp);
  assert.ok(!recs.some((r) => r.name === "www.www.u079.me"), "must not emit www.www.<domain>");
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
