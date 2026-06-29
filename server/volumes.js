// Persistent-storage (volume) ops for Coolify applications.
// Endpoint: /applications/{uuid}/storages
// Verified live 2026-06-29 against Coolify v4.1.2 at http://167.233.206.184:8000

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

function mapVolume(v) {
  return {
    uuid: v.uuid,
    name: v.name,
    mountPath: v.mount_path,
    hostPath: v.host_path || null,
  };
}

// GET /applications/{appUuid}/storages → persistent_storages array
export async function listVolumes(appUuid) {
  if (isDemo()) return [];
  const r = await cf(`/applications/${appUuid}/storages`);
  return (r?.persistent_storages || []).map(mapVolume);
}

// POST /applications/{appUuid}/storages
// Required: name, mount_path, type: 'persistent'
// Optional: host_path
export async function addVolume(appUuid, { name, mountPath, hostPath } = {}) {
  if (!mountPath || typeof mountPath !== "string" || !mountPath.trim()) {
    throw Object.assign(new Error("mountPath is required"), { status: 400 });
  }
  if (isDemo()) return { ok: true };
  const body = { name: name || undefined, mount_path: mountPath.trim(), type: "persistent" };
  if (hostPath) body.host_path = hostPath;
  const r = await cf(`/applications/${appUuid}/storages`, { method: "POST", body });
  return { ok: true, uuid: r.uuid, name: r.name, mountPath: r.mount_path };
}

// DELETE /applications/{appUuid}/storages/{volumeUuid}
export async function deleteVolume(appUuid, volumeUuid) {
  if (isDemo()) return { ok: true };
  await cf(`/applications/${appUuid}/storages/${volumeUuid}`, { method: "DELETE" });
  return { ok: true };
}
