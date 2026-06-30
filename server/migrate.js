// Render → DebutDeploy import orchestrator.
// Returns a structured report; never throws — callers get ok:false on failure.

import { getService, getEnvVars, getConnectionInfo } from "./render.js";
import { provisionServer } from "./provision.js";
import { ensureCoolifySourceForInstallation } from "./coolify-github.js";
import { findUserInstallationByLogin } from "./db.js";
import {
  createProject,
  getDefaultDestination,
  createPrivateGithubApp,
  upsertEnv,
  deployService,
} from "./coolify.js";
import { assign } from "./ownership.js";

// Reject anything that isn't a postgres:// URL before it reaches a spawn argv,
// so a value like "--foo" can't smuggle flags into pg_dump (argument injection).
export function assertPgUrl(url) {
  if (typeof url !== "string" || !/^postgres(ql)?:\/\//i.test(url)) {
    throw Object.assign(new Error("Invalid Postgres connection URL"), { status: 400 });
  }
  return url;
}

// ponytail: local helper — overridable via deps for tests
async function migratePostgres({ renderConn }) {
  if (process.env.DEMO_MODE === "true") return { ok: true, note: "demo-skip" };
  // Validate the source URL (also keeps assertPgUrl's argument-injection guard live).
  assertPgUrl(renderConn);
  // The previous live path restored to a hardcoded postgres://localhost/target and
  // then wrote the SOURCE renderConn back as DATABASE_URL — i.e. it would wire the
  // new app to Render's DB and restore nowhere useful. Fail loud rather than corrupt.
  // TODO live: provision a Coolify Postgres → `pg_dump <source> | pg_restore` into it →
  //   set DATABASE_URL to the COOLIFY db's connection string (never the Render source).
  throw Object.assign(
    new Error("Live Postgres migration not yet implemented: needs a Coolify-provisioned target DB + restore wiring"),
    { status: 501 }
  );
}

export async function importFromRender({ renderServiceId, target, userId, apiKey, deps = {} }) {
  // ponytail: merge defaults with optional injected overrides for testability
  const d = {
    getService,
    getEnvVars,
    getConnectionInfo,
    provisionServer,
    ensureCoolifySourceForInstallation,
    findUserInstallationByLogin,
    createProject,
    getDefaultDestination,
    createPrivateGithubApp,
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

  // Step 3 — resolve GitHub installation + Coolify source
  let github_app_uuid;
  try {
    // Parse owner from repo URL: https://github.com/OWNER/repo
    const repoUrl = service.repo || "";
    const repoPath = repoUrl.replace(/^https?:\/\/github\.com\//, "");
    const owner = repoPath.split("/")[0];
    // owner is a login STRING parsed from the repo URL — key the lookup by
    // account_login (case-insensitive), not the numeric account_id.
    const row = await d.findUserInstallationByLogin(userId, owner);
    const installation_id = row?.installation_id;
    if (!installation_id) {
      throw Object.assign(new Error(`No GitHub installation found for account "${owner}"`), { status: 404 });
    }
    ({ github_app_uuid } = await d.ensureCoolifySourceForInstallation(installation_id));
    steps.push({ step: "resolve-github", status: "ok", detail: { owner } });
  } catch (err) {
    steps.push({ step: "resolve-github", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  // Step 4 — create Coolify project + app
  let appUuid;
  try {
    const { uuid: projectUuid } = await d.createProject(service.name);
    const destinationUuid = await d.getDefaultDestination(serverUuid);
    const repoPath = (service.repo || "").replace(/^https?:\/\/github\.com\//, "");
    const { uuid } = await d.createPrivateGithubApp({
      githubAppUuid: github_app_uuid,
      projectUuid,
      environmentName: "production",
      serverUuid,
      destinationUuid,
      gitRepository: repoPath,
      gitBranch: service.branch,
      portsExposes: "3000",
      name: service.name,
      buildCommand: service.buildCommand,
      startCommand: service.startCommand,
    });
    appUuid = uuid;
    steps.push({ step: "create-app", status: "ok", detail: { appUuid } });
  } catch (err) {
    steps.push({ step: "create-app", status: "error", detail: err.message });
    return { ok: false, appUuid: null, steps };
  }

  // Step 5 — migrate database (optional)
  const datastoreId = service.datastoreId || target.datastoreId;
  if (datastoreId) {
    try {
      const renderConn = await d.getConnectionInfo(datastoreId, apiKey);
      await d.migratePostgres({ renderConn, appUuid, _upsertEnv: d.upsertEnv });
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
