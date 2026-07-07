import { resolve4, resolveMx as _resolveMx } from "node:dns/promises";
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
