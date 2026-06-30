// Outbound webhook notification settings + fire-and-forget notify().
// Helpers for notification_settings table (migration user_version 6).
import { db } from "./db.js";
import net from "node:net";
import dns from "node:dns";

const DEFAULT = (userId) => ({ user_id: userId, webhook_url: null, enabled: 0 });

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// --- SSRF guard ---------------------------------------------------------------
// The webhook URL is customer-supplied and the server POSTs to it, so it must
// not be allowed to target internal/metadata endpoints (e.g. 169.254.169.254).

function ipv4ToInt(ip) {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function inV4Range(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
function isPrivateV4(ip) {
  return (
    inV4Range(ip, "0.0.0.0", 8) ||       // unspecified / this-network
    inV4Range(ip, "10.0.0.0", 8) ||      // private
    inV4Range(ip, "100.64.0.0", 10) ||   // CGNAT
    inV4Range(ip, "127.0.0.0", 8) ||     // loopback
    inV4Range(ip, "169.254.0.0", 16) ||  // link-local (incl. cloud metadata)
    inV4Range(ip, "172.16.0.0", 12) ||   // private
    inV4Range(ip, "192.168.0.0", 16)     // private
  );
}
function isPrivateIp(addr) {
  const fam = net.isIP(addr);
  if (fam === 4) return isPrivateV4(addr);
  if (fam === 6) {
    const a = addr.toLowerCase();
    if (a === "::1" || a === "::") return true;                 // loopback / unspecified
    if (a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb")) return true; // fe80::/10
    if (a.startsWith("fc") || a.startsWith("fd")) return true;  // unique-local fc00::/7
    const m = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);           // IPv4-mapped
    if (m) return isPrivateV4(m[1]);
    return false;
  }
  return true; // not a valid IP literal where one was expected → block
}

// Sync structural check for immediate set-time feedback (literals + protocol).
function assertStructurallyValid(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw bad("valid http(s) webhook URL required"); }
  if (!/^https?:$/.test(u.protocol)) throw bad("valid http(s) webhook URL required");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "0.0.0.0") throw bad("webhook host is not allowed");
  if (net.isIP(host) && isPrivateIp(host)) throw bad("webhook host is not allowed");
  return u;
}

// Authoritative async check used right before the request: resolve the host and
// reject if it maps to any private/loopback/link-local address.
// ponytail: there's a TOCTOU gap between this lookup and fetch's own DNS
// resolution (DNS rebinding); pinning the connection to the validated IP via a
// custom lookup/agent is the upgrade path if a hostile tenant is in scope.
async function assertPublicWebhook(rawUrl, { lookup = dns.promises.lookup } = {}) {
  const u = assertStructurallyValid(rawUrl);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return; // literal already checked above
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw bad("webhook host is not allowed");
  }
}

// --- settings ----------------------------------------------------------------

export function getNotificationSettings(userId) {
  return db.prepare("SELECT * FROM notification_settings WHERE user_id = ?").get(userId) ?? DEFAULT(userId);
}

export function setNotificationSettings({ userId, webhookUrl, enabled }) {
  if (enabled) assertStructurallyValid(webhookUrl); // throws 400 on bad/private literal
  db.prepare(
    "INSERT INTO notification_settings (user_id, webhook_url, enabled, created_at) VALUES (?,?,?,?) " +
    "ON CONFLICT(user_id) DO UPDATE SET webhook_url = excluded.webhook_url, enabled = excluded.enabled, created_at = excluded.created_at"
  ).run(userId, webhookUrl ?? null, enabled ? 1 : 0, new Date().toISOString());
  return getNotificationSettings(userId);
}

// Fire-and-forget: never throws, never logs the URL or secrets.
// event: { type, resource_uuid?, message?, at? }
export async function notify({ userId, event }, { httpClient = fetch, lookup } = {}) {
  const settings = getNotificationSettings(userId);
  if (!settings.enabled || !settings.webhook_url) return { sent: false, reason: "disabled" };

  // SSRF guard before any network call.
  try {
    await assertPublicWebhook(settings.webhook_url, { lookup });
  } catch {
    return { sent: false, reason: "blocked" };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await httpClient(settings.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          type: event.type,
          resource_uuid: event.resource_uuid ?? null,
          message: event.message ?? null,
          at: event.at ?? new Date().toISOString(),
        },
      }),
      signal: ctrl.signal,
      redirect: "manual", // don't follow a 3xx to an internal target
    });
    // A redirect response means the target tried to bounce us elsewhere — refuse.
    if (res && typeof res.status === "number" && res.status >= 300 && res.status < 400) {
      return { sent: false, reason: "blocked" };
    }
    return { sent: true };
  } catch {
    return { sent: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}
