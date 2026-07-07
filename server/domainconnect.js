// Provider-agnostic Domain Connect (sync flow) engine. Builds the redirect URL a
// domain owner opens to approve DNS changes in their own DNS provider. Record
// content is never defined here — it comes from the canonical generators so the
// one-click template and the manual fallback can't drift. See the design spec.
import { resolveTxt as _resolveTxt } from "node:dns/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dnsRecords } from "./mail.js";
import { appRecords, expectedIp } from "./dns.js";
import { setDnsSetupStatus } from "./db.js";

export const PROVIDER_ID = "debutdeploy.com";
const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw Object.assign(new Error("SESSION_SECRET is not set"), { status: 500 });
  return s;
};

export function recordsFor(kind, domain) {
  if (kind === "mail") return dnsRecords(domain);
  if (kind === "hosting") return appRecords(domain);
  throw Object.assign(new Error(`Unknown DNS kind: ${kind}`), { status: 400 });
}

export function paramsFor(kind, domain) {
  return kind === "hosting" ? { ip: expectedIp } : {};
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) => createHmac("sha256", SECRET()).update(data).digest("base64url");

// Opaque, tamper-evident state carried through the provider round-trip.
export function makeState({ orgId, domain, kind }) {
  const payload = b64u(JSON.stringify({ orgId: orgId ?? "", domain, kind }));
  return `${payload}.${hmac(payload)}`;
}

export function readState(token) {
  const str = String(token || "");
  const dot = str.lastIndexOf(".");
  if (dot <= 0) throw Object.assign(new Error("Malformed state"), { status: 400 });
  const payload = str.slice(0, dot);
  const sig = str.slice(dot + 1);
  const expect = hmac(payload);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error("Bad state signature"), { status: 400 });
  try {
    const { orgId, domain, kind } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return { orgId, domain, kind };
  } catch {
    throw Object.assign(new Error("Malformed state payload"), { status: 400 });
  }
}

export function buildApplyUrl({ urlSyncUX, domain, kind, params, redirectUri, state }) {
  const base = `${urlSyncUX.replace(/\/$/, "")}/v2/domainTemplates/providers/${PROVIDER_ID}/services/${kind}/apply`;
  const q = new URLSearchParams({ domain, ...params, redirect_uri: redirectUri, state });
  return `${base}?${q.toString()}`;
}

// Reject addresses that must never be reachable from a server-side fetch.
function isPrivateAddr(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("::ffff:")) return isPrivateAddr(s.slice(7));
  return s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd");
}

// SSRF guard: require a plain hostname and reject any host that resolves to a
// private/loopback/link-local address (dns.lookup on an IP literal returns it
// unchanged, so literal private IPs are caught too).
// ponytail: pre-fetch DNS check leaves a rebinding TOCTOU window; pin the resolved
// IP into the connection if this ever guards more than a settings GET.
async function assertPublicHost(host, { lookupImpl = lookup } = {}) {
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error("Invalid Domain Connect host");
  const addrs = await lookupImpl(host, { all: true });
  if (!addrs.length) throw new Error("Host does not resolve");
  for (const { address } of addrs) if (isPrivateAddr(address)) throw new Error("Host resolves to a private address");
}

// Query _domainconnect TXT for the provider's API host, then its settings, to learn
// urlSyncUX. Any miss (NXDOMAIN, non-2xx, malformed) → { supported:false }.
export async function discover(domain, { resolveTxt = _resolveTxt, fetchImpl = fetch, lookupImpl } = {}) {
  let host;
  try {
    const txt = await resolveTxt(`_domainconnect.${domain}`);
    host = (Array.isArray(txt?.[0]) ? txt[0].join("") : txt?.[0]) || "";
  } catch { return { supported: false }; }
  if (!host) return { supported: false };
  try {
    await assertPublicHost(host, { lookupImpl });
    const res = await fetchImpl(`https://${host}/v2/${domain}/settings`, { redirect: "error" });
    if (!res.ok) return { supported: false };
    const s = await res.json();
    if (!s?.urlSyncUX) return { supported: false };
    return { supported: true, providerId: s.providerId, providerName: s.providerName, urlSyncUX: s.urlSyncUX };
  } catch { return { supported: false }; }
}

// Resolve a provider redirect into a persisted status. `verify` returns whether the
// records are already live (so we can jump applied → verified without waiting).
export async function applyCallbackResult({ orgId, domain, kind, error, verify }) {
  if (error) { setDnsSetupStatus({ orgId, domain, kind, status: "failed" }); return "failed"; }
  setDnsSetupStatus({ orgId, domain, kind, status: "applied" });
  const live = await verify().catch(() => false);
  if (live) { setDnsSetupStatus({ orgId, domain, kind, status: "verified", verified: true }); return "verified"; }
  return "applied";
}
