// node --test server/domainconnect.test.js
process.env.SESSION_SECRET = "test-secret";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordsFor, paramsFor, makeState, readState, buildApplyUrl, discover, PROVIDER_ID } from "./domainconnect.js";
import { expectedIp } from "./dns.js";

test("recordsFor delegates to the canonical generators", () => {
  assert.ok(recordsFor("mail", "acme.com").some((r) => r.type === "MX"));
  assert.ok(recordsFor("hosting", "acme.com").some((r) => r.type === "A" || r.type === "CNAME"));
});

test("paramsFor hosting carries the platform ip; mail is empty", () => {
  assert.deepEqual(paramsFor("hosting", "acme.com"), { ip: expectedIp });
  assert.deepEqual(paramsFor("mail", "acme.com"), {});
});

test("state round-trips and rejects tampering", () => {
  const tok = makeState({ orgId: "org1", domain: "acme.com", kind: "mail" });
  assert.deepEqual(readState(tok), { orgId: "org1", domain: "acme.com", kind: "mail" });
  assert.throws(() => readState(tok.slice(0, -2) + "xx"), /state/);
});

test("buildApplyUrl assembles the sync-flow apply URL", () => {
  const url = buildApplyUrl({
    urlSyncUX: "https://dcc.godaddy.com/manage",
    domain: "acme.com", kind: "hosting", params: { ip: "1.2.3.4" },
    redirectUri: "https://app.debutdepoly.com/api/dns/callback", state: "ST",
  });
  assert.ok(url.startsWith(`https://dcc.godaddy.com/manage/v2/domainTemplates/providers/${PROVIDER_ID}/services/hosting/apply?`));
  const q = new URL(url).searchParams;
  assert.equal(q.get("domain"), "acme.com");
  assert.equal(q.get("ip"), "1.2.3.4");
  assert.equal(q.get("redirect_uri"), "https://app.debutdepoly.com/api/dns/callback");
  assert.equal(q.get("state"), "ST");
});

test("discover returns supported=true when TXT + settings resolve", async () => {
  const resolveTxt = async () => [["dcc.godaddy.com"]];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ providerId: "godaddy", providerName: "GoDaddy", urlSyncUX: "https://dcc.godaddy.com/manage" }) });
  const lookupImpl = async () => [{ address: "1.2.3.4", family: 4 }];
  const d = await discover("acme.com", { resolveTxt, fetchImpl, lookupImpl });
  assert.equal(d.supported, true);
  assert.equal(d.providerName, "GoDaddy");
  assert.equal(d.urlSyncUX, "https://dcc.godaddy.com/manage");
});

test("discover returns supported=false when the TXT record is absent", async () => {
  const resolveTxt = async () => { const e = new Error("nx"); e.code = "ENOTFOUND"; throw e; };
  const d = await discover("acme.com", { resolveTxt });
  assert.equal(d.supported, false);
});

test("discover returns supported=false when host resolves to a private address (SSRF guard)", async () => {
  const resolveTxt = async () => [["internal.evil.example"]];
  const lookupImpl = async () => [{ address: "127.0.0.1", family: 4 }];
  const fetchImpl = async () => { throw new Error("fetch must not be reached"); };
  const d = await discover("acme.com", { resolveTxt, lookupImpl, fetchImpl });
  assert.equal(d.supported, false);
});

test("readState rejects a token with an appended dot segment", () => {
  const tok = makeState({ orgId: "o", domain: "acme.com", kind: "mail" });
  assert.throws(() => readState(tok + ".garbage"), /state/i);
});
