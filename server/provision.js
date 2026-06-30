// Orchestrates: create Hetzner server → poll until running → register with Coolify.
//
// ponytail: synchronous orchestrator returning a steps[] log — no async job queue yet;
// the UI can poll getServer/provision-status. Async job infra is the upgrade path if
// provisioning needs backgrounding.
//
// Idempotency note: re-running with the same name will create a duplicate Hetzner server
// unless the caller checks listServers() first. Name-based dedupe is a // VERIFY LIVE /
// upgrade concern — the Hetzner API has no built-in uniqueness constraint on server names.

import { createServer, getServer, isDemo as hetznerIsDemo } from "./hetzner.js";
import { isDemo as coolifyIsDemo } from "./coolify.js";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.COOLIFY_API_TOKEN || "";

async function cfPost(path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Coolify POST ${path} → ${res.status}`), {
      status: res.status,
      detail: text,
    });
  }
  return res.status === 204 ? null : res.json();
}

// Exported so callers can test/mock the Coolify registration step independently.
// // VERIFY LIVE — Coolify add-server endpoint + body unverified for v4.1.2.
export async function registerCoolifyServer({ ip, name }) {
  if (coolifyIsDemo()) {
    // stable key from ip so repeated calls return the same demo uuid
    return { uuid: `demo-server-${ip.replace(/\./g, "-")}` };
  }
  // // VERIFY LIVE — endpoint and required body fields must be confirmed against
  // the running Coolify v4.1.2 instance; /servers may require additional fields
  // like private_key_uuid or user.
  const data = await cfPost("/servers", { name, ip });
  return { uuid: data.uuid };
}

// Names currently being provisioned — blocks a double-click / client retry from
// billing a duplicate server while the first (up-to-2-min) request is in flight.
// ponytail: in-process lock; persistent name-dedup needs a hetzner listServers()
// check, the upgrade path noted in the header.
const inFlight = new Set();

export async function provisionServer({
  name,
  serverType,
  location,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxPollMs = 120_000,
} = {}) {
  const steps = [];

  // Step 1 — validate
  if (!name || !serverType) {
    throw Object.assign(new Error("name and serverType are required"), { status: 400 });
  }
  if (inFlight.has(name)) {
    throw Object.assign(new Error(`A server named "${name}" is already being provisioned`), { status: 409 });
  }
  inFlight.add(name);
  steps.push({ step: "validate", status: "ok", detail: null });
  try {

  // Step 2 — create Hetzner server
  let serverId, ip;
  try {
    ({ id: serverId, ip } = await createServer({ name, serverType, location }));
    steps.push({ step: "create-server", status: "ok", detail: { id: serverId, ip } });
  } catch (err) {
    steps.push({ step: "create-server", status: "error", detail: err.message });
    throw Object.assign(err, { steps });
  }

  // Step 3 — poll until running
  const deadline = Date.now() + maxPollMs;
  let serverStatus = "initializing";
  try {
    while (serverStatus !== "running") {
      if (Date.now() > deadline) {
        throw Object.assign(new Error(`Server ${serverId} did not reach 'running' within ${maxPollMs}ms`), {
          status: 504,
        });
      }
      const s = await getServer(serverId);
      serverStatus = s.status;
      if (serverStatus !== "running") await sleep(5_000);
    }
    steps.push({ step: "await-running", status: "ok", detail: { id: serverId } });
  } catch (err) {
    steps.push({ step: "await-running", status: "error", detail: err.message });
    throw Object.assign(err, { steps });
  }

  // Step 4 — register with Coolify
  let serverUuid;
  try {
    ({ uuid: serverUuid } = await registerCoolifyServer({ ip, name }));
    steps.push({ step: "register-coolify", status: "ok", detail: { uuid: serverUuid } });
  } catch (err) {
    steps.push({ step: "register-coolify", status: "error", detail: err.message });
    throw Object.assign(err, { steps });
  }

  return { serverUuid, ip, status: "running", steps };
  } finally {
    inFlight.delete(name);
  }
}
