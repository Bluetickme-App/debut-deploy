import { resolve4, resolveMx as _resolveMx, resolveTxt as _resolveTxt } from "node:dns/promises";
import { MAIL_HOSTNAME as MAIL_HOST } from "./mail.js";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
export const expectedIp = BASE ? new URL(BASE).hostname : "";

export async function verifyDomain(fqdn) {
  if (!fqdn || typeof fqdn !== "string" || !/^[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(fqdn.trim())) {
    throw Object.assign(new Error("fqdn is required and must be a valid domain"), { status: 400 });
  }
  const instructions = `Create a DNS A record: ${fqdn} -> ${expectedIp}`;
  let resolvedIps = [];
  try {
    resolvedIps = await resolve4(fqdn.trim());
  } catch (err) {
    const ignorable = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "ECONNREFUSED", "ETIMEOUT"]);
    if (!ignorable.has(err.code)) throw err;
  }
  return { fqdn, expectedIp, resolvedIps, pointsToServer: resolvedIps.includes(expectedIp), instructions };
}

// Canonical hosting record set for a custom app domain. `expectedIp` is a bare IP
// in this deployment; if it ever becomes a hostname, emit a CNAME apex instead.
export function appRecords(domain) {
  const apexIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(expectedIp);
  return [
    apexIsIp
      ? { type: "A", name: domain, value: expectedIp, note: "Point your domain at the platform" }
      : { type: "CNAME", name: domain, value: expectedIp, note: "Point your domain at the platform" },
    { type: "CNAME", name: `www.${domain}`, value: domain, note: "www → apex" },
  ];
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
export async function verifyMailDns(domain, { resolveMx = _resolveMx, resolveTxt = _resolveTxt } = {}) {
  const txt = async (name) => {
    try { return (await resolveTxt(name)).map((a) => (Array.isArray(a) ? a.join("") : a)); }
    catch (e) { if (!IGNORABLE.has(e.code)) throw e; return []; }
  };
  let mx = [];
  try { mx = (await resolveMx(domain)).map((m) => m.exchange); }
  catch (e) { if (!IGNORABLE.has(e.code)) throw e; }
  const spf = await txt(domain);
  const dkim = await txt(`dkim._domainkey.${domain}`);
  const dmarc = await txt(`_dmarc.${domain}`);
  const has = (arr, sub) => arr.some((v) => v.toLowerCase().includes(sub));
  return [
    { key: "mx",    label: "MX",    ok: mx.includes(MAIL_HOST),   detail: mx.join(", ") || "not found" },
    { key: "spf",   label: "SPF",   ok: has(spf, "v=spf1"),       detail: spf.find((v) => v.toLowerCase().includes("v=spf1")) || "not found" },
    { key: "dkim",  label: "DKIM",  ok: has(dkim, "v=dkim1"),     detail: dkim.length ? "published" : "not found" },
    { key: "dmarc", label: "DMARC", ok: has(dmarc, "v=dmarc1"),   detail: dmarc.find((v) => v.toLowerCase().includes("v=dmarc1")) || "not found" },
  ];
}
