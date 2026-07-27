// Persistent-disk billing records (service_disks). Pure SQLite — no Coolify, no
// Stripe, no money conversion — so billing.js can import it without a cycle.
//
// Coolify's own volume row (local_persistent_volumes, written by coolifydb.js) is the
// mount. THIS is the commercial record: which org pays, how many GB were confirmed,
// and when it was attached/detached. Without it a disk is invisible to billing.
import { db } from "./db.js";

const nowIso = () => new Date().toISOString();

// Active (still attached) disks for one application.
export function listDisksForApp(appUuid) {
  return db.prepare(
    "SELECT volume_uuid, mount_path, size_gb, created_at FROM service_disks " +
      "WHERE coolify_uuid = ? AND deleted_at IS NULL ORDER BY created_at"
  ).all(appUuid);
}

export function getDisk(volumeUuid) {
  return db.prepare("SELECT * FROM service_disks WHERE volume_uuid = ?").get(volumeUuid) || null;
}

export function recordDisk({ orgId = null, appUuid, volumeUuid, mountPath, sizeGb, createdBy = null }) {
  db.prepare(
    "INSERT INTO service_disks (org_id, coolify_uuid, volume_uuid, mount_path, size_gb, created_at, created_by) " +
      "VALUES (?,?,?,?,?,?,?)"
  ).run(orgId, appUuid, volumeUuid, mountPath, sizeGb, nowIso(), createdBy);
  return { volumeUuid, mountPath, sizeGb };
}

// Soft-delete: the disk stops billing from now, the row stays for the audit trail.
// Returns the removed row (or null when we have no billing record for it — a volume
// attached before this table existed, or added straight in Coolify).
export function markDiskDeleted(volumeUuid) {
  const row = getDisk(volumeUuid);
  if (!row || row.deleted_at) return null;
  db.prepare("UPDATE service_disks SET deleted_at = ? WHERE volume_uuid = ?").run(nowIso(), volumeUuid);
  return row;
}

// Total attached GB — the quantity the org is billed for.
export const orgDiskGb = (orgId) =>
  db.prepare("SELECT COALESCE(SUM(size_gb),0) gb FROM service_disks WHERE org_id = ? AND deleted_at IS NULL").get(orgId).gb;

export const appDiskGb = (appUuid) =>
  db.prepare("SELECT COALESCE(SUM(size_gb),0) gb FROM service_disks WHERE coolify_uuid = ? AND deleted_at IS NULL").get(appUuid).gb;

// Attached disks for an org, for invoice/usage lines.
export const listDisksForOrg = (orgId) =>
  db.prepare(
    "SELECT coolify_uuid, volume_uuid, mount_path, size_gb, created_at, deleted_at " +
      "FROM service_disks WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at"
  ).all(orgId);

// Backfill the owning org on disks recorded before ownership was known (defensive:
// keeps an unowned disk from silently billing nobody forever).
export function claimOrphanDisks(appUuid, orgId) {
  if (!orgId) return 0;
  return db.prepare(
    "UPDATE service_disks SET org_id = ? WHERE coolify_uuid = ? AND org_id IS NULL AND deleted_at IS NULL"
  ).run(orgId, appUuid).changes;
}
