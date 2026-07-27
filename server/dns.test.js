// Run: node --test server/dns.test.js
// Per-record mail DNS verification: one ✓/✗ per record, required vs convenience.
process.env.MAIL_HOSTNAME = "mail.debutdepoly.com";
import { test } from "node:test";
import assert from "node:assert/strict";
const { verifyMailDns } = await import("./dns.js");

const MAIL = "mail.debutdepoly.com";

// Injectable resolver stubs (verifyMailDns takes them as options).
function stubs(over = {}) {
  const cfg = {
    mx: [MAIL], spf: ["v=spf1 mx ~all"], dkim: ["v=DKIM1; k=rsa; p=xxx"],
    dmarc: ["v=DMARC1; p=quarantine"], autoconfig: [MAIL], autodiscover: [MAIL], ...over,
  };
  return {
    resolveMx: async () => cfg.mx.map((exchange) => ({ exchange, priority: 10 })),
    resolveTxt: async (name) => {
      const src = name.startsWith("_dmarc.") ? cfg.dmarc : name.startsWith("dkim._domainkey.") ? cfg.dkim : cfg.spf;
      return src.map((s) => [s]); // node returns arrays of chunks
    },
    resolveCname: async (name) => {
      if (name.startsWith("autoconfig.")) return cfg.autoconfig;
      if (name.startsWith("autodiscover.")) return cfg.autodiscover;
      return [];
    },
  };
}
const byKey = (checks) => Object.fromEntries(checks.map((c) => [c.key, c]));

test("returns a keyed check per record (6 rows: 4 required + 2 convenience CNAMEs)", async () => {
  const checks = await verifyMailDns("acme.com", stubs());
  assert.deepEqual(checks.map((c) => c.key), ["mx", "spf", "dkim", "dmarc", "autoconfig", "autodiscover"]);
  assert.equal(checks.filter((c) => c.required).length, 4);
});

// webmail.<domain> is deliberately NOT checked: it is no longer published, because a CNAME
// to the mail host can never satisfy TLS for webmail.<customer-domain>. Guard against it
// creeping back in — a permanent ✗ on the panel is worse than no row at all.
test("no webmail check is produced", async () => {
  const checks = await verifyMailDns("acme.com", stubs());
  assert.ok(!checks.some((c) => c.key === "webmail"), "webmail must not be verified");
});

test("all records correct → every check ok", async () => {
  const checks = await verifyMailDns("acme.com", stubs());
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
});

test("missing convenience CNAMEs don't fail the required set", async () => {
  const m = byKey(await verifyMailDns("acme.com", stubs({ autoconfig: [], autodiscover: [] })));
  assert.ok(["mx", "spf", "dkim", "dmarc"].every((k) => m[k].ok), "required all ok");
  assert.equal(m.autoconfig.ok, false);
  assert.equal(m.autodiscover.detail, "not found");
});

test("missing MX fails its check", async () => {
  const m = byKey(await verifyMailDns("acme.com", stubs({ mx: [] })));
  assert.equal(m.mx.ok, false);
  assert.equal(m.mx.detail, "not found");
});

test("MX exchange matches case- and trailing-dot-insensitively", async () => {
  const m = byKey(await verifyMailDns("acme.com", stubs({ mx: ["Mail.DebutDepoly.com."] })));
  assert.equal(m.mx.ok, true);
});

test("a wrong SPF (no v=spf1) is not ok", async () => {
  const m = byKey(await verifyMailDns("acme.com", stubs({ spf: ["some-other-txt"] })));
  assert.equal(m.spf.ok, false);
});
