// Database backup config + scheduling via Coolify's backup API.
// Verified against live Coolify v4.1.2 at http://167.233.206.184:8000:
//   GET  /databases/{uuid}/backups  → array of backup config objects
//   POST /databases/{uuid}/backups  → { frequency, s3_storage_uuid? } → creates/updates schedule
//   No trigger-now endpoint exists in v4 API (triggerBackup is a no-op stub with clear error).
//
// s3_storage_uuid is optional — Coolify supports local-only backups.
// When s3_storage_uuid is provided, Coolify validates it against configured S3 storages;
// if none exist it returns a 422 validation error which we surface as a 400.

import { isDemo } from "./coolify.js";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.COOLIFY_API_TOKEN || "";

// ponytail: copy of cf() from lifecycle.js — keep local, each module is standalone
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

// --- demo fixtures ---

const demoBackups = {};

// --- public API ---

/**
 * Get backup configuration for a database.
 * Returns the first (most recent) backup config, or { enabled: false } if none.
 */
export async function getBackupConfig(dbUuid) {
  if (isDemo()) {
    const cfg = demoBackups[dbUuid];
    return cfg ?? { enabled: false };
  }
  const list = await cf(`/databases/${dbUuid}/backups`);
  const configs = Array.isArray(list) ? list : [];
  if (!configs.length) return { enabled: false };
  // Return the most recently created (last in list)
  const c = configs[configs.length - 1];
  return {
    uuid: c.uuid,
    enabled: !!c.enabled,
    frequency: c.frequency || null,
    s3StorageId: c.s3_storage_id ?? null,
    executions: Array.isArray(c.executions) ? c.executions : [],
  };
}

/**
 * Create or update the backup schedule for a database.
 * frequency: cron string (required, e.g. "0 2 * * *")
 * s3StorageUuid: optional; if provided, Coolify validates it against configured S3 storages.
 *   If no S3 storage is configured in Coolify and one is requested, this returns a 400.
 */
export async function setBackupSchedule(dbUuid, { frequency, s3StorageUuid } = {}) {
  if (!frequency || typeof frequency !== "string" || !frequency.trim()) {
    throw Object.assign(new Error("frequency is required (cron string, e.g. \"0 2 * * *\")"), { status: 400 });
  }
  if (isDemo()) {
    demoBackups[dbUuid] = { enabled: true, frequency: frequency.trim(), s3StorageUuid: s3StorageUuid ?? null };
    return { ok: true };
  }
  const body = { frequency: frequency.trim() };
  if (s3StorageUuid) body.s3_storage_uuid = s3StorageUuid;
  try {
    const r = await cf(`/databases/${dbUuid}/backups`, { method: "POST", body });
    return { ok: true, uuid: r?.uuid };
  } catch (err) {
    // Coolify returns a 422/400 validation error when s3_storage_uuid is invalid (no S3 configured)
    if (err.status === 422 || (err.detail && err.detail.includes("s3_storage_uuid"))) {
      throw Object.assign(
        new Error("Configure S3 storage first in Coolify before enabling S3 backups"),
        { status: 400 }
      );
    }
    throw err;
  }
}

/**
 * Trigger an immediate backup.
 * NOTE: Coolify v4 API does not expose a trigger-now endpoint for database backups.
 * This function is a stub that returns a clear error so callers can surface it.
 * Workaround: use the Coolify UI or set a frequent cron and wait.
 */
export async function triggerBackup(dbUuid) {
  if (isDemo()) return { ok: true };
  // ponytail: no trigger-now endpoint in Coolify v4 — surface clear error, not a silent no-op
  throw Object.assign(
    new Error("Coolify v4 does not expose an on-demand backup trigger via API. Use the Coolify UI or schedule a frequent cron."),
    { status: 501 }
  );
}
