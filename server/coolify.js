// Thin client over the Coolify v1 REST API, with a DEMO_MODE fallback that serves
// fixtures. Every method returns data already shaped for the UI, so the routes stay dumb.
//
// Coolify API reference: https://coolify.io/docs/api-reference  (base: <instance>/api/v1)

import * as fx from "./fixtures.js";

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
  // Coolify uses POST to create, PATCH to update by key
  return cf(`/applications/${uuid}/envs`, {
    method: "POST",
    body: { key, value, is_preview: false, is_secret: !!is_secret },
  });
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
