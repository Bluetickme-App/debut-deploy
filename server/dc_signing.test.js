// node --test server/dc_signing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.DOMAINCONNECT_SIGNING = "on";
process.env.DOMAINCONNECT_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" });
process.env.DOMAINCONNECT_KEY_HOST = "_dcsig";
const { buildApplyUrl } = await import("./domainconnect.js");

test("signed apply URL carries sig+key and the sig verifies over the query", () => {
  const url = buildApplyUrl({
    urlSyncUX: "https://dcc.godaddy.com/manage", domain: "acme.com", kind: "mail",
    params: {}, redirectUri: "https://app.debutdepoly.com/api/dns/callback", state: "ST",
  });
  const u = new URL(url);
  const sig = u.searchParams.get("sig");
  const key = u.searchParams.get("key");
  assert.ok(sig && key === "_dcsig");
  // Signature is over the query string minus the sig/key params, in order.
  u.searchParams.delete("sig"); u.searchParams.delete("key");
  const signed = u.search.slice(1);
  const ok = createVerify("RSA-SHA256").update(signed).verify(publicKey, Buffer.from(sig, "base64"));
  assert.equal(ok, true);
});
