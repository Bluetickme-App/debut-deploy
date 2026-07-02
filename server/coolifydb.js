// Persistent volumes ("disks") for a service. Coolify's storage API can only
// create "file" mounts (verified — every volume type is rejected), so we write
// the row directly into Coolify's OWN database (local_persistent_volumes) over the
// SSH-to-host channel, then the caller redeploys to mount it.
// ponytail: // VERIFY LIVE — this depends on Coolify's internal schema; it's the
// documented-fragile path (breaks if Coolify changes that table across upgrades).
import { runOnHost } from "./hostexec.js";
import { randomBytes } from "node:crypto";

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

// Run SQL in Coolify's own DB container. SQL passes base64 (shell-safe); all values
// interpolated below are sanitised (no quotes possible), so no SQL injection.
async function coolifySql(sql) {
  const b64 = Buffer.from(sql).toString("base64");
  return runOnHost(`echo ${b64} | base64 -d | docker exec -i coolify-db psql -U coolify -d coolify -tA`);
}

const coolifyUuid = () => randomBytes(12).toString("hex").slice(0, 24);

export async function listServiceVolumes(appUuid) {
  if (DEMO) return [];
  const u = String(appUuid).replace(/[^a-z0-9]/gi, "");
  if (!u) return [];
  const out = await coolifySql(
    `SELECT uuid||'|'||name||'|'||mount_path FROM local_persistent_volumes WHERE resource_type='App\\Models\\Application' AND resource_id=(SELECT id FROM applications WHERE uuid='${u}')`
  );
  return String(out).trim().split("\n").filter(Boolean).map((l) => {
    const [uuid, name, mountPath] = l.split("|");
    return { uuid, name, mountPath };
  });
}

export async function addServiceVolume(appUuid, { mountPath }) {
  if (DEMO) return { ok: true, uuid: "demo-vol", name: "demo-data", mountPath };
  const u = String(appUuid).replace(/[^a-z0-9]/gi, "");
  const mp = String(mountPath || "").trim();
  if (!/^\/[A-Za-z0-9._/-]{1,200}$/.test(mp)) {
    throw Object.assign(new Error("mount path must be an absolute path (e.g. /data)"), { status: 400 });
  }
  const appId = parseInt(String(await coolifySql(`SELECT id FROM applications WHERE uuid='${u}'`)).trim(), 10);
  if (!appId) throw Object.assign(new Error("service not found"), { status: 404 });
  const volUuid = coolifyUuid();
  const name = (`${u}-` + mp.replace(/[^A-Za-z0-9]/g, "-").replace(/^-+|-+$/g, "")).slice(0, 60);
  await coolifySql(
    `INSERT INTO local_persistent_volumes (name, mount_path, resource_type, resource_id, is_preview_suffix_enabled, uuid, created_at, updated_at) VALUES ('${name}', '${mp}', 'App\\Models\\Application', ${appId}, false, '${volUuid}', now(), now())`
  );
  return { uuid: volUuid, name, mountPath: mp };
}

// Delete a volume, constrained to the given app — so a caller authorized against
// their own app can't delete another app's volume by guessing its uuid (IDOR).
export async function deleteServiceVolume(appUuid, volUuid) {
  if (DEMO) return { ok: true };
  const u = String(appUuid).replace(/[^a-z0-9]/gi, "");
  const v = String(volUuid).replace(/[^A-Za-z0-9]/gi, "");
  if (!u || !v) throw Object.assign(new Error("app + volume uuid required"), { status: 400 });
  await coolifySql(
    `DELETE FROM local_persistent_volumes WHERE uuid='${v}' AND resource_type='App\\Models\\Application' AND resource_id=(SELECT id FROM applications WHERE uuid='${u}')`
  );
  return { ok: true };
}
