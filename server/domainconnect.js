// Provider-agnostic Domain Connect (sync flow) engine. Builds the redirect URL a
// domain owner opens to approve DNS changes in their own DNS provider. Record
// content is never defined here — it comes from the canonical generators so the
// one-click template and the manual fallback can't drift. See the design spec.
import { resolveTxt as _resolveTxt } from "node:dns/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dnsRecords } from "./mail.js";
import { appRecords, expectedIp } from "./dns.js";

export const PROVIDER_ID = "debutdeploy.com";
const SECRET = () => process.env.SESSION_SECRET || "";

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
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) throw Object.assign(new Error("Malformed state"), { status: 400 });
  const expect = hmac(payload);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error("Bad state signature"), { status: 400 });
  const { orgId, domain, kind } = JSON.parse(Buffer.from(payload, "base64url").toString());
  return { orgId, domain, kind };
}

export function buildApplyUrl({ urlSyncUX, domain, kind, params, redirectUri, state }) {
  const base = `${urlSyncUX.replace(/\/$/, "")}/v2/domainTemplates/providers/${PROVIDER_ID}/services/${kind}/apply`;
  const q = new URLSearchParams({ domain, ...params, redirect_uri: redirectUri, state });
  return `${base}?${q.toString()}`;
}

// Query _domainconnect TXT for the provider's API host, then its settings, to learn
// urlSyncUX. Any miss (NXDOMAIN, non-2xx, malformed) → { supported:false }.
export async function discover(domain, { resolveTxt = _resolveTxt, fetchImpl = fetch } = {}) {
  let host;
  try {
    const txt = await resolveTxt(`_domainconnect.${domain}`);
    host = (Array.isArray(txt?.[0]) ? txt[0].join("") : txt?.[0]) || "";
  } catch { return { supported: false }; }
  if (!host) return { supported: false };
  try {
    const res = await fetchImpl(`https://${host}/v2/${domain}/settings`);
    if (!res.ok) return { supported: false };
    const s = await res.json();
    if (!s?.urlSyncUX) return { supported: false };
    return { supported: true, providerId: s.providerId, providerName: s.providerName, urlSyncUX: s.urlSyncUX };
  } catch { return { supported: false }; }
}
