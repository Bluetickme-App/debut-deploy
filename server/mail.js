// Stalwart mail-server admin client + DNS-record generation for the
// business-email-hosting product (see docs/…/business-email-hosting-phase1).
// Mirrors how coolify.js wraps Coolify: one thin client, config via env.
//
//   STALWART_URL        http://<mail-box-ip>:8080   (admin/JMAP HTTP)
//   STALWART_ADMIN      admin@domain:<password>     (HTTP basic for the API)
//   MAIL_HOSTNAME       mail.debutdepoly.com        (MX target / PTR)
//   MAIL_WEBMAIL        webmail.debutdepoly.com     (Roundcube)
//
// Stalwart ≥0.16 manages principals through a JMAP extension (urn:stalwart:jmap),
// NOT the older REST /api/principal endpoints (which 404 on current builds). A
// *Domain* principal = a hosted domain (x:Domain/*); a *User* principal = a
// mailbox (x:Account/*). Every management call runs against the admin's own
// principal id, discovered from /jmap/session. Until STALWART_URL is set the
// module runs "unconfigured": reads return empty, writes throw 503 — so the
// panel Email section renders and the (pure) DNS-record generator still works.

const URL = (process.env.STALWART_URL || "").replace(/\/$/, "");
const AUTH = process.env.STALWART_ADMIN || ""; // "admin@domain:password"
export const MAIL_HOSTNAME = process.env.MAIL_HOSTNAME || "mail.debutdepoly.com";
export const MAIL_WEBMAIL = process.env.MAIL_WEBMAIL || "webmail.debutdepoly.com";

export const isConfigured = () => !!(URL && AUTH);

const USING = [
  "urn:ietf:params:jmap:core",
  "urn:stalwart:jmap",
  "urn:ietf:params:jmap:principals",
];
const basic = () => `Basic ${Buffer.from(AUTH).toString("base64")}`;

// The management account id (admin's own principal). Cached — it never changes
// for a given box. primaryAccounts["urn:stalwart:jmap"] is the principal store.
let _accountId = null;
async function accountId() {
  if (_accountId) return _accountId;
  const res = await fetch(`${URL}/jmap/session`, { headers: { Authorization: basic() } });
  if (!res.ok) throw Object.assign(new Error(`Stalwart session → ${res.status}`), { status: res.status });
  const s = await res.json();
  _accountId = s?.primaryAccounts?.["urn:stalwart:jmap"];
  if (!_accountId) throw Object.assign(new Error("Stalwart: no principals account in session"), { status: 502 });
  return _accountId;
}

// Run one or more JMAP method calls; returns the array of method responses.
// Throws on transport failure or if any response is a JMAP ["error", …].
async function jmap(methodCalls) {
  if (!isConfigured()) {
    throw Object.assign(new Error("Mail server not configured — set STALWART_URL + STALWART_ADMIN"), { status: 503 });
  }
  const res = await fetch(`${URL}/jmap/`, {
    method: "POST",
    headers: { Authorization: basic(), "Content-Type": "application/json" },
    body: JSON.stringify({ using: USING, methodCalls }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`Stalwart JMAP → ${res.status}`), { status: res.status, detail });
  }
  const body = await res.json();
  const responses = body?.methodResponses || [];
  const err = responses.find((r) => r[0] === "error");
  if (err) throw Object.assign(new Error(`Stalwart JMAP error: ${err[1]?.description || err[1]?.type}`), { status: 502, detail: JSON.stringify(err[1]) });
  return responses;
}

// A JMAP /set succeeds at the request level even when an individual object fails
// (notCreated/notUpdated/notDestroyed). Turn those per-object failures into errors.
function assertSet(response, kinds = ["notCreated", "notUpdated", "notDestroyed"]) {
  const args = response?.[1] || {};
  for (const kind of kinds) {
    const failed = args[kind];
    if (failed && Object.keys(failed).length) {
      const first = Object.values(failed)[0] || {};
      throw Object.assign(new Error(`Stalwart ${kind}: ${first.description || first.type || "failed"}`), { status: 400, detail: JSON.stringify(failed) });
    }
  }
}

// query+get a principal collection in one round-trip. `type` is "Domain" | "Account".
async function listPrincipals(type, properties) {
  const acc = await accountId();
  const r = await jmap([
    [`x:${type}/query`, { accountId: acc, limit: 500, calculateTotal: true }, "0"],
    [`x:${type}/get`, { accountId: acc, "#ids": { resultOf: "0", name: `x:${type}/query`, path: "/ids" }, properties }, "1"],
  ]);
  return r.find((x) => x[0] === `x:${type}/get`)[1].list || [];
}

// ── Domains (x:Domain principals) ──────────────────────────────────────────────
export async function listDomains() {
  if (!isConfigured()) return [];
  const items = await listPrincipals("Domain", ["id", "name", "isEnabled"]);
  return items.map((d) => ({ domain: d.name, enabled: d.isEnabled !== false }));
}

async function domainId(domain) {
  const items = await listPrincipals("Domain", ["id", "name"]);
  const hit = items.find((d) => d.name === domain);
  if (!hit) throw Object.assign(new Error(`Domain ${domain} not found`), { status: 404 });
  return hit.id;
}

export async function createDomain(domain) {
  const acc = await accountId();
  const r = await jmap([["x:Domain/set", { accountId: acc, create: { n1: { name: domain, isEnabled: true } } }, "0"]]);
  assertSet(r[0]);
}

export async function deleteDomain(domain) {
  const acc = await accountId();
  const id = await domainId(domain);
  let r = await jmap([["x:Domain/set", { accountId: acc, destroy: [id] }, "0"]]);
  // Enabling DKIM auto-creates DkimSignature objects linked to the domain; they
  // block deletion with objectIsLinked. Destroy them, then retry the domain.
  const blocked = r[0]?.[1]?.notDestroyed?.[id];
  if (blocked?.type === "objectIsLinked") {
    const dkim = (blocked.linkedObjects || []).filter((o) => o.object === "DkimSignature").map((o) => o.id);
    if (dkim.length) await jmap([["x:DkimSignature/set", { accountId: acc, destroy: dkim }, "0"]]);
    r = await jmap([["x:Domain/set", { accountId: acc, destroy: [id] }, "0"]]);
  }
  assertSet(r[0]);
}

// ── Mailboxes (x:Account "User" principals) ────────────────────────────────────
export async function listMailboxes(domain) {
  if (!isConfigured()) return [];
  const items = await listPrincipals("Account", ["id", "name", "emailAddress"]);
  return items
    .filter((m) => m.emailAddress && (!domain || m.emailAddress.endsWith("@" + domain)))
    .map((m) => ({ address: m.emailAddress, quotaMb: null }));
}

export async function createMailbox({ address, password, quotaMb }) {
  const acc = await accountId();
  const at = String(address).lastIndexOf("@");
  const local = String(address).slice(0, at);
  const domain = String(address).slice(at + 1);
  const dom = await domainId(domain);
  // ponytail: quotaMb intentionally not applied — Stalwart's quota map is keyed
  // by an enum, not bytes; wire it when per-mailbox quotas are actually needed.
  const r = await jmap([["x:Account/set", { accountId: acc, create: { n1: {
    "@type": "User",
    name: local,
    domainId: dom,
    credentials: { 0: { "@type": "Password", secret: password } },
    roles: { "@type": "User" },
    locale: "en_US",
  } } }, "0"]]);
  assertSet(r[0]);
}

export async function deleteMailbox(address) {
  const acc = await accountId();
  const items = await listPrincipals("Account", ["id", "emailAddress"]);
  const hit = items.find((m) => m.emailAddress === address);
  if (!hit) throw Object.assign(new Error(`Mailbox ${address} not found`), { status: 404 });
  const r = await jmap([["x:Account/set", { accountId: acc, destroy: [hit.id] }, "0"]]);
  assertSet(r[0]);
}

// ── DNS records (pure — no Stalwart needed). Phase 1 = SES relay; DKIM/MAIL-FROM
// records come from ses.js per domain once SES is wired. Here we emit the records
// that are true regardless of the sending path: MX, a starter SPF, DMARC, and the
// autoconfig/autodiscover CNAMEs. The panel labels this the "relay" phase.
export function dnsRecords(domain) {
  const host = MAIL_HOSTNAME;
  return [
    { type: "MX", name: domain, value: `10 ${host}`, note: "Route inbound mail to your mail box" },
    { type: "TXT", name: domain, value: `v=spf1 include:amazonses.com ~all`, note: "SPF (relay phase — SES). Merge with any existing SPF." },
    { type: "TXT", name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`, note: "DMARC — start at quarantine" },
    { type: "CNAME", name: `autoconfig.${domain}`, value: host, note: "Thunderbird autoconfig" },
    { type: "CNAME", name: `autodiscover.${domain}`, value: host, note: "Outlook autodiscover" },
  ];
}
