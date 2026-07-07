// Run: MAILCOW_API_URL=http://mailcow.test MAILCOW_API_KEY=k node --test server/mail.test.js
process.env.MAILCOW_API_URL = "http://mailcow.test";
process.env.MAILCOW_API_KEY = "testkey";
import { test } from "node:test";
import assert from "node:assert/strict";
const M = await import("./mail.js");

const okJson = (v) => ({ ok: true, status: 200, json: async () => v, text: async () => "" });

test("listDomains maps mailcow rows → {domain, enabled}", async () => {
  globalThis.fetch = async () => okJson([{ domain_name: "a.com", active: "1" }, { domain_name: "b.com", active: 0 }]);
  assert.deepEqual(await M.listDomains(), [{ domain: "a.com", enabled: true }, { domain: "b.com", enabled: false }]);
});

test("assertOk throws on a non-success mailcow response, passes success", () => {
  assert.throws(() => M.assertOk([{ type: "danger", msg: ["nope"] }], "x"), /mailcow x: nope/);
  assert.doesNotThrow(() => M.assertOk([{ type: "success", msg: ["ok"] }], "x"));
});

test("createMailbox splits the address and posts local_part+domain+password2", async () => {
  let body;
  globalThis.fetch = async (_url, opts) => { body = JSON.parse(opts.body); return okJson([{ type: "success" }]); };
  await M.createMailbox({ address: "paul@a.com", password: "secret12", quotaMb: 2048 });
  assert.equal(body.local_part, "paul");
  assert.equal(body.domain, "a.com");
  assert.equal(body.password2, "secret12");
  assert.equal(body.quota, "2048");
});

test("deleteMailbox posts a JSON array; a danger result throws", async () => {
  globalThis.fetch = async (_url, opts) => { assert.deepEqual(JSON.parse(opts.body), ["x@a.com"]); return okJson([{ type: "danger", msg: "not found" }]); };
  await assert.rejects(() => M.deleteMailbox("x@a.com"), /not found/);
});

test("dnsRecords is sync and includes MX/SPF/DMARC (mailcow self-host SPF)", () => {
  const r = M.dnsRecords("a.com");
  assert.equal(r.find((x) => x.type === "MX").value, "10 mail.debutdepoly.com");
  assert.ok(r.some((x) => x.value === "v=spf1 mx ~all"));
  assert.ok(r.some((x) => x.name === "_dmarc.a.com"));
});
