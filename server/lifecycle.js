// App teardown + custom domain ops. cf() is local (same pattern as coolify.js).
// isDemo() imported to branch every method identically to the rest of the codebase.

import { isDemo } from "./coolify.js";

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

export async function setDomain(uuid, fqdn) {
  if (!fqdn || typeof fqdn !== "string" || !fqdn.trim()) {
    throw Object.assign(new Error("fqdn is required"), { status: 400 });
  }
  if (isDemo()) return { ok: true, fqdn };
  return cf(`/applications/${uuid}`, { method: "PATCH", body: { domains: fqdn } });
}
