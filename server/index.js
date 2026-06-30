import "dotenv/config";
import { randomBytes } from "node:crypto";
import express from "express";
import cors from "cors";
import * as coolify from "./coolify.js";
import * as githubApp from "./github-app.js";
import * as databases from "./databases.js";
import * as lifecycle from "./lifecycle.js";
import { setupAuth } from "./auth.js";
import { assertOwns, assign, ownedUuids } from "./ownership.js";
import {
  listUsers,
  setInstallation,
  getInstallation,
  deleteInstallation,
  setCustomerProject,
  getCustomerProject,
  getIdentityByUser,
  createOauthState,
  consumeOauthState,
  createApiToken,
  getUserByApiToken,
  listApiTokens,
  deleteApiToken,
  addUserInstallation,
  listUserInstallations,
} from "./db.js";
import { record } from "./audit.js";
import * as dns from "./dns.js";
import * as resources from "./resources.js";
import * as volumes from "./volumes.js";
import * as sharedvars from "./sharedvars.js";
import * as backups from "./backups.js";
import * as hetzner from "./hetzner.js";
import { provisionServer } from "./provision.js";
import { importFromRender } from "./migrate.js";
import * as render from "./render.js";

const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5180";
const allowedOrigins = new Set(
  [clientOrigin, ...(process.env.ALLOWED_ORIGINS || "").split(",")].map((origin) => origin.trim()).filter(Boolean)
);
const demoMode = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

app.use(
  cors({
    origin: [...allowedOrigins],
    credentials: true,
  })
);
app.use(express.json());

const { requireAuth, requireAdmin, demoUser } = setupAuth(app, { demoMode, clientOrigin });

// Programmatic access: if there's no session user but a Bearer token is present,
// authenticate via API token (for Claude Code / CI to read logs, set env, deploy).
app.use((req, _res, next) => {
  if (!req.user) {
    const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (m) {
      const user = getUserByApiToken(m[1].trim());
      if (user) {
        req.user = user;
        req.viaApiToken = true;
      }
    }
  }
  next();
});

const h = (fn) => async (req, res, next) => {
  try {
    const payload = await fn(req, res, next);
    if (!res.headersSent && payload !== undefined) {
      res.json(payload);
    }
  } catch (err) {
    next(err);
  }
};

function mutateGuard(req, res, next) {
  // Token-authenticated requests carry no cookie, so they're not subject to
  // CSRF — skip the origin check (Claude Code / CI use Bearer tokens).
  if (req.viaApiToken) return next();
  const contentType = req.headers["content-type"] || "";
  const origin = req.get("origin") || req.get("referer") || "";
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).origin : "";
  } catch {
    originHost = "";
  }
  const isJson = contentType.includes("application/json") || contentType === "";
  if (!isJson) return res.status(403).json({ error: "JSON requests only" });
  if (originHost && !allowedOrigins.has(originHost)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

function ownedList(user, type) {
  return user?.role === "admin" ? null : new Set(ownedUuids(user.id, type));
}

function filterByOwnership(items, user, type) {
  if (user?.role === "admin") return items;
  const owned = ownedList(user, type);
  return items.filter((item) => owned.has(item.uuid));
}

function ensureFound(entity, label = "Resource") {
  if (!entity) {
    throw Object.assign(new Error(`${label} not found`), { status: 404 });
  }
  return entity;
}

// --- meta ---
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, mode: demoMode ? "demo" : "live" })
);

app.get("/api/me", requireAuth, h((req) => ({
  id: req.user.id,
  email: req.user.email,
  name: req.user.name,
  avatar_url: req.user.avatar_url,
  role: req.user.role,
})));

// --- services ---
app.get(
  "/api/services",
  requireAuth,
  h(async (req) => filterByOwnership(await coolify.listServices(), req.user, "application"))
);

app.get(
  "/api/services/:id",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return ensureFound(await coolify.getService(req.params.id), "Service");
  })
);

app.post(
  "/api/services/:id/deploy",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    record(req, "deploy", { resourceType: "application", resourceUuid: req.params.id });
    return coolify.deployService(req.params.id);
  })
);

app.post(
  "/api/services/:id/:action(start|stop|restart)",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    record(req, req.params.action, { resourceType: "application", resourceUuid: req.params.id });
    return coolify.controlService(req.params.id, req.params.action);
  })
);

// --- deployments & logs ---
app.get(
  "/api/services/:id/deployments",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return coolify.listDeployments(req.params.id);
  })
);

app.get(
  "/api/services/:id/logs",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return coolify.getLogLines(req.params.id);
  })
);

// --- env vars ---
app.get(
  "/api/services/:id/envs",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return coolify.listEnvs(req.params.id);
  })
);

app.post(
  "/api/services/:id/envs",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    record(req, "env_upsert", {
      resourceType: "application",
      resourceUuid: req.params.id,
      metadata: {
        key: req.body?.key,
        is_secret: !!req.body?.is_secret,
      },
    });
    return coolify.upsertEnv(req.params.id, req.body);
  })
);

app.delete(
  "/api/services/:id/envs/:envId",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    record(req, "env_delete", { resourceType: "application", resourceUuid: req.params.id, metadata: { envId: req.params.envId } });
    return coolify.deleteEnv(req.params.id, req.params.envId);
  })
);

// --- databases & infrastructure ---
app.get(
  "/api/databases",
  requireAuth,
  h(async (req) => filterByOwnership(await coolify.listDatabases(), req.user, "database"))
);

app.post(
  "/api/databases",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    const userId = req.user.id;
    const { type, name } = req.body || {};
    if (!type || !name) throw Object.assign(new Error("type and name are required"), { status: 400 });
    let proj = getCustomerProject(userId);
    let projectUuid, environmentName;
    if (proj) {
      projectUuid = proj.project_uuid;
      environmentName = proj.environment_name;
    } else {
      const created = await coolify.createProject("deploy-" + userId);
      projectUuid = created.uuid;
      environmentName = "production";
      setCustomerProject({ userId, projectUuid, environmentName });
    }
    const { uuid } = await databases.createDatabase({
      type, name, projectUuid, environmentName,
      serverUuid: process.env.COOLIFY_SERVER_UUID,
    });
    assign(uuid, "database", userId);
    record(req, "db.create", { resourceType: "database", resourceUuid: uuid });
    return { uuid };
  })
);

app.post(
  "/api/databases/:id/:action(start|stop)",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    return req.params.action === "start"
      ? databases.startDatabase(req.params.id)
      : databases.stopDatabase(req.params.id);
  })
);

app.delete(
  "/api/databases/:id",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    await databases.deleteDatabase(req.params.id);
    record(req, "db.delete", { resourceType: "database", resourceUuid: req.params.id });
    return { ok: true };
  })
);

app.delete(
  "/api/services/:id",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    await lifecycle.deleteApp(req.params.id);
    record(req, "app.delete", { resourceType: "application", resourceUuid: req.params.id });
    return { ok: true };
  })
);

app.get(
  "/api/services/:id/domain/verify",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return dns.verifyDomain(req.query.fqdn);
  })
);

app.post(
  "/api/services/:id/domain",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await lifecycle.setDomain(req.params.id, req.body?.fqdn);
    record(req, "app.domain", { resourceType: "application", resourceUuid: req.params.id, metadata: { fqdn: req.body?.fqdn } });
    return result;
  })
);

app.get(
  "/api/services/:id/domain/verify",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const { fqdn } = req.query;
    return lifecycle.verifyDomain(req.params.id, fqdn);
  })
);

app.get(
  "/api/servers",
  requireAuth,
  requireAdmin,
  h(() => coolify.listServers())
);

app.get(
  "/api/admin/users",
  requireAuth,
  requireAdmin,
  h(() => listUsers())
);

app.post(
  "/api/admin/assign",
  requireAuth,
  requireAdmin,
  mutateGuard,
  h(async (req) => {
    const { uuid, type, userId } = req.body || {};
    if (!uuid || typeof uuid !== "string" || !uuid.trim()) {
      throw Object.assign(new Error("uuid is required"), { status: 400 });
    }
    if (!["application", "database", "service"].includes(type)) {
      throw Object.assign(new Error("type is invalid"), { status: 400 });
    }
    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw Object.assign(new Error("userId is required"), { status: 400 });
    }
    const users = listUsers();
    if (!users.some((u) => u.id === parsedUserId)) {
      throw Object.assign(new Error("User not found"), { status: 404 });
    }
    assign(uuid, type, parsedUserId);
    record(req, "admin_assign", { resourceType: type, resourceUuid: uuid, metadata: { userId: parsedUserId } });
    return { ok: true };
  })
);

// --- GitHub App state helpers ------------------------------------------------

const STATE_TTL_MS = 15 * 60 * 1000;

// --- GitHub connect + callback ----------------------------------------------

app.get("/github/connect", requireAuth, (req, res) => {
  // one-time, server-stored nonce bound to this user (not a replayable HMAC)
  const state = randomBytes(32).toString("hex");
  createOauthState({ state, userId: req.user.id });
  res.redirect(githubApp.githubApp.installUrl(state));
});

app.get("/github/setup", requireAuth, async (req, res, next) => {
  try {
    const { installation_id } = req.query;
    const state = String(req.query.state || "");

    // 1. consume the one-time nonce; must belong to this user and be fresh
    const row = consumeOauthState(state);
    if (!row || row.user_id !== req.user.id) {
      return res.status(403).json({ error: "Invalid or expired state" });
    }
    if (Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) {
      return res.status(403).json({ error: "State expired" });
    }

    // 2. the installation must belong to THIS user's GitHub account — don't
    //    trust installation_id from the query. We verify via the App JWT and
    //    match the installation's account against the user's linked GitHub id.
    const ghIdentity = getIdentityByUser(req.user.id, "github");
    if (!ghIdentity) {
      return res.status(403).json({ error: "Sign in with GitHub before connecting an installation." });
    }
    const info = await githubApp.githubApp.getInstallationInfo(Number(installation_id));
    if (String(info.account_id) !== String(ghIdentity.provider_user_id)) {
      // org installs (account is an Organization) need member verification we
      // don't do yet — reject so no one can bind another account's installation
      return res.status(403).json({
        error: "That installation isn't on your personal GitHub account. Personal-account installs only for now.",
      });
    }

    setInstallation({ userId: req.user.id, installationId: Number(installation_id), accountLogin: info.account_login });
    // Also populate multi-install storage alongside the legacy single-install row.
    addUserInstallation({
      userId: req.user.id,
      installationId: Number(installation_id),
      accountLogin: info.account_login,
      accountId: info.account_id,
    });
    res.redirect((process.env.CLIENT_ORIGIN || "http://localhost:5180") + "/new");
  } catch (err) {
    next(err);
  }
});

// --- GitHub API routes -------------------------------------------------------

// Resolve the user's GitHub App installation. If we haven't recorded one,
// auto-discover it by matching an installation's account to the user's linked
// GitHub id — so we don't depend on GitHub's flaky Setup-URL callback.
async function ensureInstallation(user) {
  const existing = getInstallation(user.id);
  if (existing) return existing;
  const gh = getIdentityByUser(user.id, "github");
  if (!gh) return null;
  try {
    const installs = await githubApp.githubApp.listInstallations();
    const match = installs.find((i) => String(i.account_id) === String(gh.provider_user_id));
    if (match) {
      setInstallation({ userId: user.id, installationId: match.id, accountLogin: match.account_login });
      return getInstallation(user.id);
    }
  } catch {
    /* fall through */
  }
  return null;
}

app.get("/api/github/installations", requireAuth, h((req) => listUserInstallations(req.user.id)));

app.get("/api/github/repos", requireAuth, h(async (req, res) => {
  // Aggregate across all of the user's installations. Fall back to the legacy
  // single install (auto-discovered) when the multi list is empty — back-compat.
  let installs = listUserInstallations(req.user.id).map((r) => ({
    installation_id: r.installation_id,
    account_login: r.account_login,
  }));
  if (installs.length === 0) {
    const inst = await ensureInstallation(req.user);
    if (!inst) return res.status(409).json({ needsConnect: true });
    installs = [{ installation_id: inst.installation_id, account_login: inst.account_login }];
  }
  // ponytail: per-installation listRepos in series is fine for a handful of installs; parallelize only if it's slow.
  const out = [];
  for (const inst of installs) {
    const repos = await githubApp.githubApp.listRepos(inst.installation_id);
    for (const r of repos) {
      out.push({ ...r, account_login: inst.account_login, installation_id: inst.installation_id });
    }
  }
  return out;
}));

app.get("/api/github/repos/:owner/:repo/branches", requireAuth, h(async (req, res) => {
  const inst = await ensureInstallation(req.user);
  if (!inst) return res.status(409).json({ needsConnect: true });
  return githubApp.githubApp.listBranches(inst.installation_id, req.params.owner, req.params.repo);
}));

// --- App creation ------------------------------------------------------------

app.post("/api/apps", requireAuth, mutateGuard, h(async (req, res) => {
  const userId = req.user.id;
  const { repo, branch, name, port, envs, buildPack, installCommand, buildCommand, startCommand } = req.body || {};

  // 0. Validate input
  if (!repo || !branch || !name || port === undefined || port === null || port === "") {
    throw Object.assign(new Error("repo, branch, name, and port are required"), { status: 400 });
  }

  // 1. Scope to the caller's OWN installation: the repo (and branch) must be
  //    accessible to this user's installation, or we refuse — prevents
  //    deploying another tenant's repo through the shared GitHub App.
  const inst = await ensureInstallation(req.user);
  if (!inst) {
    res.status(409).json({ needsConnect: true });
    return;
  }
  const repos = await githubApp.githubApp.listRepos(inst.installation_id);
  if (!repos.some((r) => r.full_name === repo)) {
    throw Object.assign(new Error("Repository is not accessible to your GitHub installation"), { status: 403 });
  }
  const slashIdx = repo.indexOf("/");
  const owner = repo.slice(0, slashIdx);
  const repoName = repo.slice(slashIdx + 1);
  const branches = await githubApp.githubApp.listBranches(inst.installation_id, owner, repoName);
  if (!branches.includes(branch)) {
    throw Object.assign(new Error("Branch not found in the selected repository"), { status: 400 });
  }

  // 2. Ensure customer project exists
  let proj = getCustomerProject(userId);
  let projectUuid, environmentName;
  if (proj) {
    projectUuid = proj.project_uuid;
    environmentName = proj.environment_name;
  } else {
    const created = await coolify.createProject("deploy-" + userId);
    projectUuid = created.uuid;
    environmentName = "production";
    setCustomerProject({ userId, projectUuid, environmentName });
  }

  // 2. Resolve destination
  const serverUuid = process.env.COOLIFY_SERVER_UUID;
  const destinationUuid = process.env.COOLIFY_DESTINATION_UUID ||
    await coolify.getDefaultDestination(serverUuid);

  // 3. Create app in Coolify
  const { uuid } = await coolify.createPrivateGithubApp({
    githubAppUuid: process.env.COOLIFY_GITHUB_APP_UUID,
    projectUuid,
    environmentName,
    serverUuid,
    destinationUuid,
    gitRepository: repo,
    gitBranch: branch,
    portsExposes: String(port),
    name,
    buildPack: buildPack || "nixpacks",
    ...(installCommand ? { installCommand } : {}),
    ...(buildCommand ? { buildCommand } : {}),
    ...(startCommand ? { startCommand } : {}),
    instantDeploy: true,
  });

  // 4. Assign ownership + audit (only after successful create)
  assign(uuid, "application", userId);
  record(req, "app.create", { resourceType: "application", resourceUuid: uuid });

  // 5. Set env vars — team shared variables first (env-group behavior), then
  //    the app's own (so per-app values win on key collisions).
  for (const sv of await sharedvars.listSharedVars()) {
    await coolify.upsertEnv(uuid, { key: sv.key, value: sv.value, is_secret: sv.is_secret });
  }
  for (const e of envs || []) await coolify.upsertEnv(uuid, e);

  return { uuid };
}));

// build/deploy logs for one deployment
app.get(
  "/api/services/:id/deployments/:depId/logs",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    // the deployment must belong to THIS service, else 404 (no cross-service log access)
    const deployments = await coolify.listDeployments(req.params.id);
    if (!deployments.some((d) => d.uuid === req.params.depId)) {
      throw Object.assign(new Error("Not found"), { status: 404 });
    }
    return coolify.getDeploymentLogs(req.params.depId);
  })
);

// disconnect GitHub so the user can connect a different account
app.delete(
  "/api/github/connection",
  requireAuth,
  mutateGuard,
  h((req) => {
    deleteInstallation(req.user.id);
    record(req, "github.disconnect");
    return { ok: true };
  })
);

// --- programmatic API tokens (for Claude Code / CI) ---
app.get("/api/tokens", requireAuth, h((req) => listApiTokens(req.user.id)));

app.post("/api/tokens", requireAuth, mutateGuard, h((req) => {
  const name = (req.body?.name || "").toString().slice(0, 60) || "token";
  const { id, token } = createApiToken(req.user.id, name);
  record(req, "token.create", { metadata: { id, name } });
  // token is returned ONCE; only its hash is stored
  return { id, name, token };
}));

app.delete("/api/tokens/:id", requireAuth, mutateGuard, h((req) => {
  deleteApiToken(req.user.id, Number(req.params.id));
  record(req, "token.delete", { metadata: { id: req.params.id } });
  return { ok: true };
}));

// --- limits & health check ---
app.patch(
  "/api/services/:id/limits",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await resources.setLimits(req.params.id, req.body || {});
    record(req, "app.limits", { resourceType: "application", resourceUuid: req.params.id, metadata: req.body });
    return result;
  })
);

app.patch(
  "/api/services/:id/healthcheck",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await resources.setHealthcheck(req.params.id, req.body || {});
    record(req, "app.healthcheck", { resourceType: "application", resourceUuid: req.params.id, metadata: req.body });
    return result;
  })
);

// --- server usage (admin only) ---
app.get(
  "/api/servers/:id/usage",
  requireAuth,
  requireAdmin,
  h(async (req) => resources.getResourceUsage(req.params.id))
);

// --- rollback ---
app.post(
  "/api/services/:id/rollback",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const { commit } = req.body || {};
    if (!commit) throw Object.assign(new Error("commit is required"), { status: 400 });
    const result = await coolify.rollback(req.params.id, commit);
    record(req, "rollback", { resourceType: "application", resourceUuid: req.params.id, metadata: { commit } });
    return result;
  })
);

// --- volumes ---
app.get(
  "/api/services/:id/volumes",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return volumes.listVolumes(req.params.id);
  })
);

app.post(
  "/api/services/:id/volumes",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await volumes.addVolume(req.params.id, req.body || {});
    record(req, "volume.add", { resourceType: "application", resourceUuid: req.params.id, metadata: { mountPath: req.body?.mountPath } });
    return result;
  })
);

app.delete(
  "/api/services/:id/volumes/:vid",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await volumes.deleteVolume(req.params.id, req.params.vid);
    record(req, "volume.delete", { resourceType: "application", resourceUuid: req.params.id, metadata: { volumeUuid: req.params.vid } });
    return result;
  })
);

// --- shared vars (admin only) ---
app.get(
  "/api/shared-vars",
  requireAuth,
  requireAdmin,
  h(() => sharedvars.listSharedVars())
);

app.post(
  "/api/shared-vars",
  requireAuth,
  requireAdmin,
  mutateGuard,
  h(async (req) => {
    const result = await sharedvars.upsertSharedVar(req.body || {});
    record(req, "sharedvar.upsert", { metadata: { key: req.body?.key } });
    return result;
  })
);

app.delete(
  "/api/shared-vars/:id",
  requireAuth,
  requireAdmin,
  mutateGuard,
  h(async (req) => {
    const result = await sharedvars.deleteSharedVar(req.params.id);
    record(req, "sharedvar.delete", { metadata: { uuid: req.params.id } });
    return result;
  })
);

// --- database backups ---
app.get(
  "/api/databases/:id/backups",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    return backups.getBackupConfig(req.params.id);
  })
);

app.post(
  "/api/databases/:id/backups",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    const result = await backups.setBackupSchedule(req.params.id, req.body || {});
    record(req, "backup.schedule", { resourceType: "database", resourceUuid: req.params.id, metadata: { frequency: req.body?.frequency } });
    return result;
  })
);

app.post(
  "/api/databases/:id/backups/run",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    const result = await backups.triggerBackup(req.params.id);
    record(req, "backup.trigger", { resourceType: "database", resourceUuid: req.params.id });
    return result;
  })
);

// --- Hetzner provisioning (admin only) ---
app.get(
  "/api/hetzner/server-types",
  requireAuth,
  requireAdmin,
  h(() => hetzner.listServerTypes())
);

app.get(
  "/api/hetzner/locations",
  requireAuth,
  requireAdmin,
  h(() => hetzner.listLocations())
);

app.post(
  "/api/servers/provision",
  requireAuth,
  requireAdmin,
  mutateGuard,
  h(async (req) => {
    const { name, serverType, location } = req.body || {};
    const result = await provisionServer({ name, serverType, location });
    record(req, "server.provision", { metadata: { name, serverType, location } });
    return result;
  })
);

app.get(
  "/api/servers/:id/provision-status",
  requireAuth,
  requireAdmin,
  // ponytail: no job store yet — status is read straight from Hetzner.
  h((req) => hetzner.getServer(req.params.id))
);

// --- Render importer ---
app.post(
  "/api/import/render/services",
  requireAuth,
  mutateGuard,
  // POST (not GET) because the API key travels in the body; never logged.
  h((req) => render.listServices(req.body?.apiKey))
);

app.post(
  "/api/import/render",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    const { renderServiceId, target, apiKey } = req.body || {};
    // Provisioning dedicated infra (real, billed Hetzner servers) is admin-only,
    // matching the /api/hetzner/* + /api/servers/provision routes. Non-admins may
    // only import onto existing shared infra. Fail closed when mode is unclear.
    if (target?.mode !== "shared" && req.user.role !== "admin") {
      throw Object.assign(
        new Error("Admin role required to import onto dedicated/provisioned infrastructure"),
        { status: 403 }
      );
    }
    const result = await importFromRender({ renderServiceId, target, userId: req.user.id, apiKey });
    // audit without the apiKey
    record(req, "import.render", { metadata: { renderServiceId, target } });
    return result;
  })
);

// --- error handler ---
app.use((err, _req, res, _next) => {
  console.error(err.message, err.detail || "");
  res.status(err.status || 500).json({ error: err.message, detail: err.detail });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DebutDeploy API on :${PORT} [${demoMode ? "DEMO data" : "LIVE → Coolify"}]`);
});
