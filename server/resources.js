// Resource limits, health-check config, and server resource usage.
// Wraps Coolify PATCH /applications/{uuid} and GET /servers/{uuid}/resources.
//
// Field names verified against live Coolify v4.1.2:
//   limits_memory (string e.g. "512M"), limits_cpus (string e.g. "0.5")
//   health_check_enabled (bool), health_check_path (string), health_check_port (int|null)
//   /servers/{uuid}/resources → array of running containers (not usage percents)

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

function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

// PATCH /applications/{uuid} with limits_memory and/or limits_cpus.
// memory: e.g. "512M", "1G"; cpus: e.g. "0.5", "1"
export async function setLimits(uuid, { memory, cpus } = {}) {
  if (!uuid) throw badRequest("uuid is required");
  if (!memory && !cpus) throw badRequest("memory or cpus is required");

  if (isDemo()) return { ok: true, memory: memory ?? null, cpus: cpus ?? null };

  const body = {};
  if (memory) body.limits_memory = memory;
  if (cpus) body.limits_cpus = cpus;
  await cf(`/applications/${uuid}`, { method: "PATCH", body });
  return { ok: true, memory: memory ?? null, cpus: cpus ?? null };
}

// PATCH /applications/{uuid} with health_check_* fields.
// enabled: bool; path: e.g. "/health"; port: int or null
export async function setHealthcheck(uuid, { enabled, path, port } = {}) {
  if (!uuid) throw badRequest("uuid is required");

  if (isDemo()) return { ok: true };

  const body = {};
  if (enabled !== undefined) body.health_check_enabled = !!enabled;
  if (path !== undefined) body.health_check_path = path;
  if (port !== undefined) body.health_check_port = port ?? null;
  await cf(`/applications/${uuid}`, { method: "PATCH", body });
  return { ok: true };
}

// GET /servers/{serverUuid}/resources → { cpu, memory, disk } (numbers or null).
// ponytail: Coolify v4.1.2 /resources returns a container list, not usage percents.
// We map what we can; callers must tolerate null values.
export async function getResourceUsage(serverUuid) {
  if (!serverUuid) throw badRequest("serverUuid is required");

  if (isDemo()) return { cpu: 12, memory: 34, disk: 21 };

  const data = await cf(`/servers/${serverUuid}/resources`);
  // ponytail: live endpoint returns container array — extract usage if Coolify ever
  // adds percent fields; for now tolerate missing and return null.
  const src = Array.isArray(data) ? {} : (data ?? {});
  return {
    cpu: src.cpu_usage_percent ?? null,
    memory: src.memory_usage_percent ?? null,
    disk: src.disk_usage_percent ?? null,
  };
}
