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

export async function createServer({ name, serverType, location, image = "ubuntu-24.04", sshKeys = [] } = {}) {
  if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
  if (!serverType) throw Object.assign(new Error("serverType is required"), { status: 400 });

  if (isDemo()) {
    return { id: 1001, ip: "10.0.0.1", status: "running" };
  }
  // VERIFY LIVE — creating a server costs real money
  const data = await hz("/servers", {
    method: "POST",
    body: { name, server_type: serverType, location, image, ssh_keys: sshKeys },
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
