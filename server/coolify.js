// Thin client over the Coolify v1 REST API, with a DEMO_MODE fallback that serves
// fixtures. Every method returns data already shaped for the UI, so the routes stay dumb.
//
// Coolify API reference: https://coolify.io/docs/api-reference  (base: <instance>/api/v1)

import * as fx from "./fixtures.js";
import { randomBytes } from "node:crypto";

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

function mapApp(a) {
  return {
    uuid: a.uuid,
    name: a.name,
    group: a.environment_name || a.project?.name || "Apps",
    type: a.build_pack === "dockercompose" ? "service" : "web",
    runtime: a.build_pack || "docker",
    status: a.status?.split(":")[0] || "unknown", // Coolify returns e.g. "running:healthy"
    server: a.destination?.server?.uuid || a.server_uuid || null,
    branch: a.git_branch || "main",
    repo: a.git_repository || "",
    domain: a.fqdn ? a.fqdn.replace(/^https?:\/\//, "").split(",")[0] : null,
    lastDeployedAt: a.updated_at || null,
    health: a.status?.split(":")[1] || "healthy",
  };
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
  const apps = await cf("/applications");
  return (Array.isArray(apps) ? apps : []).map(mapApp);
}

export async function getService(uuid) {
  if (isDemo()) return fx.services.find((s) => s.uuid === uuid) || null;
  return mapApp(await cf(`/applications/${uuid}`));
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
  return (Array.isArray(envs) ? envs : []).map((e) => ({
    uuid: e.uuid,
    key: e.key,
    value: e.is_secret ? "••••••" : e.value,
    is_secret: !!e.is_secret,
  }));
}

export async function upsertEnv(uuid, { key, value, is_secret }) {
  if (isDemo()) return { uuid: "demo-" + key, key, value, is_secret: !!is_secret };
  // Use the BULK endpoint — it upserts by key. Plain POST /envs 409s when the key
  // already exists (that was the "Save" failure); bulk create-or-updates cleanly.
  // is_secret is omitted (Coolify's env endpoint rejects it — 422).
  void is_secret;
  await cf(`/applications/${uuid}/envs/bulk`, {
    method: "PATCH",
    body: { data: [{ key, value, is_preview: false, is_literal: true }] },
  });
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
export async function provisionDatabase({ name, superUser = "dd_super" }) {
  if (isDemo()) return { uuid: `demo-db-${name}`, url: `postgresql://${superUser}:demo@demo-db-${name}:5432/postgres` };
  const password = randomBytes(18).toString("base64url");
  const r = await cf(`/databases/postgresql`, {
    method: "POST",
    body: {
      name, project_uuid: DB_PROJECT, environment_name: "production", server_uuid: DB_SERVER,
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
      cpu: res?.cpu_usage_percent ?? null,
      memory: res?.memory_usage_percent ?? null,
      disk: res?.disk_usage_percent ?? null,
    });
  }
  return mapped;
}

export async function getDefaultDestination(serverUuid) {
  if (isDemo()) return "demo-dest-uuid";
  // ponytail: prefer the server detail endpoint; fall back to /destinations list
  const server = await cf(`/servers/${serverUuid}`);
  const dest = (server?.destinations || []).find(
    (d) => d.type === "standalone-docker" || !d.type
  );
  if (dest?.uuid) return dest.uuid;
  const all = await cf("/destinations");
  const match = (Array.isArray(all) ? all : []).find(
    (d) => d.server_uuid === serverUuid && (d.type === "standalone-docker" || !d.type)
  );
  if (!match) throw Object.assign(new Error("No standalone-docker destination found"), { status: 404 });
  return match.uuid;
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
