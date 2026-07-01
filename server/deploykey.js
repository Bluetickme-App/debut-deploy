// Deploy-key path: create a Coolify app from ANY git repo without the GitHub App.
// Generates an ed25519 keypair in Node (no ssh-keygen dependency), registers the
// private half in Coolify, and hands the operator the public half to add as a
// read-only deploy key on their repo. Verified: Coolify accepts a PKCS8 PEM
// private key and derives the matching OpenSSH public key.
import { generateKeyPairSync } from "node:crypto";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.COOLIFY_API_TOKEN || "";
const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
export const isDemo = () => DEMO;

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`Coolify ${method} ${path} → ${res.status}`), { status: res.status, detail });
  }
  return res.status === 204 ? null : res.json();
}

// ed25519 keypair → { privateKeyPem (PKCS8), publicKey (OpenSSH "ssh-ed25519 …") }
export function generateDeployKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const raw = publicKey.subarray(-32); // last 32 bytes of SPKI DER = the raw ed25519 key
  const lp = (b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
  const openssh = "ssh-ed25519 " + Buffer.concat([lp(Buffer.from("ssh-ed25519")), lp(raw)]).toString("base64") + " debutdeploy";
  return { privateKeyPem: privateKey, publicKey: openssh };
}

export async function registerDeployKey({ name, privateKeyPem }) {
  if (isDemo()) return { uuid: `demo-key-${name}` };
  const r = await cf("/security/keys", { method: "POST", body: { name, description: "DebutDeploy deploy key", private_key: privateKeyPem } });
  return { uuid: r.uuid };
}

async function resolveDefaultProject() {
  if (isDemo()) return "demo-project";
  const ps = await cf("/projects");
  const found = (Array.isArray(ps) ? ps : []).find((p) => p.name === "customer-apps");
  if (found) return found.uuid;
  return (await cf("/projects", { method: "POST", body: { name: "customer-apps" } })).uuid;
}

// ponytail: single-box — server + destination are the known Coolify host; resolve
// dynamically when multi-server provisioning is in play.
const SERVER_UUID = "odtl07eovoo6f40gqwztsyhq";
const DESTINATION_UUID = "pnecqcf9akvlwqp3wnky60ml";

export async function createDeployKeyApp({ keyUuid, repo, branch = "main", name, buildPack = "nixpacks", installCommand, buildCommand, startCommand, port = "3000" }) {
  if (isDemo()) return { uuid: `demo-app-${name}` };
  const project = await resolveDefaultProject();
  const body = {
    private_key_uuid: keyUuid, project_uuid: project, environment_name: "production",
    server_uuid: SERVER_UUID, destination_uuid: DESTINATION_UUID,
    git_repository: repo, git_branch: branch, ports_exposes: String(port),
    name, build_pack: buildPack, instant_deploy: false,
  };
  if (installCommand) body.install_command = installCommand;
  if (buildCommand) body.build_command = buildCommand;
  if (startCommand) body.start_command = startCommand;
  const app = await cf("/applications/private-deploy-key", { method: "POST", body });
  return { uuid: app.uuid };
}

export async function setAppDomain(uuid, domain) {
  if (isDemo()) return { ok: true };
  await cf(`/applications/${uuid}`, { method: "PATCH", body: { domains: domain } });
  return { ok: true };
}

export async function deployApp(uuid) {
  if (isDemo()) return { ok: true, uuid };
  return cf(`/deploy?uuid=${encodeURIComponent(uuid)}`, { method: "POST" });
}
