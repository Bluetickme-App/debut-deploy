// Orchestrates: create Hetzner server → poll until running → register with Coolify.
//
// ponytail: synchronous orchestrator returning a steps[] log — no async job queue yet;
// the UI can poll getServer/provision-status. Async job infra is the upgrade path if
// provisioning needs backgrounding.
//
// Idempotency note: re-running with the same name will create a duplicate Hetzner server
// unless the caller checks listServers() first. Name-based dedupe is a // VERIFY LIVE /
// upgrade concern — the Hetzner API has no built-in uniqueness constraint on server names.

import { createServer, getServer, ensureSshKey, isDemo as hetznerIsDemo } from "./hetzner.js";
import { isDemo as coolifyIsDemo } from "./coolify.js";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.COOLIFY_API_TOKEN || "";

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

// Coolify already holds a private key (GET /security/keys, live-verified shape).
// We reuse it: put its PUBLIC half on the provisioned box (via Hetzner) and tell
// Coolify to connect using its private half. Prefer a non-git key (the host key).
// ponytail: reusing the host key = one key controls host + provisioned boxes;
// a dedicated per-fleet key is the upgrade path.
export async function resolveCoolifyKey() {
  if (coolifyIsDemo()) return { uuid: "demo-key-uuid", public_key: "ssh-ed25519 DEMOKEY demo" };
  const keys = await cf("/security/keys");
  const list = Array.isArray(keys) ? keys : [];
  const key = list.find((k) => !k.is_git_related) || list[0];
  if (!key) throw Object.assign(new Error("No Coolify private key available to manage servers"), { status: 500 });
  return { uuid: key.uuid, public_key: key.public_key };
}

// Register an already-running box with Coolify over SSH. privateKeyUuid is the
// Coolify key whose public half is in the box's authorized_keys.
export async function registerCoolifyServer({ ip, name, privateKeyUuid }) {
  if (coolifyIsDemo()) {
    // stable key from ip so repeated calls return the same demo uuid
    return { uuid: `demo-server-${ip.replace(/\./g, "-")}` };
  }
  // LIVE-VERIFIED against Coolify v4.1.2: POST /servers with these fields creates
  // the server and Coolify SSHes in with private_key_uuid (is_reachable → true).
  // is_usable turns true once Coolify finishes installing docker/its agent (mins).
  const data = await cf("/servers", {
    method: "POST",
    body: { name, ip, port: 22, user: "root", private_key_uuid: privateKeyUuid, instant_validate: true },
  });
  return { uuid: data.uuid };
}

// Used by the live test / teardown to remove a Coolify server entry.
export async function removeCoolifyServer(uuid) {
  if (coolifyIsDemo()) return { ok: true };
  await cf(`/servers/${uuid}`, { method: "DELETE" });
  return { ok: true };
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
  image = "ubuntu-22.04", // Coolify's Docker install is flaky on 24.04; 22.04 is battle-tested
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

  // Step 2 — prepare SSH key: Coolify holds the private key; ensure its public
  // half is a Hetzner key so the new box trusts Coolify, and Coolify can SSH in.
  let coolifyKey, sshKeyName;
  try {
    coolifyKey = await resolveCoolifyKey();
    ({ name: sshKeyName } = await ensureSshKey({ name: "coolify-provision", publicKey: coolifyKey.public_key }));
    steps.push({ step: "prepare-ssh-key", status: "ok", detail: { key: sshKeyName } });
  } catch (err) {
    steps.push({ step: "prepare-ssh-key", status: "error", detail: err.message });
    throw Object.assign(err, { steps });
  }

  // Step 3 — create Hetzner server (with the key in authorized_keys)
  let serverId, ip;
  try {
    ({ id: serverId, ip } = await createServer({ name, serverType, location, image, sshKeys: [sshKeyName] }));
    steps.push({ step: "create-server", status: "ok", detail: { id: serverId, ip } });
  } catch (err) {
    steps.push({ step: "create-server", status: "error", detail: err.message });
    throw Object.assign(err, { steps });
  }

  // Step 4 — poll until running
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

  // Step 5 — register with Coolify (connects over SSH using its own private key)
  let serverUuid;
  try {
    ({ uuid: serverUuid } = await registerCoolifyServer({ ip, name, privateKeyUuid: coolifyKey.uuid }));
    steps.push({ step: "register-coolify", status: "ok", detail: { uuid: serverUuid } });
  } catch (err) {
    steps.push({ step: "register-coolify", status: "error", detail: err.message });
    throw Object.assign(err, { steps });
  }

  return { serverUuid, hetznerId: serverId, ip, status: "running", steps };
  } finally {
    inFlight.delete(name);
  }
}
