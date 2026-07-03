// Thin client over the Coolify v1 REST API, with a DEMO_MODE fallback that serves
// fixtures. Every method returns data already shaped for the UI, so the routes stay dumb.
//
// Coolify API reference: https://coolify.io/docs/api-reference  (base: <instance>/api/v1)

import * as fx from "./fixtures.js";
import { randomBytes } from "node:crypto";
import { rememberEnv, storedEnvs } from "./envstore.js";
import * as coolifydb from "./coolifydb.js";

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.COOLIFY_API_TOKEN || "";

if (!DEMO && (!BASE || !TOKEN)) {
  throw new Error("COOLIFY_BASE_URL and COOLIFY_API_TOKEN are required outside demo mode");
}

export const isDemo = () => DEMO;

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

// --- normalisers: map Coolify's raw objects onto the UI shape ----------------

function mapApp(a, region = "") {
  return {
    uuid: a.uuid,
    name: a.name,
    group: a.environment_name || a.project?.name || "Apps",
    project: a.project?.name || a.environment_name || null, // Coolify project this app belongs to
    type: a.build_pack === "dockercompose" ? "service" : "web",
    runtime: a.build_pack || "docker",
    status: a.status?.split(":")[0] || "unknown", // Coolify returns e.g. "running:healthy"
    server: a.destination?.server?.uuid || a.server_uuid || null,
    region, // datacenter of the host it runs on (Coolify has no region; resolved from Hetzner)
    branch: a.git_branch || "main",
    repo: a.git_repository || "",
    domain: a.fqdn ? a.fqdn.replace(/^https?:\/\//, "").split(",")[0] : null,
    lastDeployedAt: a.updated_at || null,
    health: a.status?.split(":")[1] || "healthy",
  };
}

// The shared host's datacenter — all shared-mode apps run there. Coolify servers
// carry no location, so resolve it from Hetzner once and cache. // ponytail:
// single-host setup; per-server region is the upgrade path for dedicated servers.
let _regionCache;
async function sharedRegion() {
  if (_regionCache !== undefined) return _regionCache;
  _regionCache = "";
  try {
    const K = process.env.HETZNER_API_KEY;
    if (!K) return _regionCache;
    const j = await (await fetch("https://api.hetzner.cloud/v1/servers", { headers: { Authorization: `Bearer ${K}` } })).json();
    const s = (j.servers || [])[0];
    _regionCache = s?.location?.city || s?.location?.name || ""; // Hetzner puts it on `location`, not `datacenter`
  } catch { /* leave blank on failure */ }
  return _regionCache;
}

function mapDb(d) {
  return {
    uuid: d.uuid,
    name: d.name,
    type: (d.type || d.database_type || "postgresql").replace("standalone-", ""),
    version: d.version || "",
    status: d.status?.split(":")[0] || "running",
    server: d.destination?.server?.uuid || null,
    logicalDbs: [],
    sizeMb: null,
    connections: null,
    internalUrl: d.internal_db_url || null,
  };
}

// --- public API used by routes ----------------------------------------------

export async function listServices() {
  if (isDemo()) return fx.services;
  const [apps, region] = await Promise.all([cf("/applications"), sharedRegion()]);
  return (Array.isArray(apps) ? apps : []).map((a) => mapApp(a, region));
}

// Coolify projects, for the "Move to project" picker.
export async function listProjects() {
  if (isDemo()) return [{ uuid: "demo-proj", name: "Apps" }];
  const ps = await cf("/projects");
  return (Array.isArray(ps) ? ps : []).map((p) => ({ uuid: p.uuid, name: p.name }));
}

// Move an app or database into another Coolify project (via the DB — no REST route).
export async function moveToProject(resourceUuid, projectUuid, kind) {
  return coolifydb.moveToProject(resourceUuid, projectUuid, kind);
}

export async function getService(uuid) {
  if (isDemo()) return fx.services.find((s) => s.uuid === uuid) || null;
  const [app, region] = await Promise.all([cf(`/applications/${uuid}`), sharedRegion()]);
  return mapApp(app, region);
}

export async function deployService(uuid) {
  if (isDemo()) return { ok: true, message: "Deployment queued (demo)", uuid };
  const r = await cf(`/deploy?uuid=${encodeURIComponent(uuid)}`, { method: "POST" });
  return { ok: true, message: "Deployment queued", ...r };
}

export async function controlService(uuid, action) {
  // action: start | stop | restart
  if (isDemo()) return { ok: true, message: `${action} queued (demo)`, uuid };
  await cf(`/applications/${uuid}/${action}`, { method: "POST" });
  return { ok: true, message: `${action} queued`, uuid };
}

export async function listDeployments(uuid) {
  if (isDemo()) return fx.getDeployments(uuid);
  const all = await cf(`/deployments`);
  return (Array.isArray(all) ? all : [])
    // Coolify's deployment.application_id is a NUMERIC id, not the uuid; the
    // app uuid appears inside deployment_url (…/application/<uuid>/deployment/…)
    .filter(
      (d) =>
        (d.deployment_url || "").includes(uuid) ||
        d.application_id === uuid ||
        d.application?.uuid === uuid
    )
    .map((d) => ({
      uuid: d.deployment_uuid || d.id,
      status: d.status,
      commit: d.commit?.slice?.(0, 7) || "",
      message: d.commit_message || "",
      branch: d.git_branch || "main",
      startedAt: d.created_at,
      durationSec: null,
      trigger: d.is_webhook ? "git push" : "manual",
    }));
}

export async function getLogLines(uuid) {
  const svc = await getService(uuid);
  if (isDemo()) return fx.buildLog(svc?.name || "app");
  const r = await cf(`/applications/${uuid}/logs`);
  const raw = typeof r === "string" ? r : r?.logs || "";
  return raw.split("\n").filter(Boolean);
}

export async function listEnvs(uuid) {
  if (isDemo()) return fx.getEnvs(uuid);
  const envs = await cf(`/applications/${uuid}/envs`);
  // Coolify mirrors EVERY var into a hidden is_preview:true copy (for preview
  // deployments), so /envs returns each key twice. The panel manages production
  // config only — drop the preview copies, else every key looks duplicated.
  //
  // Coolify's API returns NO value and NO reliable is_secret, so we merge our own
  // encrypted mirror (envstore) back over the key list: non-secret values shown
  // directly, secrets left blank + revealable (fetched on demand via the reveal
  // route). Keys set outside the panel aren't in the mirror → blank, revealable:false.
  const stored = storedEnvs(uuid);
  return (Array.isArray(envs) ? envs : []).filter((e) => !e.is_preview).map((e) => {
    const s = stored.get(e.key);
    const is_secret = s ? s.is_secret : false;
    return {
      uuid: e.uuid,
      key: e.key,
      value: s && !is_secret ? s.value : "",
      is_secret,
      revealable: !!s,
    };
  });
}

export async function upsertEnv(uuid, { key, value, is_secret }) {
  if (isDemo()) return { uuid: "demo-" + key, key, value, is_secret: !!is_secret };
  // Use the BULK endpoint — it upserts by key. Plain POST /envs 409s when the key
  // already exists (that was the "Save" failure); bulk create-or-updates cleanly.
  // is_secret is omitted from the Coolify body (its env endpoint rejects it — 422),
  // but we DO record it in our own encrypted mirror below.
  await cf(`/applications/${uuid}/envs/bulk`, {
    method: "PATCH",
    body: { data: [{ key, value, is_preview: false, is_literal: true }] },
  });
  // Capture the plaintext (encrypted) so the editor can show it + reveal works —
  // Coolify's API never hands values back. Best-effort: never fail the write on it.
  try { rememberEnv(uuid, key, value, is_secret); } catch { /* mirror is non-critical */ }
  return { ok: true, key };
}

export async function deleteEnv(uuid, envUuid) {
  if (isDemo()) return { ok: true };
  await cf(`/applications/${uuid}/envs/${envUuid}`, { method: "DELETE" });
  return { ok: true };
}

export async function listDatabases() {
  if (isDemo()) return fx.databases;
  const dbs = await cf("/databases");
  return (Array.isArray(dbs) ? dbs : []).map(mapDb);
}

// Connection URL for a Coolify database by uuid — the migration restore target.
// ponytail: // VERIFY LIVE — Coolify DB URL field names vary by version.
export async function resolveDbUrl(uuid) {
  if (isDemo()) return `postgres://demo:demo@demo-db.internal:5432/${uuid}`;
  const db = await cf(`/databases/${encodeURIComponent(uuid)}`);
  return db?.internal_db_url || db?.postgres_url || db?.external_db_url || null;
}

// Full detail for one Coolify database — powers the Render-style DB detail page.
// Coolify's /databases/{uuid} exposes name/image/status/ssl/limits/postgres_* but
// NOT the password or a ready connection URL, so we surface what's available.
function mapDbDetail(d) {
  const version = (d.image || "").match(/:(\d+)/)?.[1] || d.version || "";
  const status = d.status?.split(":") || [];
  return {
    uuid: d.uuid,
    name: d.name,
    type: (d.database_type || d.type || "postgresql").replace("standalone-", ""),
    version,
    image: d.image || null,
    status: status[0] || "unknown",
    health: status[1] || "",
    ssl: !!d.enable_ssl,
    sslMode: d.ssl_mode || null,
    server: d.destination?.server?.name || d.destination?.name || null,
    createdAt: d.created_at || null,
    lastOnlineAt: d.last_online_at || null,
    postgresDb: d.postgres_db || null,
    postgresUser: d.postgres_user || null,
    host: d.uuid,
    port: d.public_port || 5432,
    isPublic: !!d.is_public,
    limits: { cpus: d.limits_cpus ?? null, memory: d.limits_memory ?? null, cpuShares: d.limits_cpu_shares ?? null },
    healthCheck: { enabled: !!d.health_check_enabled, interval: d.health_check_interval ?? null },
    // No password in the API response; internal URL shown without it (host is the container name).
    internalUrl: d.internal_db_url || (d.postgres_user ? `postgresql://${d.postgres_user}@${d.uuid}:5432/${d.postgres_db || "postgres"}` : null),
  };
}

export async function getDatabase(uuid) {
  if (isDemo()) return fx.databases.find((d) => d.uuid === uuid) || null;
  return mapDbDetail(await cf(`/databases/${encodeURIComponent(uuid)}`));
}

// Provision a fresh Coolify Postgres and return its credential-safe connection URL.
// Verified live: the create response includes internal_db_url WITH the password we
// set — so unlike an EXISTING db (whose password Coolify won't return), a db we
// provision is credential-safe. Used to stand up the shared cluster.
const DB_PROJECT = process.env.COOLIFY_DB_PROJECT_UUID || "qxm8dk7s33dk057p0g2x66ia";
const DB_SERVER = process.env.COOLIFY_SERVER_UUID || "odtl07eovoo6f40gqwztsyhq";
// `image` picks the Postgres version. Default to PG18 (Render's current default) so a
// migrated PG≤18 source restores into an equal-or-newer target — the supported
// direction, no downgrade. Coolify's create-postgres API accepts an `image` field;
// omitting it defaults to postgres:16-alpine (too old for modern Render sources).
export async function provisionDatabase({ name, superUser = "dd_super", image = process.env.PG_TARGET_IMAGE || "postgres:18-alpine" }) {
  if (isDemo()) return { uuid: `demo-db-${name}`, url: `postgresql://${superUser}:demo@demo-db-${name}:5432/postgres` };
  const password = randomBytes(18).toString("base64url");
  const r = await cf(`/databases/postgresql`, {
    method: "POST",
    body: {
      name, project_uuid: DB_PROJECT, environment_name: "production", server_uuid: DB_SERVER, image,
      postgres_user: superUser, postgres_password: password, postgres_db: "postgres", instant_deploy: true,
    },
  });
  return { uuid: r.uuid, url: r.internal_db_url || `postgresql://${superUser}:${password}@${r.uuid}:5432/postgres` };
}

// Rename (Render-style editable Name). Coolify PATCH accepts { name } — verified live.
export async function renameService(uuid, name) {
  if (isDemo()) return { ok: true, uuid, name };
  await cf(`/applications/${uuid}`, { method: "PATCH", body: { name } });
  return { ok: true, uuid, name };
}

// Patch an application's build/runtime config (build/start commands, health-check
// path, base directory). Used to apply a Render blueprint to a freshly-created app.
export async function patchApp(uuid, fields) {
  if (isDemo()) return { ok: true };
  const clean = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v != null && v !== ""));
  if (!Object.keys(clean).length) return { ok: true, noop: true };
  await cf(`/applications/${uuid}`, { method: "PATCH", body: clean });
  return { ok: true };
}
export async function renameDatabase(uuid, name) {
  if (isDemo()) return { ok: true, uuid, name };
  await cf(`/databases/${uuid}`, { method: "PATCH", body: { name } });
  return { ok: true, uuid, name };
}

export async function listServers() {
  if (isDemo()) return fx.servers;
  const servers = await cf("/servers");
  const mapped = [];
  for (const s of Array.isArray(servers) ? servers : []) {
    let res = {};
    try {
      res = await cf(`/servers/${s.uuid}/resources`);
    } catch {
      /* resources optional */
    }
    mapped.push({
      uuid: s.uuid,
      name: s.name,
      description: s.description || "",
      ip: s.ip,
      region: s.region || "",
      spec: "",
      reachable: s.is_reachable ?? true,
      usable: s.is_usable ?? true, // Coolify's "in active service" flag — false = taken out of rotation
      cpu: res?.cpu_usage_percent ?? null,
      memory: res?.memory_usage_percent ?? null,
      disk: res?.disk_usage_percent ?? null,
    });
  }
  return mapped;
}

export async function getDefaultDestination(serverUuid, { tries = 24, delayMs = 5000, _get = coolifydb.getServerDestination } = {}) {
  if (isDemo()) return "demo-dest-uuid";
  // Coolify's REST API exposes NO destinations (GET /destinations → 404; the server
  // detail omits them), so read the standalone-docker destination from Coolify's DB
  // over SSH. On a freshly provisioned server Coolify creates it asynchronously, so
  // poll until it appears (~2 min) rather than failing the migration immediately.
  for (let i = 0; i < tries; i++) {
    const uuid = await _get(serverUuid).catch(() => null);
    if (uuid) return uuid;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw Object.assign(new Error("The new server has no docker destination yet — Coolify is still installing it. Retry the migration in a minute."), { status: 503 });
}

export async function createProject(name) {
  if (isDemo()) return { uuid: "demo-proj-" + name };
  const r = await cf("/projects", { method: "POST", body: { name } });
  return { uuid: r.uuid };
}

export async function createPrivateGithubApp({
  githubAppUuid,
  projectUuid,
  environmentName,
  serverUuid,
  destinationUuid,
  gitRepository,
  gitBranch,
  portsExposes,
  name,
  buildPack = "nixpacks",
  instantDeploy = true,
  installCommand,
  buildCommand,
  startCommand,
}) {
  if (isDemo()) return { uuid: "demo-app-" + name };
  const body = {
    github_app_uuid: githubAppUuid,
    project_uuid: projectUuid,
    environment_name: environmentName,
    server_uuid: serverUuid,
    destination_uuid: destinationUuid,
    git_repository: gitRepository,
    git_branch: gitBranch,
    ports_exposes: portsExposes,
    name,
    build_pack: buildPack,
    instant_deploy: instantDeploy,
  };
  // ponytail: only send optional commands when provided — omitting beats sending null
  if (installCommand !== undefined) body.install_command = installCommand;
  if (buildCommand !== undefined) body.build_command = buildCommand;
  if (startCommand !== undefined) body.start_command = startCommand;
  const r = await cf("/applications/private-github-app", { method: "POST", body });
  return { uuid: r.uuid };
}

export async function getDeploymentLogs(deploymentUuid) {
  if (isDemo()) return ["(demo) build step 1", "(demo) done"];
  const r = await cf(`/deployments/${deploymentUuid}`);
  const raw = r?.logs || "";
  return raw.split("\n").filter(Boolean);
}

export async function rollback(uuid, commit) {
  if (isDemo()) return { ok: true, uuid, commit };
  // ponytail: set the target sha then trigger deploy — Coolify has no dedicated rollback endpoint
  await cf(`/applications/${uuid}`, { method: "PATCH", body: { git_commit_sha: commit } });
  const r = await cf(`/deploy?uuid=${encodeURIComponent(uuid)}&force=true`, { method: "POST" });
  const dep = r?.deployments?.[0];
  return { ok: true, uuid, commit, deploymentUuid: dep?.deployment_uuid };
}
