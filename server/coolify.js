// Thin client over the Coolify v1 REST API, with a DEMO_MODE fallback that serves
// fixtures. Every method returns data already shaped for the UI, so the routes stay dumb.
//
// Coolify API reference: https://coolify.io/docs/api-reference  (base: <instance>/api/v1)

import * as fx from "./fixtures.js";
import { randomBytes } from "node:crypto";
import { rememberEnv, storedEnvs } from "./envstore.js";
import * as coolifydb from "./coolifydb.js";
import { serverIpFromFqdn } from "./dns.js";

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
    // Host IP this app actually runs on, read from its auto {uuid}.<IP>.sslip.io URL.
    // Single source of truth for the per-service custom-domain A record — on a
    // multi-host fleet each service must point at its own box, not a global default.
    serverIp: serverIpFromFqdn(a.fqdn),
    lastDeployedAt: a.updated_at || null,
    health: a.status?.split(":")[1] || "healthy",
    // Real Docker resource limits ("0" = unlimited/shared). Editable via updateServiceResources.
    resources: { cpus: a.limits_cpus ?? "0", memory: a.limits_memory ?? "0" },
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

// Is a repo private? GitHub returns 404 to unauthenticated callers for private
// repos and 200 for public ones, so an anon API call IS the signal — no token
// needed. Cache per owner/repo. // ponytail: 6h TTL keeps us under the 60/hr
// unauth rate limit for a handful of repos; add GITHUB_TOKEN if that ceiling bites.
const _visCache = new Map(); // "owner/repo" -> { private, ts }
const VIS_TTL = 6 * 3600 * 1000;
function ownerRepo(repo) {
  if (!repo) return null;
  const s = String(repo);
  const m = s.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i) || s.match(/^([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}
async function repoIsPrivate(repo) {
  const key = ownerRepo(repo);
  if (!key) return false;
  const c = _visCache.get(key);
  if (c && Date.now() - c.ts < VIS_TTL) return c.private;
  try {
    const h = { "User-Agent": "debutdeploy", Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/repos/${key}`, { headers: h });
    let priv;
    if (r.status === 200) priv = !!(await r.json()).private;
    else if (r.status === 404) priv = true; // private or gone — either way not publicly linkable
    else return false; // rate-limited/unknown: no lock, don't poison the cache
    _visCache.set(key, { private: priv, ts: Date.now() });
    return priv;
  } catch { return false; }
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
  const list = (Array.isArray(apps) ? apps : []).map((a) => mapApp(a, region));
  await Promise.all(list.map(async (s) => { s.repoPrivate = await repoIsPrivate(s.repo); }));
  return list;
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

export async function deployService(uuid, { force = false } = {}) {
  if (isDemo()) return { ok: true, message: "Deployment queued (demo)", uuid };
  // force=true makes Coolify rebuild from scratch (clears the build cache).
  const r = await cf(`/deploy?uuid=${encodeURIComponent(uuid)}${force ? "&force=true" : ""}`, { method: "POST" });
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
  const mapped = (Array.isArray(all) ? all : [])
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
      message: (d.commit_message || "").split("\n")[0].trim(), // first line only (Render-style)
      branch: d.git_branch || "main",
      startedAt: d.created_at,
      durationSec: null,
      trigger: d.is_webhook ? "git push" : "manual",
    }));
  // Manual/API redeploys don't carry a commit_message; borrow it from a git-push
  // deploy of the SAME commit so the list isn't a wall of blank rows.
  const msgByCommit = {};
  for (const d of mapped) if (d.commit && d.message) msgByCommit[d.commit] = d.message;
  for (const d of mapped) if (d.commit && !d.message) d.message = msgByCommit[d.commit] || "";
  return mapped;
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
// serverUuid targets a specific host (default: the primary). Because WE set the
// password, the returned URL is credential-complete WITHOUT a host-side reveal — so
// this works on ANY host, unlike getDatabaseCredentials (SSH docker-inspect) which
// only reaches the primary. That makes it the way to stand up a dedicated DB on a
// secondary host and still get a usable connection string back.
export async function provisionDatabase({ name, superUser = "dd_super", image = process.env.PG_TARGET_IMAGE || "postgres:18-alpine", serverUuid = DB_SERVER }) {
  if (isDemo()) return { uuid: `demo-db-${name}`, url: `postgresql://${superUser}:demo@demo-db-${name}:5432/postgres` };
  const password = randomBytes(18).toString("base64url");
  const r = await cf(`/databases/postgresql`, {
    method: "POST",
    body: {
      name, project_uuid: DB_PROJECT, environment_name: "production", server_uuid: serverUuid, image,
      postgres_user: superUser, postgres_password: password, postgres_db: "postgres", instant_deploy: true,
    },
  });
  return { uuid: r.uuid, url: r.internal_db_url || `postgresql://${superUser}:${password}@${r.uuid}:5432/postgres` };
}

// Provision a fresh Redis (Coolify's create-redis endpoint mirrors create-postgres).
// Render's "Key Value" is Redis-compatible, so redis:7-alpine is a drop-in target.
// Like provisionDatabase, WE set the password → the returned URL is credential-complete
// (unlike an existing DB, whose password Coolify won't hand back).
export async function provisionRedis({ name, image = process.env.REDIS_TARGET_IMAGE || "redis:7-alpine", serverUuid = DB_SERVER }) {
  if (isDemo()) return { uuid: `demo-redis-${name}`, url: `redis://default:demo@demo-redis-${name}:6379` };
  const password = randomBytes(18).toString("base64url");
  const r = await cf(`/databases/redis`, {
    method: "POST",
    body: {
      name, project_uuid: DB_PROJECT, environment_name: "production", server_uuid: serverUuid, image,
      redis_password: password, instant_deploy: true,
    },
  });
  return { uuid: r.uuid, url: r.internal_db_url || `redis://default:${password}@${r.uuid}:6379` };
}

// Fleet-wide build queue: every deployment Coolify currently considers active
// (in_progress + queued) across ALL apps. Feeds the Render-style "Build Queue"
// panel so a pile-up (several deploys stacked on one app) is visible at a glance.
export async function listActiveDeployments() {
  if (isDemo()) return fx.getActiveDeployments ? fx.getActiveDeployments() : [];
  const all = await cf(`/deployments`);
  return (Array.isArray(all) ? all : []).map((d) => ({
    id: d.id,
    deploymentUuid: d.deployment_uuid,     // for cancel (POST /deployments/:uuid/cancel)
    // app uuid lives inside deployment_url (…/application/<uuid>/deployment/…); the
    // application_id field is a numeric id, useless for linking to the service page.
    uuid: (d.deployment_url || "").match(/application\/([^/]+)\/deployment/)?.[1] || null,
    app: d.application_name || "(unknown)",
    status: d.status,                       // "in_progress" | "queued"
    server: d.server_name || "",
    force: !!d.force_rebuild,               // clear-cache rebuild
    rollback: !!d.rollback,
    trigger: d.is_webhook ? "git push" : "manual",
    commit: (d.commit || "").slice(0, 7),
    message: (d.commit_message || "").split("\n")[0].trim(),
    startedAt: d.created_at,
  }));
}

// Cancel a running/queued deployment. Coolify 4.1.2 exposes this (undocumented in
// the REST list but live): POST /deployments/:uuid/cancel → 200; a 500 with
// "cannot be cancelled" means it already finished/cancelled (treat as done).
export async function cancelDeployment(deploymentUuid) {
  if (isDemo()) return { ok: true };
  try {
    await cf(`/deployments/${encodeURIComponent(deploymentUuid)}/cancel`, { method: "POST" });
  } catch (e) {
    // Coolify 4.1.2 quirks, both meaning "build is no longer running" → success:
    //  • in_progress build throws "Undefined variable $application" but STILL cancels
    //  • already-finished build throws "cannot be cancelled"
    const msg = String(e?.detail || e?.message || "");
    if (!/cannot be cancelled|Undefined variable \$application/i.test(msg)) throw e;
  }
  return { ok: true };
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
// Update a service's Docker resource limits. Coolify accepts limits_cpus (e.g. "0"|"1"|"0.5")
// and limits_memory (e.g. "0"|"512M"|"1G"). "0" = unlimited. Applied on next deploy.
export async function updateServiceResources(uuid, { cpus, memory, memorySwap }) {
  if (isDemo()) return { ok: true, resources: { cpus: String(cpus ?? "0"), memory: String(memory ?? "0") } };
  const body = {};
  if (cpus !== undefined) body.limits_cpus = String(cpus);
  if (memory !== undefined) body.limits_memory = String(memory);
  // limits_memory_swap: Docker rejects a container when swap is set but memory isn't
  // (the "flaky deploy" class). Callers should set both, or leave both "0".
  if (memorySwap !== undefined) body.limits_memory_swap = String(memorySwap);
  await cf(`/applications/${uuid}`, { method: "PATCH", body });
  return { ok: true, resources: { cpus: String(cpus ?? "0"), memory: String(memory ?? "0"), memorySwap: memorySwap !== undefined ? String(memorySwap) : undefined } };
}

// Read the build configuration (build-pack, subdir, dockerfile path, git, limits) —
// so callers can SEE the pipeline config, not just guess. Raw Coolify app fields.
export async function getBuildConfig(uuid) {
  if (isDemo()) return { uuid, build_pack: "nixpacks", base_directory: "/", dockerfile_location: null };
  const a = await cf(`/applications/${uuid}`);
  return {
    uuid: a.uuid,
    name: a.name,
    build_pack: a.build_pack,               // nixpacks | dockerfile | static | dockercompose
    base_directory: a.base_directory,
    dockerfile_location: a.dockerfile_location,
    ports_exposes: a.ports_exposes,
    git_branch: a.git_branch,
    git_commit_sha: a.git_commit_sha,       // pinned SHA ("HEAD" = tracks branch tip)
    limits_cpus: a.limits_cpus,
    limits_memory: a.limits_memory,
    limits_memory_swap: a.limits_memory_swap,
  };
}

// Flip the build-pack (e.g. dockerfile ↔ nixpacks) + optional subdir/dockerfile/port.
// Applied on next deploy. This was the thing nobody could change without SSH.
const BUILD_PACKS = new Set(["nixpacks", "dockerfile", "static", "dockercompose"]);
export async function setBuildPack(uuid, { buildPack, baseDirectory, dockerfileLocation, portsExposes }) {
  if (buildPack !== undefined && !BUILD_PACKS.has(buildPack)) {
    throw Object.assign(new Error(`buildPack must be one of: ${[...BUILD_PACKS].join(", ")}`), { status: 400 });
  }
  if (isDemo()) return { ok: true, uuid, buildPack };
  const body = {};
  if (buildPack !== undefined) body.build_pack = buildPack;
  if (baseDirectory !== undefined) body.base_directory = baseDirectory;
  if (dockerfileLocation !== undefined) body.dockerfile_location = dockerfileLocation;
  if (portsExposes !== undefined) body.ports_exposes = String(portsExposes);
  if (!Object.keys(body).length) throw Object.assign(new Error("nothing to update"), { status: 400 });
  await cf(`/applications/${uuid}`, { method: "PATCH", body });
  return { ok: true, uuid, ...body };
}

export async function renameDatabase(uuid, name) {
  if (isDemo()) return { ok: true, uuid, name };
  await cf(`/databases/${uuid}`, { method: "PATCH", body: { name } });
  return { ok: true, uuid, name };
}

// Apply a Docker memory limit to a database container (scale up/down). Coolify's
// DB PATCH accepts limits_memory ("512M"|"1G"|"0"=unlimited); applied on restart.
export async function updateDatabaseResources(uuid, { memory }) {
  if (isDemo()) return { ok: true, memory };
  if (memory !== undefined) await cf(`/databases/${uuid}`, { method: "PATCH", body: { limits_memory: String(memory) } });
  return { ok: true, memory };
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
    // Coolify's REST has no live host CPU/RAM/disk %, but /resources lists what's
    // DEPLOYED on the box — count it (real, useful) instead of faking a gauge.
    const resourceCount = Array.isArray(res) ? res.length : null;
    mapped.push({
      uuid: s.uuid,
      name: s.name,
      description: s.description || "",
      ip: s.ip,
      region: s.region || "",
      spec: "",
      reachable: s.is_reachable ?? true,
      usable: s.is_usable ?? (s.is_reachable ?? true), // reachable AND validated (jq/docker ok)
      isHost: !!s.is_coolify_host,
      resourceCount,
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
