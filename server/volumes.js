// Persistent-storage (volume/disk) ops for Coolify applications.
// Coolify's storage API can only create "file" mounts (every persistent-volume
// type is rejected — verified 2026-07-02), so create/delete go through coolifydb.js
// (a direct write to Coolify's internal local_persistent_volumes table over SSH).
//
// Every disk also gets a billing record in service_disks (disks.js): Coolify stores
// no size and no owner, so without it an attached disk is charged to nobody. The
// confirmed size the customer agreed to is stored HERE, not in Coolify.
import * as coolifydb from "./coolifydb.js";
import * as disks from "./disks.js";
import { STORAGE_PLAN, normalizeDiskGb } from "./plans.js";

// Coolify is the source of truth for what is MOUNTED; we join our size/billing
// record on. sizeGb is null for a volume with no billing record (attached directly
// in Coolify, or before service_disks existed) — callers show it as "unmetered".
export async function listVolumes(appUuid) {
  const mounted = await coolifydb.listServiceVolumes(appUuid);
  const meta = new Map(disks.listDisksForApp(appUuid).map((d) => [d.volume_uuid, d]));
  return (mounted || []).map((v) => ({
    ...v,
    sizeGb: meta.get(v.uuid)?.size_gb ?? null,
    billed: meta.has(v.uuid),
  }));
}

// Create the mount + its billing record. `sizeGb` is the size the customer confirmed
// in the Add Disk dialog; it defaults to the 1 GB floor so a disk can never end up
// attached-but-unbilled.
export async function addVolume(appUuid, { mountPath, sizeGb, orgId = null, createdBy = null } = {}) {
  if (!mountPath || typeof mountPath !== "string" || !mountPath.trim()) {
    throw Object.assign(new Error("mountPath is required"), { status: 400 });
  }
  const gb = sizeGb === undefined || sizeGb === null ? STORAGE_PLAN.minGb : normalizeDiskGb(sizeGb);
  const created = await coolifydb.addServiceVolume(appUuid, { mountPath: mountPath.trim() });
  // The mount exists now — record it for billing before returning, so a crash between
  // the two can't leave free storage running.
  disks.recordDisk({
    orgId, appUuid, volumeUuid: created.uuid, mountPath: created.mountPath ?? mountPath.trim(),
    sizeGb: gb, createdBy,
  });
  return { ok: true, ...created, sizeGb: gb, billed: true };
}

// Detach then stop billing — in that order. If the Coolify delete throws we must NOT
// have already stopped the meter on a disk that is still attached.
export async function deleteVolume(appUuid, volumeUuid) {
  const result = await coolifydb.deleteServiceVolume(appUuid, volumeUuid);
  const removed = disks.markDiskDeleted(volumeUuid);
  return { ...result, sizeGb: removed?.size_gb ?? null };
}
