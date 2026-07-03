// App teardown + custom domain ops. cf() is local (same pattern as coolify.js).
// isDemo() imported to branch every method identically to the rest of the codebase.

import dns from "dns/promises";
import { pathToFileURL } from "node:url";
import { isDemo, getService } from "./coolify.js";
import * as fx from "./fixtures.js";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.COOLIFY_API_TOKEN || "";

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Coolify ${method} ${path} → ${res.status}`), {
      status: res.status,
      detail: text,
    });
  }
  return res.status === 204 ? null : res.json();
}

export async function deleteApp(uuid) {
  if (isDemo()) return { ok: true };
  await cf(`/applications/${uuid}`, { method: "DELETE" });
  return { ok: true };
}

// One input host → [apex, www.apex] as https:// URLs (Render-style: bind both).
// https:// makes Coolify/Traefik request a Let's Encrypt cert and serve over TLS.
export function domainVariants(input) {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const apex = host.replace(/^www\./, "");
  return [`https://${apex}`, `https://www.${apex}`];
}

export async function setDomain(uuid, fqdn) {
  if (!fqdn || typeof fqdn !== "string" || !fqdn.trim()) {
    throw Object.assign(new Error("fqdn is required"), { status: 400 });
  }
  const wanted = domainVariants(fqdn);
  if (isDemo()) return { ok: true, domains: wanted.join(",") };

  // MERGE with existing domains — a bare PATCH replaces the list and would wipe
  // the free .debutdepoly.com subdomain (and any other bound domain).
  const app = await cf(`/applications/${uuid}`).catch(() => null);
  const existing = (app?.fqdn || "").split(",").map((s) => s.trim()).filter(Boolean);
  const merged = [...new Set([...existing, ...wanted])];
  await cf(`/applications/${uuid}`, { method: "PATCH", body: { domains: merged.join(",") } });

  // A domain PATCH alone leaves Traefik on the old routing → 503. Only a (re)deploy
  // builds the new routers and triggers cert issuance. Same endpoint the panel uses.
  await cf(`/deploy?uuid=${encodeURIComponent(uuid)}`, { method: "POST" });
  return { ok: true, domains: merged };
}

export async function verifyDomain(uuid, fqdn) {
  if (!fqdn || typeof fqdn !== "string" || !fqdn.trim()) {
    throw Object.assign(new Error("fqdn is required"), { status: 400 });
  }
  const host = fqdn.trim().replace(/^https?:\/\//, "").split("/")[0];

  // Get server IP: demo uses fixtures, live fetches the service then its server
  let serverIp = null;
  if (isDemo()) {
    const svc = fx.services.find((s) => s.uuid === uuid);
    const srv = svc ? fx.servers.find((s) => s.uuid === svc.server) : null;
    serverIp = srv?.ip || null;
  } else {
    try {
      const svc = await getService(uuid);
      // Coolify server UUID → /servers list to get IP (best-effort)
      serverIp = svc?.serverIp || null;
    } catch { /* best-effort */ }
  }

  let resolvedIps = [];
  let pointsAt = false;
  try {
    const addrs = await dns.resolve4(host);
    resolvedIps = addrs;
    if (serverIp) pointsAt = addrs.includes(serverIp);
  } catch { /* NXDOMAIN or timeout — resolvedIps stays [] */ }

  return { host, serverIp, resolvedIps, pointsAt };
}

// self-check: `node server/lifecycle.js`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const eq = (a, b, m) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`FAIL ${m}: got ${JSON.stringify(a)}`);
  };
  eq(domainVariants("example.com"), ["https://example.com", "https://www.example.com"], "apex");
  eq(domainVariants("www.example.com"), ["https://example.com", "https://www.example.com"], "www→apex");
  eq(domainVariants(" HTTPS://Example.com/ "), ["https://example.com", "https://www.example.com"], "normalize");
  eq([...new Set(["https://s.debutdepoly.com", "https://example.com", "https://example.com"])],
     ["https://s.debutdepoly.com", "https://example.com"], "merge dedupe");
  console.log("lifecycle self-check OK");
}
