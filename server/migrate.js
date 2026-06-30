// Render → DebutDeploy import orchestrator.
// Returns a structured report; never throws — callers get ok:false on failure.

import { getService, getEnvVars, getConnectionInfo } from "./render.js";
import { provisionServer } from "./provision.js";
import { ensureCoolifySourceForInstallation } from "./coolify-github.js";
import { findUserInstallationByAccount } from "./db.js";
import {
  createProject,
  getDefaultDestination,
  createPrivateGithubApp,
  upsertEnv,
  deployService,
} from "./coolify.js";
import { assign } from "./ownership.js";
import { spawn } from "node:child_process";

// ponytail: local helper — overridable via deps for tests
async function migratePostgres({ renderConn, appUuid, _upsertEnv }) {
  if (process.env.DEMO_MODE === "true") return { ok: true, note: "demo-skip" };
  // VERIFY LIVE: pg_dump | pg_restore; never persist dump to disk long-term
  const connUrl = await new Promise((resolve, reject) => {
    const dump = spawn("pg_dump", ["--no-owner", renderConn], { stdio: ["ignore", "pipe", "inherit"] });
    const restore = spawn("pg_restore", ["--no-owner", "--clean", "-d", "postgres://localhost/target"], {
      stdio: [dump.stdout, "inherit", "inherit"],
    });
    restore.on("close", (code) => (code === 0 ? resolve(renderConn) : reject(new Error(`pg_restore exited ${code}`))));
    dump.on("error", reject);
    restore.on("error", reject);
  });
  await _upsertEnv(appUuid, { key: "DATABASE_URL", value: connUrl, is_secret: true });
  return { ok: true };
}

export async function importFromRender({ renderServiceId, target, userId, apiKey, deps = {} }) {
  // ponytail: merge defaults with optional injected overrides for testability
  const d = {
    getService,
    getEnvVars,
    getConnectionInfo,
    provisionServer,
    ensureCoolifySourceForInstallation,
    findUserInstallationByAccount,
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
    // VERIFY LIVE: findUserInstallationByAccount keys on account_id (numeric) but we only
    // have the account_login from the URL; this works when account_id === login or when
    // the caller stored account_id as the login string. Gap: may need a login→id lookup.
    const row = await d.findUserInstallationByAccount(userId, owner);
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
      await d.upsertEnv(appUuid, { key, value, is_secret: false });
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
