// Persistent-storage (volume/disk) ops for Coolify applications.
// Coolify's storage API can only create "file" mounts (every persistent-volume
// type is rejected — verified 2026-07-02), so create/delete go through coolifydb.js
// (a direct write to Coolify's internal local_persistent_volumes table over SSH).
import * as coolifydb from "./coolifydb.js";

export async function listVolumes(appUuid) {
  return coolifydb.listServiceVolumes(appUuid);
}

export async function addVolume(appUuid, { mountPath } = {}) {
  if (!mountPath || typeof mountPath !== "string" || !mountPath.trim()) {
    throw Object.assign(new Error("mountPath is required"), { status: 400 });
  }
  return coolifydb.addServiceVolume(appUuid, { mountPath: mountPath.trim() });
}

export async function deleteVolume(appUuid, volumeUuid) {
  return coolifydb.deleteServiceVolume(appUuid, volumeUuid);
}
