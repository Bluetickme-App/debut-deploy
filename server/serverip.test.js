// ponytail: assert-based self-check — per-service host IP for multi-host custom domains.
// The A-record IP is what users point PRODUCTION DNS at; a wrong value sends traffic to
// the wrong box, so the parser + the verify override get a check.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_FILE = ":memory:";
process.env.COOLIFY_BASE_URL = "http://167.233.206.184:8000"; // global default (primary host)
process.env.DEMO_MODE = "true";

const { serverIpFromFqdn, verifyDomain } = await import("./dns.js");

test("serverIpFromFqdn extracts the host IP from the sslip URL", () => {
  assert.equal(
    serverIpFromFqdn("http://es3wlyx1wgm1mw24x9p58m7y.157.90.244.221.sslip.io"),
    "157.90.244.221"
  );
});

test("serverIpFromFqdn finds the sslip IP even when a custom domain is listed first", () => {
  assert.equal(
    serverIpFromFqdn("https://context6.co.uk,http://xl9475dqmteb6t7akgr0ir8t.157.90.244.221.sslip.io"),
    "157.90.244.221"
  );
});

test("serverIpFromFqdn returns null when there is no sslip URL", () => {
  assert.equal(serverIpFromFqdn("https://context6.co.uk,https://www.context6.co.uk"), null);
  assert.equal(serverIpFromFqdn(""), null);
  assert.equal(serverIpFromFqdn(null), null);
});

test("verifyDomain checks against the per-service IP override, not the global platform IP", async () => {
  const r = await verifyDomain("nonexistent-abc.example", "157.90.244.221");
  assert.equal(r.expectedIp, "157.90.244.221");
  assert.ok(r.instructions.includes("157.90.244.221"));
  assert.equal(r.pointsToServer, r.resolvedIps.includes("157.90.244.221"));
});

test("verifyDomain falls back to the global platform IP when no override is given", async () => {
  const r = await verifyDomain("nonexistent-abc.example");
  assert.equal(r.expectedIp, "167.233.206.184");
});
