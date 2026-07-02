// Render → DebutDeploy import orchestrator.
// Returns a structured report; never throws — callers get ok:false on failure.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getService, getEnvVars, getConnectionInfo } from "./render.js";
import { provisionServer } from "./provision.js";
import { createDeployKeyApp, ensureAccountKey, toSshUrl } from "./deploykey.js";
import {
  getDefaultDestination,
  resolveDbUrl,
  upsertEnv,
  deployService,
} from "./coolify.js";
import { assign } from "./ownership.js";

const execFileP = promisify(execFile);

// Reject anything that isn't a postgres:// URL before it reaches a spawn argv,
// so a value like "--foo" can't smuggle flags into pg_dump (argument injection).
export function assertPgUrl(url) {
  if (typeof url !== "string" || !/^postgres(ql)?:\/\//i.test(url)) {
    throw Object.assign(new Error("Invalid Postgres connection URL"), { status: 400 });
  }
  return url;
}

// Real Postgres migration: dump the Render source and load it into the chosen
// Coolify target using a pinned postgres:18 container (version-matches Render's
// PG18, so no host pg tooling is needed). BOTH URLs are validated by assertPgUrl
// and passed via ENV — never argv — so a value can't smuggle flags into the
// command. Requires the Docker socket reachable by this process. Overridable via
// deps for tests. // VERIFY LIVE: network name + Coolify DB URL field.
async function migratePostgres({ source, target, _exec = execFileP }) {
  if (process.env.DEMO_MODE === "true") return { ok: true, note: "demo-skip" };
  assertPgUrl(source);
  assertPgUrl(target);
  const net = process.env.PG_MIGRATE_DOCKER_NETWORK || "coolify";
  try {
    await _exec(
      "docker",
      ["run", "--rm", "--network", net, "-e", "SRC", "-e", "TGT", "postgres:18",
       "sh", "-c", 'pg_dump --no-owner --no-privileges "$SRC" | psql -v ON_ERROR_STOP=1 "$TGT"'],
      { env: { ...process.env, SRC: source, TGT: target }, maxBuffer: 64 * 1024 * 1024 }
    );
    return { ok: true };
  } catch (err) {
    const missing = /ENOENT|not found|Cannot connect to the Docker daemon/i.test(`${err.message}${err.stderr || ""}`);
    const hint = missing
      ? " — Docker CLI/socket not available to the server; mount /var/run/docker.sock and ensure docker is in the container"
      : "";
    throw Object.assign(new Error(`Postgres migration failed${hint}: ${String(err.stderr || err.message).slice(-400)}`), { status: 500 });
  }
}

export async function importFromRender({ renderServiceId, target, userId, apiKey, deps = {} }) {
  // ponytail: merge defaults with optional injected overrides for testability
  const d = {
    getService,
    getEnvVars,
    getConnectionInfo,
    provisionServer,
    ensureAccountKey,
    toSshUrl,
    createDeployKeyApp,
    getDefaultDestination,
    resolveDbUrl,
    upsertEnv,
    deployService,
    assign,
    migratePostgres,
    ...deps,
  };

  const steps = [];

  // Step 1 — read Render service + env vars
  let service, envVars;
  try {
    [service, envVars] = await Promise.all([
      d.getService(renderServiceId, apiKey),
      d.getEnvVars(renderServiceId, apiKey),
    ]);
    steps.push({ step: "read-render", status: "ok", detail: { name: service.name } });
  } catch (err) {
    steps.push({ step: "read-render", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  // Step 2 — resolve server
  let serverUuid;
  try {
    if (target.mode === "shared") {
      serverUuid = process.env.COOLIFY_SERVER_UUID || "demo-server-uuid";
    } else {
      const result = await d.provisionServer({ name: service.name, serverType: target.serverType, location: target.location });
      serverUuid = result.serverUuid;
    }
    steps.push({ step: "resolve-server", status: "ok", detail: { serverUuid } });
  } catch (err) {
    steps.push({ step: "resolve-server", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  // Step 3 — resolve the shared account deploy key. Its public half lives on the
  // operator's GitHub account, so Coolify can clone any of their repos (no
  // per-repo deploy key, and no dependency on Coolify's absent /sources API).
  let keyUuid;
  try {
    ({ uuid: keyUuid } = await d.ensureAccountKey());
    steps.push({ step: "resolve-key", status: "ok", detail: null });
  } catch (err) {
    steps.push({ step: "resolve-key", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  // Step 4 — create the Coolify app via the deploy-key path. Dedicated mode
  // targets the freshly provisioned server; shared uses the default host.
  let appUuid;
  try {
    const dedicated = target.mode === "dedicated";
    const { uuid } = await d.createDeployKeyApp({
      keyUuid,
      repo: d.toSshUrl(service.repo),
      branch: service.branch,
      name: service.name,
      port: "3000",
      buildCommand: service.buildCommand,
      startCommand: service.startCommand,
      ...(dedicated ? { serverUuid, destinationUuid: await d.getDefaultDestination(serverUuid) } : {}),
    });
    appUuid = uuid;
    steps.push({ step: "create-app", status: "ok", detail: { appUuid } });
  } catch (err) {
    steps.push({ step: "create-app", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }


  // Step 5 — migrate database (optional). dbTarget.source = the Render Postgres to
  // migrate FROM; dbTarget.uuid = the Coolify Postgres to migrate INTO.
  const dbTarget = target.dbTarget || { mode: "none" };
  const sourceDatastoreId = dbTarget.source || service.datastoreId || target.datastoreId;
  if (sourceDatastoreId && dbTarget.mode === "existing") {
    try {
      const source = await d.getConnectionInfo(sourceDatastoreId, apiKey);
      let targetUrl;
      if (dbTarget.mode === "existing") {
        targetUrl = await d.resolveDbUrl(dbTarget.uuid);
      } else {
        throw Object.assign(new Error(`Unsupported dbTarget mode "${dbTarget.mode}" — pick an existing Coolify database`), { status: 400 });
      }
      if (!targetUrl) throw Object.assign(new Error("Could not resolve the target database connection URL"), { status: 404 });
      await d.migratePostgres({ source, target: targetUrl });
      // Wire the migrated app at the COOLIFY target — never the Render source.
      await d.upsertEnv(appUuid, { key: "DATABASE_URL", value: targetUrl, is_secret: true });
      steps.push({ step: "migrate-db", status: "ok", detail: null });
    } catch (err) {
      steps.push({ step: "migrate-db", status: "error", detail: err.message });
      return { ok: false, appUuid: null, steps };
    }
  } else {
    steps.push({ step: "migrate-db", status: "skipped", detail: null });
  }

  // Step 6 — push env vars
  try {
    for (const { key, value } of envVars) {
      // ponytail: never log key or value — security boundary
      // Default-secret: Render's API doesn't reliably flag secrets, and its env
      // vars routinely hold API keys / DATABASE_URL / tokens. Safe default.
      await d.upsertEnv(appUuid, { key, value, is_secret: true });
    }
    steps.push({ step: "push-env", status: "ok", detail: { count: envVars.length } });
  } catch (err) {
    steps.push({ step: "push-env", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  // Step 7 — deploy
  try {
    await d.deployService(appUuid);
    steps.push({ step: "deploy", status: "ok", detail: null });
  } catch (err) {
    steps.push({ step: "deploy", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  // Step 8 — assign ownership LAST, only on full success
  try {
    d.assign(appUuid, "application", userId);
    steps.push({ step: "assign-ownership", status: "ok", detail: null });
  } catch (err) {
    steps.push({ step: "assign-ownership", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  return { ok: true, appUuid, url: "https://" + service.name + ".demo", steps };
}
