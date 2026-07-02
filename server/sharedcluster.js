// Shared Postgres cluster: ONE Coolify Postgres hosting a logical database per
// project (cost-efficient multi-tenant). We control the superuser creds — Coolify's
// create response returns internal_db_url WITH the password (verified live) — so
// each project's connection URL is credential-safe. CREATE DATABASE/ROLE runs in a
// pinned postgres:18 container on the Coolify network (needs the Docker socket, the
// same prereq as the pg_dump data copy).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import * as coolify from "./coolify.js";
import { getSetting, setSetting } from "./db.js";
import { encryptSecret, decryptSecret } from "./secretbox.js";

const execFileP = promisify(execFile);
const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

// Sanitise any name into a safe lowercase pg identifier (must start with a letter).
// Prevents SQL-identifier injection — only [a-z0-9_] survive.
export function pgIdent(name) {
  let s = String(name || "proj").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!/^[a-z]/.test(s)) s = "p_" + s;
  return s || "proj";
}

// The one shared cluster's superuser URL — provisioned once on first use, then
// stored encrypted and reused.
export async function ensureSharedCluster({ _provision = coolify.provisionDatabase } = {}) {
  if (DEMO) return "postgresql://dd_super:demo@demo-shared:5432/postgres";
  const stored = getSetting("shared_cluster_url");
  if (stored) return decryptSecret(stored);
  const { url } = await _provision({ name: "debutdeploy-shared-db" });
  setSetting("shared_cluster_url", encryptSecret(url));
  return url;
}

// Run SQL against the cluster in a pinned postgres:18 container. The URL + SQL pass
// via ENV, never argv. Requires the Docker socket; throws an actionable error if not.
async function runSql(clusterUrl, sql, _exec = execFileP) {
  const net = process.env.PG_MIGRATE_DOCKER_NETWORK || "coolify";
  try {
    await _exec(
      "docker",
      ["run", "--rm", "--network", net, "-e", "URL", "-e", "SQL", "postgres:18", "sh", "-c", 'psql -v ON_ERROR_STOP=1 "$URL" -c "$SQL"'],
      { env: { ...process.env, URL: clusterUrl, SQL: sql } }
    );
  } catch (err) {
    const missing = /ENOENT|not found|Cannot connect to the Docker daemon/i.test(`${err.message}${err.stderr || ""}`);
    throw Object.assign(new Error(`Shared-cluster SQL failed${missing ? " — Docker CLI/socket not available; mount /var/run/docker.sock" : ""}: ${String(err.stderr || err.message).slice(-300)}`), { status: 500 });
  }
}

// Create a fresh logical database + login role on the shared cluster for a project,
// returning a credential-safe connection URL scoped to that project's own database.
export async function createProjectDatabase(name, { _cluster = ensureSharedCluster, _exec } = {}) {
  const db = pgIdent(name);
  const role = `${db}_u`.slice(0, 40);
  const pw = randomBytes(18).toString("base64url"); // base64url → no quotes/backslashes, safe in the SQL literal
  if (DEMO) return { db, role, url: `postgresql://${role}:${pw}@demo-shared:5432/${db}` };
  const clusterUrl = await _cluster();
  // CREATE DATABASE can't share a transaction with the rest — run it on its own.
  await runSql(clusterUrl, `CREATE DATABASE "${db}"`, _exec);
  await runSql(clusterUrl, `CREATE ROLE "${role}" WITH LOGIN PASSWORD '${pw}'; GRANT ALL PRIVILEGES ON DATABASE "${db}" TO "${role}"; ALTER ROLE "${role}" CONNECTION LIMIT 20`, _exec);
  const u = new URL(clusterUrl);
  u.username = role; u.password = pw; u.pathname = `/${db}`;
  return { db, role, url: u.toString() };
}
