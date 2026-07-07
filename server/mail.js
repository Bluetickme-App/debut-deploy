// Stalwart mail-server admin-API client + DNS-record generation for the
// business-email-hosting product (see docs/…/business-email-hosting-phase1).
// Mirrors how coolify.js wraps Coolify: one thin client, config via env.
//
//   STALWART_URL        http://<mail-box-ip>:8080   (admin/JMAP HTTP)
//   STALWART_ADMIN      admin:<password>            (HTTP basic for the admin API)
//   MAIL_HOSTNAME       mail.debutdepoly.com        (MX target / PTR)
//   MAIL_WEBMAIL        webmail.debutdepoly.com     (Roundcube)
//
// A Stalwart *Domain* principal = a hosted domain; an *Individual* = a mailbox.
// Until STALWART_URL is set the module runs in "unconfigured" mode: reads return
// empty, writes throw a clear 503 — so the panel Email section renders and the
// DNS-record generator (pure, no Stalwart needed) still works.

const URL = (process.env.STALWART_URL || "").replace(/\/$/, "");
const AUTH = process.env.STALWART_ADMIN || ""; // "admin:password"
export const MAIL_HOSTNAME = process.env.MAIL_HOSTNAME || "mail.debutdepoly.com";
export const MAIL_WEBMAIL = process.env.MAIL_WEBMAIL || "webmail.debutdepoly.com";

export const isConfigured = () => !!(URL && AUTH);

async function sw(path, { method = "GET", body } = {}) {
  if (!isConfigured()) {
    throw Object.assign(new Error("Mail server not configured — set STALWART_URL + STALWART_ADMIN"), { status: 503 });
  }
  const res = await fetch(`${URL}/api${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(AUTH).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`Stalwart ${method} ${path} → ${res.status}`), { status: res.status, detail });
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ── Domains (Stalwart "Domain" principals) ─────────────────────────────────────
export async function listDomains() {
  if (!isConfigured()) return [];
  const r = await sw(`/principal?type=domain`);
  const items = r?.data?.items || r?.items || [];
  return items.map((d) => ({ domain: d.name, description: d.description || "" }));
}

export async function createDomain(domain) {
  return sw(`/principal`, { method: "POST", body: { type: "domain", name: domain } });
}

export async function deleteDomain(domain) {
  return sw(`/principal/${encodeURIComponent(domain)}`, { method: "DELETE" });
}

// ── Mailboxes (Stalwart "Individual" principals) ───────────────────────────────
export async function listMailboxes(domain) {
  if (!isConfigured()) return [];
  const r = await sw(`/principal?type=individual`);
  const items = r?.data?.items || r?.items || [];
  return items
    .map((m) => ({ address: (m.emails && m.emails[0]) || m.name, quotaMb: m.quota ? Math.round(m.quota / 1e6) : null }))
    .filter((m) => !domain || String(m.address).endsWith("@" + domain));
}

export async function createMailbox({ address, password, quotaMb }) {
  return sw(`/principal`, {
    method: "POST",
    body: {
      type: "individual",
      name: address,
      emails: [address],
      secrets: password ? [password] : undefined,
      quota: quotaMb ? quotaMb * 1e6 : undefined,
    },
  });
}

export async function deleteMailbox(address) {
  return sw(`/principal/${encodeURIComponent(address)}`, { method: "DELETE" });
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
