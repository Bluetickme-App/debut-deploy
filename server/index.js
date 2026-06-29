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
  setCustomerProject,
  getCustomerProject,
  getIdentityByUser,
  createOauthState,
  consumeOauthState,
} from "./db.js";
import { record } from "./audit.js";

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
    res.redirect((process.env.CLIENT_ORIGIN || "http://localhost:5180") + "/new");
  } catch (err) {
    next(err);
  }
});

// --- GitHub API routes -------------------------------------------------------

app.get("/api/github/repos", requireAuth, h(async (req, res) => {
  const inst = getInstallation(req.user.id);
  if (!inst) return res.status(409).json({ needsConnect: true });
  return githubApp.githubApp.listRepos(inst.installation_id);
}));

app.get("/api/github/repos/:owner/:repo/branches", requireAuth, h(async (req, res) => {
  const inst = getInstallation(req.user.id);
  if (!inst) return res.status(409).json({ needsConnect: true });
  return githubApp.githubApp.listBranches(inst.installation_id, req.params.owner, req.params.repo);
}));

// --- App creation ------------------------------------------------------------

app.post("/api/apps", requireAuth, mutateGuard, h(async (req, res) => {
  const userId = req.user.id;
  const { repo, branch, name, port, envs } = req.body || {};

  // 0. Validate input
  if (!repo || !branch || !name || port === undefined || port === null || port === "") {
    throw Object.assign(new Error("repo, branch, name, and port are required"), { status: 400 });
  }

  // 1. Scope to the caller's OWN installation: the repo (and branch) must be
  //    accessible to this user's installation, or we refuse — prevents
  //    deploying another tenant's repo through the shared GitHub App.
  const inst = getInstallation(userId);
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
    instantDeploy: true,
  });

  // 4. Assign ownership + audit (only after successful create)
  assign(uuid, "application", userId);
  record(req, "app.create", { resourceType: "application", resourceUuid: uuid });

  // 5. Set env vars
  for (const e of envs || []) await coolify.upsertEnv(uuid, e);

  return { uuid };
}));

// --- error handler ---
app.use((err, _req, res, _next) => {
  console.error(err.message, err.detail || "");
  res.status(err.status || 500).json({ error: err.message, detail: err.detail });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DebutDeploy API on :${PORT} [${demoMode ? "DEMO data" : "LIVE → Coolify"}]`);
});
