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

// --- normaliser ---

function normaliseService(r) {
  // Render wraps items as { service: {...} } in list responses; getService returns unwrapped.
  // // VERIFY LIVE: confirm list items use `r.service` wrapper vs bare object
  const s = r.service ?? r;
  return {
    id: s.id,
    name: s.name,
    repo: s.repo ?? s.serviceDetails?.pullRequestPreviewsEnabled?.repo ?? "",
    branch: s.branch ?? s.serviceDetails?.branch ?? "",
    buildCommand: s.buildCommand ?? s.serviceDetails?.buildCommand ?? "",
    startCommand: s.startCommand ?? s.serviceDetails?.startCommand ?? "",
    type: s.type,
    env: s.env ?? s.serviceDetails?.env ?? "",
  };
}

// --- exports ---

export async function listServices(apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return FX_SERVICES;
  const data = await rq("/services", apiKey); // VERIFY LIVE: confirm endpoint + wrapper shape
  return data.map(normaliseService);
}

export async function getService(id, apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return FX_SERVICES.find((s) => s.id === id) ?? FX_SERVICES[0];
  const data = await rq(`/services/${id}`, apiKey); // VERIFY LIVE
  return normaliseService(data);
}

export async function getEnvVars(id, apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return FX_ENV_VARS;
  // VERIFY LIVE: Render returns [{ envVar: { key, value } }] — unwrap
  const data = await rq(`/services/${id}/env-vars`, apiKey);
  return data.map((item) => item.envVar ?? item);
}

export async function getConnectionInfo(datastoreId, apiKey = ENV_KEY) {
  if (isDemoFor(apiKey)) return "postgresql://user:pass@demo-host:5432/db";
  // VERIFY LIVE: confirm endpoint path and the exact field name for external connection string
  const data = await rq(`/postgres/${datastoreId}/connection-info`, apiKey);
  return data.externalConnectionString ?? data.connectionString ?? data;
}
