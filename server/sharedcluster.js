// Shared Postgres cluster: ONE Coolify Postgres hosting a logical database per
// project (cost-efficient multi-tenant). We control the superuser creds — Coolify's
// create response returns internal_db_url WITH the password (verified live) — so
// each project's connection URL is credential-safe. CREATE DATABASE/ROLE runs in a
// pinned postgres:18 container on the Coolify network (needs the Docker socket, the
// same prereq as the pg_dump data copy).
import { randomBytes } from "node:crypto";
import * as coolify from "./coolify.js";
import { getSetting, setSetting } from "./db.js";
import { encryptSecret, decryptSecret } from "./secretbox.js";
import { dockerPg, runOnHost } from "./hostexec.js";

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
  await waitForPg(url); // the container starts async — wait until it accepts connections
  setSetting("shared_cluster_url", encryptSecret(url));
  return url;
}

// A brand-new DEDICATED Postgres instance (its own container) for a project —
// used when the deployment target is Dedicated. Credential-safe (create returns
// the URL) and waited-until-ready so the pg_dump restore can connect.
export async function provisionDedicatedDatabase(name, { _provision = coolify.provisionDatabase } = {}) {
  if (DEMO) return { url: `postgresql://ded:demo@demo-dedicated:5432/postgres` };
  const { uuid, url } = await _provision({ name: pgIdent(name) + "-db" });
  await waitForPg(url);
  return { uuid, url };
}

// Poll a freshly-provisioned cluster until Postgres accepts connections (~2 min max).
async function waitForPg(url) {
  if (DEMO) return;
  const host = new URL(url).hostname;
  const net = process.env.PG_MIGRATE_DOCKER_NETWORK || "coolify";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 24; i++) {
    try {
      await runOnHost(`docker run --rm --network ${net} postgres:18 pg_isready -h ${host} -p 5432 -t 5`);
      return;
    } catch { await sleep(5000); }
  }
  throw Object.assign(new Error("shared cluster did not become ready in time"), { status: 504 });
}

// Run SQL against the cluster in a pinned postgres:18 container on the host. URL +
// SQL pass base64-encoded (safe to interpolate; decoded inside the container).
async function runSql(clusterUrl, sql) {
  await dockerPg({ vars: { URL: clusterUrl, SQL: sql }, script: 'psql -v ON_ERROR_STOP=1 "$URL" -c "$SQL"' });
}

// Create a fresh logical database + login role on the shared cluster for a project,
// returning a credential-safe connection URL scoped to that project's own database.
export async function createProjectDatabase(name, { _cluster = ensureSharedCluster } = {}) {
  const db = pgIdent(name);
  const role = `${db}_u`.slice(0, 40);
  const pw = randomBytes(18).toString("base64url"); // base64url → no quotes/backslashes, safe in the SQL literal
  if (DEMO) return { db, role, url: `postgresql://${role}:${pw}@demo-shared:5432/${db}` };
  const clusterUrl = await _cluster();
  // CREATE DATABASE can't share a transaction with the rest — run it on its own.
  await runSql(clusterUrl, `CREATE DATABASE "${db}"`);
  await runSql(clusterUrl, `CREATE ROLE "${role}" WITH LOGIN PASSWORD '${pw}'; GRANT ALL PRIVILEGES ON DATABASE "${db}" TO "${role}"; ALTER ROLE "${role}" CONNECTION LIMIT 20`);
  const u = new URL(clusterUrl);
  u.username = role; u.password = pw; u.pathname = `/${db}`;
  return { db, role, url: u.toString() };
}
