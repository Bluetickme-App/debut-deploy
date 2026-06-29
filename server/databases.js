// Coolify managed-database operations.
// Pattern mirrors coolify.js: isDemo() branch + live cf() calls.

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

const VALID_TYPES = new Set(["postgresql", "redis", "mysql", "mariadb", "mongodb"]);

export async function createDatabase({ type, name, projectUuid, environmentName, serverUuid }) {
  if (!VALID_TYPES.has(type)) {
    throw Object.assign(new Error(`Invalid database type: ${type}`), { status: 400 });
  }
  if (isDemo()) return { uuid: `demo-db-${name}` };
  const r = await cf(`/databases/${type}`, {
    method: "POST",
    body: { name, project_uuid: projectUuid, environment_name: environmentName, server_uuid: serverUuid, instant_deploy: true },
  });
  return { uuid: r.uuid };
}

export async function startDatabase(uuid) {
  if (isDemo()) return { ok: true };
  await cf(`/databases/${uuid}/start`, { method: "POST" });
  return { ok: true };
}

export async function stopDatabase(uuid) {
  if (isDemo()) return { ok: true };
  await cf(`/databases/${uuid}/stop`, { method: "POST" });
  return { ok: true };
}

export async function deleteDatabase(uuid) {
  if (isDemo()) return { ok: true };
  await cf(`/databases/${uuid}`, { method: "DELETE" });
  return { ok: true };
}
