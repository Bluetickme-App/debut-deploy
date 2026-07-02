// Render → DebutDeploy import orchestrator.
// Returns a structured report; never throws — callers get ok:false on failure.

import { dockerPg } from "./hostexec.js";
import { getService, getEnvVars, getConnectionInfo } from "./render.js";
import { provisionServer } from "./provision.js";
import { createDeployKeyApp, ensureAccountKey, toSshUrl } from "./deploykey.js";
import {
  getDefaultDestination,
  resolveDbUrl,
  upsertEnv,
  deployService,
  patchApp,
} from "./coolify.js";
import { fetchBlueprint, applyBlueprint, ownerRepo } from "./renderyaml.js";
import { createProjectDatabase, provisionDedicatedDatabase } from "./sharedcluster.js";
import { assign } from "./ownership.js";

// Reject anything that isn't a postgres:// URL before it reaches a spawn argv,
// so a value like "--foo" can't smuggle flags into pg_dump (argument injection).
// Surface Coolify/Render validation bodies (err.detail) so a 4xx step says WHY it
// failed, not just the bare status — e.g. "git_branch field is required" vs "→ 422".
const errDetail = (err) => (err.detail ? `${err.message} — ${String(err.detail).slice(0, 400)}` : err.message);

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
async function migratePostgres({ source, target }) {
  if (process.env.DEMO_MODE === "true") return { ok: true, note: "demo-skip" };
  assertPgUrl(source);
  assertPgUrl(target);
  // pg_dump the Render source and load into the Coolify target, run on the host in
  // a pinned postgres:18 container (version-matches Render PG18). URLs pass base64.
  await dockerPg({ vars: { SRC: source, TGT: target }, script: 'pg_dump --no-owner --no-privileges "$SRC" | psql -v ON_ERROR_STOP=1 "$TGT"' });
  return { ok: true };
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
    createProjectDatabase,
    provisionDedicatedDatabase,
    upsertEnv,
    deployService,
    assign,
    migratePostgres,
    patchApp,
    fetchBlueprint,
    applyBlueprint,
    ownerRepo,
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
    steps.push({ step: "read-render", status: "error", detail: errDetail(err) });
    return { ok: false, appUuid: null, steps };
  }

  // Port the app listens on: Render injects PORT (default 10000) and apps read it,
  // so the migrated app must expose that same port or Traefik 502s. Use the user's
  // PORT env if set, else Render's default.
  const portEnv = envVars.find((e) => (e.key || "").toUpperCase() === "PORT")?.value;
  const port = portEnv && /^\d+$/.test(portEnv) ? portEnv : "10000";

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
    steps.push({ step: "resolve-server", status: "error", detail: errDetail(err) });
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
    steps.push({ step: "resolve-key", status: "error", detail: errDetail(err) });
    return { ok: false, appUuid: null, steps };
  }

  // Step 4 — create the Coolify app via the deploy-key path. Dedicated mode
  // targets the freshly provisioned server; shared uses the default host.
  let appUuid;
  try {
    // Render normalises a missing repo/branch to "" (not undefined), which defeats
    // createDeployKeyApp's default params — an empty git_branch 422s at Coolify.
    if (!service.repo) throw Object.assign(new Error("Render service has no git repository to migrate (image-based services aren't supported)"), { status: 422 });
    const dedicated = target.mode === "dedicated";
    const { uuid } = await d.createDeployKeyApp({
      keyUuid,
      repo: d.toSshUrl(service.repo),
      branch: service.branch || "main",
      name: service.name,
      port,
      buildCommand: service.buildCommand,
      startCommand: service.startCommand,
      ...(dedicated ? { serverUuid, destinationUuid: await d.getDefaultDestination(serverUuid) } : {}),
    });
    appUuid = uuid;
    steps.push({ step: "create-app", status: "ok", detail: { appUuid } });
  } catch (err) {
    steps.push({ step: "create-app", status: "error", detail: errDetail(err) });
    return { ok: false, appUuid: null, steps };
  }

  // Step 4b — apply the repo's Render blueprint (render.yaml) if present. It carries
  // what the Render API doesn't fully expose — health-check path, root dir, and the
  // exact build/start + env defaults — so Nixpacks builds the app the way Render did.
  // Best-effort: a missing/broken blueprint never fails the migration.
  try {
    const or = d.ownerRepo(service.repo);
    const svc = or ? await d.fetchBlueprint({ owner: or.owner, repo: or.repo, ref: service.branch || "main" }) : null;
    if (svc) {
      const summary = await d.applyBlueprint(appUuid, svc, { patchApp: d.patchApp, upsertEnv: d.upsertEnv });
      steps.push({ step: "blueprint", status: "ok", detail: summary });
    } else {
      steps.push({ step: "blueprint", status: "skipped", detail: null });
    }
  } catch (err) {
    steps.push({ step: "blueprint", status: "skipped", detail: errDetail(err) });
  }


  // Step 5 — migrate database (optional). dbTarget.source = the Render Postgres to
  // migrate FROM; dbTarget.uuid = the Coolify Postgres to migrate INTO.
  const dbTarget = target.dbTarget || { mode: "none" };
  const sourceDatastoreId = dbTarget.source || service.datastoreId || target.datastoreId;
  if (sourceDatastoreId && ["shared", "dedicated", "existing"].includes(dbTarget.mode)) {
    try {
      const source = await d.getConnectionInfo(sourceDatastoreId, apiKey);
      let targetUrl;
      if (dbTarget.mode === "shared") {
        // Fresh, credential-safe logical DB on the shared cluster (never overwrites
        // an existing DB, and we control its creds).
        ({ url: targetUrl } = await d.createProjectDatabase(service.name));
      } else if (dbTarget.mode === "dedicated") {
        // A brand-new dedicated Postgres instance (its own container).
        ({ url: targetUrl } = await d.provisionDedicatedDatabase(service.name));
      } else {
        targetUrl = await d.resolveDbUrl(dbTarget.uuid);
      }
      if (!targetUrl) throw Object.assign(new Error("Could not resolve the target database connection URL"), { status: 404 });
      await d.migratePostgres({ source, target: targetUrl });
      // Wire the migrated app at the COOLIFY target — never the Render source.
      await d.upsertEnv(appUuid, { key: "DATABASE_URL", value: targetUrl, is_secret: true });
      steps.push({ step: "migrate-db", status: "ok", detail: null });
    } catch (err) {
      steps.push({ step: "migrate-db", status: "error", detail: errDetail(err) });
      return { ok: false, appUuid: null, steps };
    }
  } else {
    steps.push({ step: "migrate-db", status: "skipped", detail: null });
  }

  // Step 6 — push env vars
  try {
    // Carry the listen port so the app binds where Traefik routes (avoids 502).
    if (!envVars.some((e) => (e.key || "").toUpperCase() === "PORT")) {
      await d.upsertEnv(appUuid, { key: "PORT", value: port });
    }
    for (const { key, value } of envVars) {
      // ponytail: never log key or value — security boundary
      // Default-secret: Render's API doesn't reliably flag secrets, and its env
      // vars routinely hold API keys / DATABASE_URL / tokens. Safe default.
      await d.upsertEnv(appUuid, { key, value, is_secret: true });
    }
    steps.push({ step: "push-env", status: "ok", detail: { count: envVars.length } });
  } catch (err) {
    steps.push({ step: "push-env", status: "error", detail: errDetail(err) });
    return { ok: false, appUuid: null, steps };
  }

  // Step 7 — deploy
  try {
    await d.deployService(appUuid);
    steps.push({ step: "deploy", status: "ok", detail: null });
  } catch (err) {
    steps.push({ step: "deploy", status: "error", detail: errDetail(err) });
    return { ok: false, appUuid: null, steps };
  }

  // Step 8 — assign ownership LAST, only on full success
  try {
    d.assign(appUuid, "application", userId);
    steps.push({ step: "assign-ownership", status: "ok", detail: null });
  } catch (err) {
    steps.push({ step: "assign-ownership", status: "error", detail: errDetail(err) });
    return { ok: false, appUuid: null, steps };
  }

  return { ok: true, appUuid, url: "https://" + service.name + ".demo", steps };
}
