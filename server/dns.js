import { resolve4, resolveMx as _resolveMx, resolveTxt as _resolveTxt, resolveCname as _resolveCname } from "node:dns/promises";
import { MAIL_HOSTNAME as MAIL_HOST } from "./mail.js";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
export const expectedIp = BASE ? new URL(BASE).hostname : "";

// The host IP an app runs on, parsed from its auto {uuid}.<IP>.sslip.io URL in the
// comma-separated fqdn list. Coolify carries no per-app server-IP field, so the sslip
// URL is the reliable source. This is the per-service A-record target on a multi-host
// fleet (vs the global `expectedIp` default). Returns null when there's no sslip URL.
export function serverIpFromFqdn(fqdn) {
  return (String(fqdn || "").match(/(\d{1,3}(?:\.\d{1,3}){3})\.sslip\.io/) || [])[1] || null;
}

// `ip` is the host the domain must A-record to. Defaults to the global platform IP
// (COOLIFY_BASE_URL) but callers with a service in hand pass that service's own
// serverIp so multi-host fleets verify against the box the app actually runs on.
export async function verifyDomain(fqdn, ip = expectedIp) {
  if (!fqdn || typeof fqdn !== "string" || !/^[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(fqdn.trim())) {
    throw Object.assign(new Error("fqdn is required and must be a valid domain"), { status: 400 });
  }
  const target = ip || expectedIp;
  const instructions = `Create a DNS A record: ${fqdn} -> ${target}`;
  let resolvedIps = [];
  try {
    resolvedIps = await resolve4(fqdn.trim());
  } catch (err) {
    const ignorable = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "ECONNREFUSED", "ETIMEOUT"]);
    if (!ignorable.has(err.code)) throw err;
  }
  return { fqdn, expectedIp: target, resolvedIps, pointsToServer: resolvedIps.includes(target), instructions };
}

// Canonical hosting record set for a custom app domain. `expectedIp` is a bare IP
// in this deployment; if it ever becomes a hostname, emit a CNAME apex instead.
export function appRecords(domain) {
  const apexIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(expectedIp);
  const primary = apexIsIp
    ? { type: "A", name: domain, value: expectedIp, note: "Point your domain at the platform" }
    : { type: "CNAME", name: domain, value: expectedIp, note: "Point your domain at the platform" };
  // The "www → apex" convenience CNAME only makes sense for an apex domain. If the
  // domain is ALREADY a www subdomain, prepending www again yields www.www.<domain>
  // (the reported bug). In that case the primary record alone points www at the platform.
  if (domain.startsWith("www.")) return [primary];
  return [primary, { type: "CNAME", name: `www.${domain}`, value: domain, note: "www → apex" }];
}

export async function verifyMail(domain, { resolveMx = _resolveMx } = {}) {
  let resolvedMx = [];
  try {
    resolvedMx = (await resolveMx(domain)).map((m) => m.exchange);
  } catch (err) {
    const ignorable = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "ECONNREFUSED", "ETIMEOUT"]);
    if (!ignorable.has(err.code)) throw err;
  }
  return { domain, expectedMx: MAIL_HOST, resolvedMx, pointsToMail: resolvedMx.includes(MAIL_HOST) };
}

const IGNORABLE = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "ECONNREFUSED", "ETIMEOUT"]);

// Verify a mail domain's LIVE published DNS against what we expect. Returns one status
// row per record type so the panel can show ✓/✗ per record. Ignorable lookup misses
// (NXDOMAIN etc.) just mean "not published yet" → ok:false, not an error.
export async function verifyMailDns(domain, { resolveMx = _resolveMx, resolveTxt = _resolveTxt, resolveCname = _resolveCname } = {}) {
  const txt = async (name) => {
    try { return (await resolveTxt(name)).map((a) => (Array.isArray(a) ? a.join("") : a)); }
    catch (e) { if (!IGNORABLE.has(e.code)) throw e; return []; }
  };
  const cname = async (name) => {
    try { return await resolveCname(name); }
    catch (e) { if (!IGNORABLE.has(e.code)) throw e; return []; }
  };
  let mx = [];
  try { mx = (await resolveMx(domain)).map((m) => m.exchange); }
  catch (e) { if (!IGNORABLE.has(e.code)) throw e; }
  const spf = await txt(domain);
  const dkim = await txt(`dkim._domainkey.${domain}`);
  const dmarc = await txt(`_dmarc.${domain}`);
  const [autoconfig, autodiscover, webmail] = await Promise.all([
    cname(`autoconfig.${domain}`), cname(`autodiscover.${domain}`), cname(`webmail.${domain}`),
  ]);
  const has = (arr, sub) => arr.some((v) => v.toLowerCase().includes(sub));
  const norm = (h) => String(h).replace(/\.$/, "").toLowerCase();       // DNS hosts: case- and trailing-dot-insensitive
  const toMail = (arr) => arr.some((v) => norm(v) === norm(MAIL_HOST));
  // Keyed to the records in mail.js dnsRecords so the panel shows a ✓/✗ on each line.
  // `required`: the records mail actually needs (drive the overall "DNS verified" badge);
  // the autoconfig/autodiscover/webmail CNAMEs are convenience and don't fail that badge.
  return [
    { key: "mx",    label: "MX",    required: true,  ok: mx.some((h) => norm(h) === norm(MAIL_HOST)), detail: mx.join(", ") || "not found" },
    { key: "spf",   label: "SPF",   required: true,  ok: has(spf, "v=spf1"),   detail: spf.find((v) => v.toLowerCase().includes("v=spf1")) || "not found" },
    { key: "dkim",  label: "DKIM",  required: true,  ok: has(dkim, "v=dkim1"), detail: dkim.length ? "published" : "not found" },
    { key: "dmarc", label: "DMARC", required: true,  ok: has(dmarc, "v=dmarc1"), detail: dmarc.find((v) => v.toLowerCase().includes("v=dmarc1")) || "not found" },
    { key: "autoconfig",   label: "Autoconfig",   required: false, ok: toMail(autoconfig),   detail: autoconfig.join(", ") || "not found" },
    { key: "autodiscover", label: "Autodiscover", required: false, ok: toMail(autodiscover), detail: autodiscover.join(", ") || "not found" },
    { key: "webmail",      label: "Webmail",      required: false, ok: toMail(webmail),      detail: webmail.join(", ") || "not found" },
  ];
}
