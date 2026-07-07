// Reveal a database's connection credentials on demand. Coolify's REST API masks
// an existing DB's password, so we read the running container's plaintext env
// (POSTGRES_PASSWORD etc.) via `docker inspect` over the SSH-to-host channel. Pure
// parsing (parseInspect) is split from the host call so it's unit-testable.
import { runOnHost } from "./hostexec.js";

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

// Per-engine: URL scheme, default port, and the env var names the image uses.
const ENGINES = {
  postgres: { scheme: "postgresql", port: 5432, user: "POSTGRES_USER", pass: "POSTGRES_PASSWORD", db: "POSTGRES_DB", defUser: "postgres" },
  redis:    { scheme: "redis",      port: 6379, pass: "REDIS_PASSWORD", defUser: "default" },
  mysql:    { scheme: "mysql",      port: 3306, user: "MYSQL_USER", pass: "MYSQL_PASSWORD", db: "MYSQL_DATABASE", defUser: "root" },
  mariadb:  { scheme: "mysql",      port: 3306, user: "MARIADB_USER", pass: "MARIADB_PASSWORD", db: "MARIADB_DATABASE", defUser: "root" },
  mongo:    { scheme: "mongodb",    port: 27017, user: "MONGO_INITDB_ROOT_USERNAME", pass: "MONGO_INITDB_ROOT_PASSWORD", db: "MONGO_INITDB_DATABASE", defUser: "root" },
};

function engineFromImage(image = "") {
  const i = String(image).toLowerCase();
  if (i.includes("postgres")) return "postgres";
  if (i.includes("redis") || i.includes("valkey") || i.includes("keydb") || i.includes("dragonfly")) return "redis";
  if (i.includes("mariadb")) return "mariadb";
  if (i.includes("mysql")) return "mysql";
  if (i.includes("mongo")) return "mongo";
  return null;
}

const NOT_FOUND = () => Object.assign(new Error("database container not found on the managed host (is it running?)"), { status: 404 });

export function parseInspect(inspect, { uuid, publicHost }) {
  const c = Array.isArray(inspect) ? inspect[0] : inspect;
  if (!c) throw NOT_FOUND();
  const engine = engineFromImage(c.Config?.Image);
  const spec = engine && ENGINES[engine];
  const env = Object.fromEntries((c.Config?.Env || []).map((e) => { const i = e.indexOf("="); return [e.slice(0, i), e.slice(i + 1)]; }));

  const username = spec ? (spec.user ? (env[spec.user] || spec.defUser) : spec.defUser) : null;
  const password = spec ? (env[spec.pass] ?? null) : null;
  const database = spec?.db ? (env[spec.db] || username) : null;
  const internalPort = spec?.port || null;

  let externalPort = null;
  const bindings = c.HostConfig?.PortBindings || c.NetworkSettings?.Ports || {};
  const b = internalPort ? bindings[`${internalPort}/tcp`] : null;
  if (Array.isArray(b) && b[0]?.HostPort) externalPort = Number(b[0].HostPort);

  const enc = (s) => encodeURIComponent(String(s ?? ""));
  const scheme = spec?.scheme || "db";
  const auth = username ? `${enc(username)}:${enc(password)}@` : (password ? `:${enc(password)}@` : "");
  const path = database ? `/${encodeURIComponent(database)}` : "";
  const internalUrl = spec ? `${scheme}://${auth}${uuid}:${internalPort}${path}` : null;
  const externalUrl = (spec && externalPort && publicHost) ? `${scheme}://${auth}${publicHost}:${externalPort}${path}` : null;

  return {
    engine: engine || "unknown",
    username, password, database,
    internalHost: uuid, internalPort,
    externalHost: externalPort ? publicHost : null, externalPort,
    internalUrl, externalUrl,
  };
}

export async function getDatabaseCredentials(uuid, { run = runOnHost } = {}) {
  const u = String(uuid).replace(/[^a-z0-9]/gi, "");
  if (!u) throw Object.assign(new Error("database uuid required"), { status: 400 });
  if (DEMO) {
    return { engine: "postgres", username: "demo", password: "demo-pass", database: "demo",
      internalHost: u, internalPort: 5432, externalHost: null, externalPort: null,
      internalUrl: `postgresql://demo:demo-pass@${u}:5432/demo`, externalUrl: null };
  }
  const raw = await run(`CID=$(docker ps -q --filter name=${u} | head -1); [ -n "$CID" ] && docker inspect "$CID" || echo '[]'`);
  let inspect;
  try { inspect = JSON.parse(String(raw).trim() || "[]"); } catch { inspect = []; }
  if (!Array.isArray(inspect) || !inspect.length) throw NOT_FOUND();
  return parseInspect(inspect, { uuid: u, publicHost: process.env.MIGRATION_SSH_HOST || null });
}
