// mailcow mail-server admin client + DNS-record generation for the business-email
// hosting product. Mirrors coolify.js: one thin client, config via env.
//
//   MAILCOW_API_URL   https://mail.debutdepoly.com   (mailcow REST API base)
//   MAILCOW_API_KEY   <key>                          (X-API-Key header)
//   MAIL_HOSTNAME     mail.debutdepoly.com           (MX target / PTR)
//   MAIL_WEBMAIL      mail.debutdepoly.com           (SOGo webmail at /SOGo)
//
// mailcow exposes a REST API (/api/v1/{get,add,delete}/…). Until MAILCOW_API_URL +
// MAILCOW_API_KEY are set the module runs "unconfigured": reads return empty,
// writes throw 503, and the (pure) DNS-record generator still works — so the panel
// Email section renders regardless.

const URL = (process.env.MAILCOW_API_URL || "").replace(/\/$/, "");
const KEY = process.env.MAILCOW_API_KEY || "";
export const MAIL_HOSTNAME = process.env.MAIL_HOSTNAME || "mail.debutdepoly.com";
export const MAIL_WEBMAIL = process.env.MAIL_WEBMAIL || "mail.debutdepoly.com";

export const isConfigured = () => !!(URL && KEY);

async function mc(method, path, body) {
  if (!isConfigured()) {
    throw Object.assign(new Error("Mail server not configured — set MAILCOW_API_URL + MAILCOW_API_KEY"), { status: 503 });
  }
  const res = await fetch(`${URL}/api/v1/${path}`, {
    method,
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`mailcow ${path} → ${res.status}`), { status: res.status, detail });
  }
  return res.json();
}

// mailcow add/delete return an array of { type:'success'|'danger'|'error', msg }.
// Turn any non-success entry into a thrown error (mailcow returns HTTP 200 even on
// a logical failure, so the status code alone isn't enough).
export function assertOk(res, action) {
  const arr = Array.isArray(res) ? res : [res];
  const bad = arr.find((r) => r && r.type && r.type !== "success");
  if (bad) {
    const msg = Array.isArray(bad.msg) ? bad.msg.join(" ") : bad.msg || bad.type;
    throw Object.assign(new Error(`mailcow ${action}: ${msg}`), { status: 400, detail: JSON.stringify(bad) });
  }
}

// ── Domains ─────────────────────────────────────────────────────────────────────
export async function listDomains() {
  if (!isConfigured()) return [];
  const rows = await mc("GET", "get/domain/all");
  return (Array.isArray(rows) ? rows : []).map((d) => ({ domain: d.domain_name, enabled: String(d.active) === "1" }));
}

export async function createDomain(domain) {
  const res = await mc("POST", "add/domain", {
    domain, active: "1", quota: "10240", maxquota: "10240", defquota: "2048", mailboxes: "100",
  });
  assertOk(res, "add domain");
}

export async function deleteDomain(domain) {
  // mailcow removes the domain's mailboxes with it; body is a JSON array of domains.
  const res = await mc("POST", "delete/domain", [domain]);
  assertOk(res, "delete domain");
}

// ── Mailboxes ───────────────────────────────────────────────────────────────────
export async function listMailboxes(domain) {
  if (!isConfigured()) return [];
  const rows = await mc("GET", `get/mailbox/all/${encodeURIComponent(domain)}`);
  return (Array.isArray(rows) ? rows : []).map((m) => ({
    address: m.username,
    quotaMb: m.quota ? Math.round(Number(m.quota) / 1024 / 1024) : null,
  }));
}

export async function createMailbox({ address, password, quotaMb }) {
  const at = String(address).lastIndexOf("@");
  const local_part = String(address).slice(0, at);
  const domain = String(address).slice(at + 1);
  const res = await mc("POST", "add/mailbox", {
    local_part, domain, password, password2: password,
    quota: String(quotaMb || 2048), active: "1",
  });
  assertOk(res, "add mailbox");
}

export async function deleteMailbox(address) {
  const res = await mc("POST", "delete/mailbox", [address]);
  assertOk(res, "delete mailbox");
}

// Count all mailboxes across a set of domains (for per-org billing). Best-effort:
// a failed domain contributes 0 rather than throwing the whole count.
export async function countMailboxes(domains) {
  let n = 0;
  for (const d of domains) n += await listMailboxes(d).then((m) => m.length).catch(() => 0);
  return n;
}

// ── DKIM (fetched per domain; the route appends it to the DNS records) ───────────
export async function getDkimRecord(domain) {
  if (!isConfigured()) return null;
  try {
    const d = await mc("GET", `get/dkim/${encodeURIComponent(domain)}`);
    if (!d || !d.dkim_txt) return null;
    const selector = d.dkim_selector || "dkim";
    return { key: "dkim", required: true, type: "TXT", name: `${selector}._domainkey.${domain}`, value: d.dkim_txt, note: "DKIM (from mailcow)" };
  } catch {
    return null;
  }
}

// ── DNS records (pure/sync — Domain Connect (domainconnect.js) depends on this
// staying synchronous). mailcow sends directly, so SPF authorises the mail host
// itself (not a relay). DKIM is appended by the route via getDkimRecord().
export function dnsRecords(domain) {
  const host = MAIL_HOSTNAME;
  // `key` matches the per-record verification in dns.js verifyMailDns so the panel can show a
  // ✓/✗ on each line. `required` marks the records that mail actually needs (MX/SPF/DMARC) —
  // the autoconfig/autodiscover/webmail CNAMEs are convenience and don't fail the overall badge.
  return [
    { key: "mx",    required: true,  type: "MX",  name: domain, value: `10 ${host}`, note: "Route inbound mail to your mail box" },
    { key: "spf",   required: true,  type: "TXT", name: domain, value: "v=spf1 mx ~all", note: "SPF — authorises your mail host to send. Merge with any existing SPF." },
    { key: "dmarc", required: true,  type: "TXT", name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`, note: "DMARC — start at quarantine" },
    { key: "autoconfig",   required: false, type: "CNAME", name: `autoconfig.${domain}`,   value: host, note: "Thunderbird autoconfig" },
    { key: "autodiscover", required: false, type: "CNAME", name: `autodiscover.${domain}`, value: host, note: "Outlook autodiscover" },
    { key: "webmail",      required: false, type: "CNAME", name: `webmail.${domain}`,      value: host, note: "Webmail" },
  ];
}
