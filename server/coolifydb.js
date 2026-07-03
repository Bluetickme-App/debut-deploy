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
  // ON_ERROR_STOP=1: without it psql exits 0 even when a statement errors, so a
  // failed INSERT would look like success. With it, a SQL error → non-zero exit →
  // runOnHost rejects with the Postgres message (captured stderr).
  return runOnHost(`echo ${b64} | base64 -d | docker exec -i coolify-db psql -U coolify -d coolify -tA -v ON_ERROR_STOP=1`);
}

// Run SQL and, on failure, throw a CONCISE 422 the UI can show — the app's generic
// 5xx handler otherwise flattens SSH/Postgres errors to "Internal error", leaving
// the disk feature undebuggable. Message is sanitised of host paths.
async function runSql(sql) {
  try {
    return await coolifySql(sql);
  } catch (err) {
    const raw = String(err?.message || "");
    let reason;
    if (/not configured/i.test(raw)) reason = "storage host SSH is not configured (MIGRATION_SSH_*)";
    else if (/denied|verification failed|host key/i.test(raw)) reason = "storage host key pin mismatch — SSH refused (check MIGRATION_SSH_HOSTKEY_SHA256)";
    else if (/SSH to migration host/i.test(raw)) reason = "could not reach the storage host over SSH";
    else if (/exit \d+:/i.test(raw)) {
      // psql prints: "ERROR: <msg>\nLINE 1: <sql>\n        ^". Grab the ERROR line,
      // not the caret line (".pop()" used to return just "^" — useless).
      const stderr = (raw.split(/exit \d+:/)[1] || "").trim();
      const lines = stderr.split("\n").map((s) => s.trim()).filter(Boolean);
      reason = "Coolify DB rejected the change — " + ((lines.find((l) => /error/i.test(l)) || lines[0] || stderr).slice(0, 220));
    }
    else reason = raw.slice(0, 200) || "unknown error";
    throw Object.assign(new Error("Coolify host operation failed: " + reason), { status: 422 });
  }
}

const coolifyUuid = () => randomBytes(12).toString("hex").slice(0, 24);

// Persistent deploy HISTORY from Coolify's own DB. The REST /deployments endpoint
// only lists ACTIVE deployments, so finished ones "disappear" from the panel — read
// application_deployment_queue directly for durable history with real detail.
// Fields are Coolify-internal (no user input) so interpolation is injection-safe.
export async function getDeploymentHistory(appUuid, { limit = 20 } = {}) {
  if (DEMO) return [];
  const u = String(appUuid).replace(/[^a-z0-9]/gi, "");
  if (!u) return [];
  const n = Math.min(50, Math.max(1, Number(limit) || 20));
  const raw = await runSql(
    `SELECT deployment_uuid||'|'||status||'|'||coalesce(commit,'')||'|'||replace(split_part(coalesce(commit_message,''),chr(10),1),'|','/')||'|'||coalesce(is_webhook::text,'f')||'|'||created_at||'|'||coalesce(updated_at,'') ` +
    `FROM application_deployment_queues WHERE application_id=(SELECT id::text FROM applications WHERE uuid='${u}') ORDER BY id DESC LIMIT ${n}`
  );
  return String(raw || "").trim().split("\n").filter(Boolean).map((line) => {
    const [uuid, status, commit, message, webhook, created, updated] = line.split("|");
    const dur = created && updated ? Math.max(0, Math.round((Date.parse(updated) - Date.parse(created)) / 1000)) : null;
    return {
      uuid, status,
      commit: (commit || "").slice(0, 7),
      message: message || "",
      branch: "main",
      startedAt: created || null,
      durationSec: dur,
      trigger: (webhook === "t" || webhook === "true") ? "git push" : "manual",
    };
  });
}

// Move a resource (app or postgres) into another Coolify project by repointing its
// environment_id — Coolify has no REST endpoint for this. Structured as UPDATE …
// FROM (subquery): if the target project has no environment the subquery is empty
// and ZERO rows change (never nulls environment_id → never breaks the resource).
// `kind` picks the table; only these two are supported (validated by the caller).
const MOVE_TABLES = { app: "applications", postgres: "standalone_postgresqls" };
export async function moveToProject(resourceUuid, projectUuid, kind = "app") {
  if (DEMO) return { ok: true };
  const table = MOVE_TABLES[kind];
  if (!table) throw Object.assign(new Error("Unsupported resource kind"), { status: 400 });
  const r = String(resourceUuid).replace(/[^a-z0-9]/gi, "");
  const p = String(projectUuid).replace(/[^a-z0-9]/gi, "");
  if (!r || !p) throw Object.assign(new Error("resource + project uuid required"), { status: 400 });
  const out = await runSql(
    `UPDATE ${table} SET environment_id = env.id FROM ` +
    `(SELECT e.id FROM environments e JOIN projects pr ON e.project_id = pr.id ` +
    `WHERE pr.uuid = '${p}' ORDER BY (e.name = 'production') DESC, e.id LIMIT 1) AS env ` +
    `WHERE ${table}.uuid = '${r}' RETURNING ${table}.uuid`
  );
  if (!String(out || "").trim()) {
    throw Object.assign(new Error("Move did not apply — check the project has a production environment and the resource exists"), { status: 404 });
  }
  return { ok: true };
}

// A server's standalone-docker destination (needed to create an app on a freshly
// provisioned dedicated server). Coolify's REST API has NO destinations endpoint
// (GET /destinations → 404) and the server detail omits them, so read the
// standalone_dockers table over SSH. Coolify creates the row asynchronously after
// the server validates + docker installs, so callers should poll.
export async function getServerDestination(serverUuid) {
  if (DEMO) return "demo-dest-uuid";
  const u = String(serverUuid).replace(/[^a-z0-9]/gi, "");
  if (!u) return null;
  const raw = await runSql(
    `SELECT uuid FROM standalone_dockers WHERE server_id=(SELECT id FROM servers WHERE uuid='${u}') ORDER BY id LIMIT 1`
  );
  const uuid = String(raw || "").trim().split("\n")[0].trim();
  return uuid || null;
}

// Coolify keeps build/deploy logs ONLY in its own DB (the REST API never returns
// them) — a JSON array in application_deployment_queue.logs. Read the latest
// deployment's logs for an app over the SSH channel so the panel can show WHY a
// build failed. // ponytail: // VERIFY LIVE — Coolify-internal schema (fragile).
export async function getBuildLogs(appUuid, { limit = 600 } = {}) {
  if (DEMO) return [];
  const u = String(appUuid).replace(/[^a-z0-9]/gi, "");
  if (!u) return [];
  const raw = await runSql(
    `SELECT logs FROM application_deployment_queues WHERE application_id=(SELECT id::text FROM applications WHERE uuid='${u}') ORDER BY id DESC LIMIT 1`
  );
  const text = String(raw || "").trim();
  if (!text) return [];
  let arr;
  try { arr = JSON.parse(text); } catch { return text.split("\n").filter(Boolean).slice(-limit).map((l) => ({ message: l })); }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => !x.hidden)
    .map((x) => ({ time: x.timestamp || null, type: x.type || "stdout", message: x.output ?? x.line ?? "" }))
    .slice(-limit);
}

export async function listServiceVolumes(appUuid) {
  if (DEMO) return [];
  const u = String(appUuid).replace(/[^a-z0-9]/gi, "");
  if (!u) return [];
  const out = await runSql(
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
  const appId = parseInt(String(await runSql(`SELECT id FROM applications WHERE uuid='${u}'`)).trim(), 10);
  if (!appId) throw Object.assign(new Error("service not found"), { status: 404 });
  const volUuid = coolifyUuid();
  const name = (`${u}-` + mp.replace(/[^A-Za-z0-9]/g, "-").replace(/^-+|-+$/g, "")).slice(0, 60);
  await runSql(
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
  await runSql(
    `DELETE FROM local_persistent_volumes WHERE uuid='${v}' AND resource_type='App\\Models\\Application' AND resource_id=(SELECT id FROM applications WHERE uuid='${u}')`
  );
  return { ok: true };
}
