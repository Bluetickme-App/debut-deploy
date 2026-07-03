// Thin client over the Hetzner Cloud v1 REST API, with a DEMO_MODE fallback.
// Every method returns data shaped for the UI; routes stay dumb.
// Hetzner API reference: https://docs.hetzner.cloud/

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
// Accept either name — HETZNER_API_TOKEN is canonical; HETZNER_API_KEY is the
// common instinct (matches RENDER_API_KEY) so we don't make operators rename it.
const TOKEN = process.env.HETZNER_API_TOKEN || process.env.HETZNER_API_KEY || "";

export const isDemo = () => DEMO || !TOKEN;

async function hz(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.hetzner.cloud/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`Hetzner ${method} ${path} → ${res.status}`), {
      status: res.status,
      detail,
    });
  }
  return res.status === 204 ? null : res.json();
}

export async function listServerTypes() {
  if (isDemo()) {
    return [
      { name: "cx22", cores: 2, memory: 4, disk: 40, price: "3.79/mo" },
      { name: "cx32", cores: 4, memory: 8, disk: 80, price: "6.49/mo" },
      { name: "cx42", cores: 8, memory: 16, disk: 160, price: "13.49/mo" },
    ];
  }
  // VERIFY LIVE
  const data = await hz("/server_types");
  return data.server_types.map(({ name, cores, memory, disk }) => ({ name, cores, memory, disk }));
}

// Live servers with their per-hour / per-month cost (for the Billing page).
export async function listServersWithCost() {
  if (isDemo()) {
    const servers = [{ name: "hetzner-cx23", type: "cx23", location: "fsn1", status: "running", ip: "10.0.0.1", cores: 2, memory: 4, hourly: 0.0104, monthly: 6.49 }];
    return { servers, totalHourly: 0.0104, totalMonthly: 6.49 };
  }
  const data = await hz("/servers");
  const servers = (data.servers || []).map((s) => {
    const loc = s.datacenter?.location?.name;
    const price = (s.server_type?.prices || []).find((p) => p.location === loc) || s.server_type?.prices?.[0];
    return {
      name: s.name, type: s.server_type?.name, location: loc, status: s.status,
      ip: s.public_net?.ipv4?.ip, cores: s.server_type?.cores, memory: s.server_type?.memory,
      hourly: Number(price?.price_hourly?.gross || 0),
      monthly: Number(price?.price_monthly?.gross || 0),
    };
  });
  return {
    servers,
    totalHourly: +servers.reduce((a, s) => a + s.hourly, 0).toFixed(4),
    totalMonthly: +servers.reduce((a, s) => a + s.monthly, 0).toFixed(2),
  };
}

export async function listLocations() {
  if (isDemo()) {
    return [
      { name: "nbg1", city: "Nuremberg", country: "DE" },
      { name: "fsn1", city: "Falkenstein", country: "DE" },
      { name: "hel1", city: "Helsinki", country: "FI" },
      { name: "ash", city: "Ashburn", country: "US" },
    ];
  }
  // VERIFY LIVE
  const data = await hz("/locations");
  return data.locations.map(({ name, city, country }) => ({ name, city, country }));
}

export async function createServer({ name, serverType, location, image = "ubuntu-24.04", sshKeys = [], userData } = {}) {
  if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
  if (!serverType) throw Object.assign(new Error("serverType is required"), { status: 400 });

  if (isDemo()) {
    return { id: 1001, ip: "10.0.0.1", status: "running" };
  }
  // VERIFY LIVE — creating a server costs real money
  const data = await hz("/servers", {
    method: "POST",
    body: { name, server_type: serverType, location, image, ssh_keys: sshKeys, ...(userData ? { user_data: userData } : {}) },
  });
  return {
    id: data.server.id,
    ip: data.server.public_net?.ipv4?.ip,
    status: data.server.status,
  };
}

export async function getServer(id) {
  if (!id) throw Object.assign(new Error("id is required"), { status: 400 });

  if (isDemo()) {
    return { id, ip: "10.0.0.1", status: "running" };
  }
  // VERIFY LIVE
  const data = await hz(`/servers/${id}`);
  return {
    id: data.server.id,
    ip: data.server.public_net?.ipv4?.ip,
    status: data.server.status,
  };
}

export async function deleteServer(id) {
  if (!id) throw Object.assign(new Error("id is required"), { status: 400 });

  if (isDemo()) {
    return { ok: true };
  }
  // VERIFY LIVE — this destroys the server
  await hz(`/servers/${id}`, { method: "DELETE" });
  return { ok: true };
}

export async function listSshKeys() {
  if (isDemo()) {
    return [{ id: 1, name: "demo-key", fingerprint: "aa:bb:cc", public_key: "ssh-ed25519 DEMOKEY" }];
  }
  const data = await hz("/ssh_keys"); // live-verified shape: { ssh_keys: [{id,name,fingerprint,public_key}] }
  return (data.ssh_keys || []).map(({ id, name, fingerprint, public_key }) => ({ id, name, fingerprint, public_key }));
}

// Idempotent: returns the existing Hetzner key matching `publicKey`, else creates
// it. Used so a Coolify private key's public half is present on provisioned boxes.
export async function ensureSshKey({ name, publicKey } = {}) {
  if (!publicKey) throw Object.assign(new Error("publicKey is required"), { status: 400 });
  if (isDemo()) return { id: 1, name: name || "demo-key" };
  // Compare on the type+base64 body, ignoring the trailing comment.
  const body = (s) => (s || "").trim().split(/\s+/).slice(0, 2).join(" ");
  const keys = await listSshKeys();
  const match = keys.find((k) => body(k.public_key) === body(publicKey));
  if (match) return { id: match.id, name: match.name };
  // Hetzner key names must be unique; suffix on collision.
  let finalName = name || "key";
  if (keys.some((k) => k.name === finalName)) finalName = `${finalName}-${Date.now().toString(36)}`;
  const data = await hz("/ssh_keys", { method: "POST", body: { name: finalName, public_key: publicKey } });
  return { id: data.ssh_key.id, name: data.ssh_key.name };
}
