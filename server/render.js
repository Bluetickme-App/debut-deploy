// Thin client over the Render v1 REST API, with a DEMO_MODE fallback that serves
// fixtures. Per-call apiKey lets the importer use a user-supplied key at request time.
//
// Render API reference: https://api.render.com/v1  (all live paths marked // VERIFY LIVE)

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
const ENV_KEY = process.env.RENDER_API_KEY || "";

export const isDemo = () => DEMO;

// Gate on per-call key so a request with no key gets fixtures even in live mode.
const isDemoFor = (apiKey) => DEMO || !apiKey;

async function rq(path, apiKey, { method = "GET" } = {}) {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // ponytail: key never appears in error — only path+status
    throw Object.assign(new Error(`Render ${method} ${path} → ${res.status}`), {
      status: res.status,
      detail,
    });
  }
  return res.status === 204 ? null : res.json();
}

// Render list endpoints are cursor-paginated: each item carries a `cursor` and you
// re-request with ?cursor=<last item's cursor>. Page through until a short page so
// accounts with >100 services/DBs aren't silently truncated.
async function rqAll(path, apiKey, { limit = 100 } = {}) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await rq(`${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, apiKey);
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    if (page.length < limit) break;
    cursor = page[page.length - 1]?.cursor;
    if (!cursor) break;
  }
  return out;
}

// --- fixtures ---

const FX_SERVICES = [
  {
    id: "srv-demo1",
    name: "web",
    repo: "https://github.com/acme/web",
    branch: "main",
    buildCommand: "npm i && npm run build",
    startCommand: "npm start",
    type: "web_service",
    env: "node",
  },
  {
    id: "srv-demo2",
    name: "worker",
    repo: "https://github.com/acme/worker",
    branch: "main",
    buildCommand: "npm i",
    startCommand: "node worker.js",
    type: "background_worker",
    env: "node",
  },
];

const FX_ENV_VARS = [
  { key: "NODE_ENV", value: "production" },
  { key: "PORT", value: "10000" },
];

const FX_DATABASES = [
  { id: "dpg-demo1", name: "web-db", plan: "starter", region: "frankfurt", status: "available", version: "16" },
];

// --- normaliser ---

// Verified against the live Render v1 API (2026-07-02): list items wrap the object
// as { cursor, service }; repo/branch/rootDir are top-level; build/start commands
// live under serviceDetails.envSpecificDetails; runtime under serviceDetails.
export function normaliseService(r) {
  const s = r.service ?? r;
  const sd = s.serviceDetails ?? {};
  const esd = sd.envSpecificDetails ?? {};
  return {
    id: s.id,
    name: s.name,
    repo: s.repo ?? "",
    branch: s.branch ?? "",
    rootDir: s.rootDir ?? "",
    buildCommand: (esd.buildCommand ?? "").trim(),
    startCommand: (esd.startCommand ?? "").trim(),
    type: s.type,
    env: sd.runtime ?? sd.env ?? "",
    region: sd.region ?? "",
    plan: sd.plan ?? "",
    healthCheckPath: (sd.healthCheckPath ?? "").trim(),
    // Docker services: where the Dockerfile + build context live (Render defaults
    // "./Dockerfile" + repo root). Captured defensively across the shapes Render uses.
    dockerfilePath: (sd.dockerfilePath ?? sd.dockerDetails?.dockerfilePath ?? esd.dockerfilePath ?? "").trim(),
    dockerContext: (sd.dockerContext ?? sd.dockerDetails?.dockerContext ?? esd.dockerContext ?? "").trim(),
    autoDeploy: s.autoDeploy ?? null,
    dashboardUrl: s.dashboardUrl ?? null,
  };
}

// --- exports ---

export async function listServices(apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return FX_SERVICES;
  return (await rqAll("/services", apiKey)).map(normaliseService);
}

export async function getService(id, apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return FX_SERVICES.find((s) => s.id === id) ?? FX_SERVICES[0];
  return normaliseService(await rq(`/services/${id}`, apiKey));
}

export async function getEnvVars(id, apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return FX_ENV_VARS;
  // Render returns [{ envVar: { key, value }, cursor }] — unwrap. Verified live.
  return (await rqAll(`/services/${id}/env-vars`, apiKey)).map((item) => item.envVar ?? item);
}

// Render Postgres instances — the migration SOURCE picker (each maps to a chosen
// Coolify target). Verified live: list items wrap as { postgres, cursor }.
export async function listDatabases(apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return FX_DATABASES;
  return (await rqAll("/postgres", apiKey)).map((r) => {
    const p = r.postgres ?? r;
    return { id: p.id, name: p.name, plan: p.plan, region: p.region, status: p.status, version: p.version };
  });
}

export async function listProjects(apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return [{ id: "proj-demo", name: "demo", environmentIds: [] }];
  return (await rqAll("/projects", apiKey)).map((r) => {
    const p = r.project ?? r;
    return { id: p.id, name: p.name, environmentIds: p.environmentIds ?? [] };
  });
}

export async function getConnectionInfo(datastoreId, apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return "postgresql://user:pass@demo-host:5432/db";
  // Verified live: response has externalConnectionString / internalConnectionString.
  const data = await rq(`/postgres/${datastoreId}/connection-info`, apiKey);
  return data.externalConnectionString ?? data.connectionString ?? data;
}
