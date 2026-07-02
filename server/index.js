import "dotenv/config";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import * as coolify from "./coolify.js";
import * as githubApp from "./github-app.js";
import * as databases from "./databases.js";
import * as lifecycle from "./lifecycle.js";
import { setupAuth } from "./auth.js";
import { assertOwns, assign, ownedUuids } from "./ownership.js";
import {
  db,
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
import { record, recordSystem } from "./audit.js";
import { listEvents, listEventsForResource } from "./events.js";
import { getNotificationSettings, setNotificationSettings, notify, EVENT_TYPES } from "./notifications.js";
import { runHealthCheck } from "./monitor.js";
import * as dns from "./dns.js";
import * as resources from "./resources.js";
import * as volumes from "./volumes.js";
import * as sharedvars from "./sharedvars.js";
import * as backups from "./backups.js";
import * as hetzner from "./hetzner.js";
import { provisionServer } from "./provision.js";
import { importFromRender } from "./migrate.js";
import * as render from "./render.js";
import { generateDeployKeypair, registerDeployKey, createDeployKeyApp, setAppDomain, deployApp, ensureAccountKey, toSshUrl } from "./deploykey.js";
import { computePlans, dbPlans } from "./plans.js";
import { repoKey, verifyWebhookSig } from "./webhook.js";
import { createRenderCredential, listRenderCredentials, getRenderCredential, deleteRenderCredential } from "./db.js";
import { encryptSecret, decryptSecret } from "./secretbox.js";

const app = express();
// Behind a TLS-terminating reverse proxy (the standard deploy): trust the first
// hop so `secure` cookies are set over the proxied connection and req.ip is the
// real client, not the proxy. ponytail: set to the real hop count if >1 proxy.
app.set("trust proxy", 1);
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
// Capture the raw body so the GitHub webhook can HMAC-verify the exact bytes
// GitHub signed (re-stringifying the parsed JSON isn't byte-identical).
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const { requireAuth, requireAdmin, demoUser } = setupAuth(app, { demoMode, clientOrigin });

// Throttle FAILED Bearer-token auth per IP to blunt online token guessing.
// Tokens are 192-bit random, so this is defense-in-depth. ponytail: in-process
// fixed window; use a shared store if you run multiple instances.
const tokenFails = new Map(); // ip -> { count, resetAt }
const TOKEN_FAIL_MAX = 10;
const TOKEN_FAIL_WINDOW_MS = 60_000;
function tokenAuthBlocked(ip) {
  const rec = tokenFails.get(ip);
  return !!rec && Date.now() <= rec.resetAt && rec.count >= TOKEN_FAIL_MAX;
}
function recordTokenFail(ip) {
  if (tokenFails.size > 10_000) tokenFails.clear(); // crude cap against IP-spray memory growth
  const now = Date.now();
  const rec = tokenFails.get(ip);
  if (!rec || now > rec.resetAt) tokenFails.set(ip, { count: 1, resetAt: now + TOKEN_FAIL_WINDOW_MS });
  else rec.count += 1;
}

// Programmatic access: if there's no session user but a Bearer token is present,
// authenticate via API token (for Claude Code / CI to read logs, set env, deploy).
app.use((req, res, next) => {
  if (!req.user) {
    const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (m) {
      if (tokenAuthBlocked(req.ip)) return res.status(429).json({ error: "Too many attempts" });
      const user = getUserByApiToken(m[1].trim());
      if (user) {
        req.user = user;
        req.viaApiToken = true;
      } else {
        recordTokenFail(req.ip);
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
  // Fail closed: a cookie-authed mutation must carry a recognized same-origin
  // Origin/Referer. An absent/unparseable header is rejected, not allowed through.
  if (!originHost || !allowedOrigins.has(originHost)) {
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

// Notify a resource's OWNER (not the actor) of an event — fire-and-forget.
function notifyOwner(uuid, event) {
  const owner = db.prepare("SELECT user_id FROM resource_ownership WHERE coolify_uuid = ?").get(uuid);
  if (owner?.user_id) notify({ userId: owner.user_id, event: { ...event, resource_uuid: event.resource_uuid ?? uuid } }).catch(() => {});
}

// Poll a deployment to a terminal state, then notify deploy.succeeded/failed.
// Fire-and-forget; off in demo/test. ponytail: short bounded poll (~5min), not a queue.
async function watchDeploy(serviceUuid, deploymentUuid) {
  if (demoMode || process.env.NODE_ENV === "test") return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 20; i++) {
    await sleep(15_000);
    let status;
    try {
      const deps = await coolify.listDeployments(serviceUuid);
      status = (Array.isArray(deps) ? deps : []).find((d) => d.uuid === deploymentUuid)?.status;
    } catch { continue; }
    if (!status) continue;
    if (["finished", "success", "successful"].includes(status)) {
      return notifyOwner(serviceUuid, { type: "deploy.succeeded", message: "Deploy succeeded" });
    }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      return notifyOwner(serviceUuid, { type: "deploy.failed", message: `Deploy ${status}` });
    }
  }
}

app.post(
  "/api/services/:id/deploy",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    record(req, "deploy", { resourceType: "application", resourceUuid: req.params.id });
    const result = await coolify.deployService(req.params.id);
    notifyOwner(req.params.id, { type: "deploy.started", message: "Deploy triggered" });
    const depUuid = result?.deployments?.[0]?.deployment_uuid;
    if (depUuid) watchDeploy(req.params.id, depUuid); // → deploy.succeeded/failed
    return result;
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

// Customers/clients with a count of the resources each owns (admin view).
app.get(
  "/api/customers",
  requireAuth,
  requireAdmin,
  h(() =>
    listUsers().map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      avatar_url: u.avatar_url ?? null,
      created_at: u.created_at ?? null,
      owned: {
        applications: ownedUuids(u.id, "application").length,
        databases: ownedUuids(u.id, "database").length,
      },
    }))
  )
);

// Billing: live infrastructure cost (Hetzner) + the customer pricing plans + margin.
app.get(
  "/api/billing",
  requireAuth,
  requireAdmin,
  h(async () => ({
    infra: await hetzner.listServersWithCost(),
    computePlans: computePlans(),
    dbPlans: dbPlans(),
  }))
);

// --- Deploy-key service creation (deploy ANY repo without the GitHub App) ---
// Step 1: generate a keypair, register the private half in Coolify, return the
// public key for the operator to add as a read-only deploy key on their repo.
app.post(
  "/api/git/prepare-key",
  requireAuth,
  requireAdmin,
  mutateGuard,
  h(async (req) => {
    const { publicKey, privateKeyPem } = generateDeployKeypair();
    const { uuid } = await registerDeployKey({ name: `dk-${Date.now().toString(36)}`, privateKeyPem });
    record(req, "deploykey.prepare");
    return { keyUuid: uuid, publicKey };
  })
);

// The ONE-TIME account key: the operator adds this public key to their GitHub
// ACCOUNT once, then Coolify can clone any repo — used by New Service, the API
// create path, and the Render importer. Idempotent.
app.get(
  "/api/git/account-key",
  requireAuth,
  requireAdmin,
  h(async () => {
    const { keyUuid, publicKey } = await ensureAccountKey().then((k) => ({ keyUuid: k.uuid, publicKey: k.publicKey }));
    return { keyUuid, publicKey };
  })
);

// Step 2: create the Coolify app from the repo using that key, set domain, deploy,
// and assign ownership to the creator.
app.post(
  "/api/git/create-service",
  requireAuth,
  requireAdmin,
  mutateGuard,
  h(async (req) => {
    const { keyUuid, repo, branch, name, buildPack, installCommand, buildCommand, startCommand, port, domain } = req.body || {};
    if (!keyUuid || !repo || !name) {
      throw Object.assign(new Error("keyUuid, repo and name are required"), { status: 400 });
    }
    const { uuid } = await createDeployKeyApp({ keyUuid, repo, branch, name, buildPack, installCommand, buildCommand, startCommand, port });
    if (domain) await setAppDomain(uuid, /^https?:\/\//.test(domain) ? domain : `https://${domain}`);
    assign(uuid, "application", req.user.id);
    const deployment = await deployApp(uuid);
    record(req, "app.create", { resourceType: "application", resourceUuid: uuid, metadata: { repo, via: "deploy-key" } });
    return { appUuid: uuid, deployment };
  })
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
  // Fail loud if the App slug isn't configured — otherwise installUrl builds
  // github.com/apps//installations/new which is a confusing GitHub 404. (If you
  // just set GITHUB_APP_SLUG in .env, restart the server so it loads.)
  if (!process.env.GITHUB_APP_SLUG) {
    return res
      .status(500)
      .json({ error: "GitHub App not configured: GITHUB_APP_SLUG is missing. Set it in server/.env and restart the server." });
  }
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

    // Multi-account: when the App is configured to "Request user authorization
    // during installation", GitHub returns a `code` alongside installation_id.
    // Exchange it for a user token and record EVERY install the user can see, so
    // one connect populates all accounts. Additive — never blocks the single path.
    // VERIFY LIVE: needs GITHUB_APP_CLIENT_ID/SECRET + user-auth enabled on the App.
    if (req.query.code) {
      try {
        const userToken = await githubApp.githubApp.exchangeUserCode(req.query.code);
        const installs = await githubApp.githubApp.listUserInstallations(userToken);
        for (const inst of installs) {
          addUserInstallation({
            userId: req.user.id,
            installationId: inst.id,
            accountLogin: inst.account_login,
            accountId: String(inst.account_id),
          });
        }
      } catch {
        // Don't 500 the whole setup on an OAuth hiccup; the single-install path
        // above already succeeded. No logging — never surface the token/code.
      }
    }
    res.redirect((process.env.CLIENT_ORIGIN || "http://localhost:5180") + "/new");
  } catch (err) {
    next(err);
  }
});

// --- GitHub push webhook: auto-deploy on commit ------------------------------
// GitHub App sends one webhook for every installation. We HMAC-verify it, then
// deploy any Coolify app whose repo + branch match the push. No per-repo setup.
app.post("/github/webhook", async (req, res) => {
  if (!verifyWebhookSig(req.rawBody, req.get("x-hub-signature-256"), process.env.GITHUB_APP_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: "bad signature" });
  }
  const event = req.get("x-github-event");
  if (event === "ping") return res.json({ ok: true, pong: true });
  if (event !== "push") return res.json({ ok: true, ignored: event });

  const repoFull = req.body?.repository?.full_name || "";
  const branch = String(req.body?.ref || "").replace(/^refs\/heads\//, "");
  // A branch delete sends a push with deleted:true — never deploy those.
  if (!repoFull || !branch || req.body?.deleted) return res.json({ ok: true, ignored: "no-op push" });

  // Respond immediately (GitHub times out at 10s); deploy in the background.
  res.json({ ok: true, repo: repoFull, branch });

  try {
    const key = repoFull.toLowerCase();
    const services = await coolify.listServices();
    const matches = services.filter((s) => repoKey(s.repo) === key && (s.branch || "main") === branch);
    for (const s of matches) {
      await coolify.deployService(s.uuid);
      recordSystem("github.push.deploy", { resourceType: "application", resourceUuid: s.uuid, metadata: { name: s.name, repo: repoFull, branch } });
    }
    if (!matches.length) recordSystem("github.push.nomatch", { metadata: { repo: repoFull, branch } });
  } catch (err) {
    recordSystem("github.push.error", { metadata: { repo: repoFull, branch, error: err.message } });
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

  // 2. Create the app via the deploy-key path. The one shared account key clones
  //    any repo on the operator's GitHub account — Coolify's GitHub-App-source
  //    API (createPrivateGithubApp) doesn't exist on this Coolify instance.
  const { uuid: keyUuid } = await ensureAccountKey();
  const { uuid } = await createDeployKeyApp({
    keyUuid,
    repo: toSshUrl(repo),
    branch,
    name,
    port,
    buildPack: buildPack || "nixpacks",
    ...(installCommand ? { installCommand } : {}),
    ...(buildCommand ? { buildCommand } : {}),
    ...(startCommand ? { startCommand } : {}),
  });

  // 3. Assign ownership + audit (only after a successful create).
  assign(uuid, "application", userId);
  record(req, "app.create", { resourceType: "application", resourceUuid: uuid });

  // 4. Auto-assign <name>.debutdepoly.com — wildcard DNS + on-demand Traefik cert.
  const slug = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
  const domain = `https://${slug}.debutdepoly.com`;
  try { await setAppDomain(uuid, domain); } catch { /* non-fatal — domain settable later */ }

  // 5. Env: team shared vars first (env-group behavior), then the app's own
  //    (per-app values win on key collisions).
  for (const sv of await sharedvars.listSharedVars()) {
    await coolify.upsertEnv(uuid, { key: sv.key, value: sv.value, is_secret: sv.is_secret });
  }
  for (const e of envs || []) await coolify.upsertEnv(uuid, e);

  // 6. Deploy now that env + domain are in place.
  await coolify.deployService(uuid);

  return { uuid, domain };
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

// --- Saved (named, encrypted) Render API keys ---
// Resolve the Render key for an importer request: a raw apiKey in the body, OR a
// savedKeyId → decrypt the caller's OWN stored key (scoped by user_id).
function resolveRenderKey(req) {
  const { apiKey, savedKeyId } = req.body || {};
  if (savedKeyId != null && savedKeyId !== "") {
    const row = getRenderCredential(req.user.id, Number(savedKeyId));
    if (!row) throw Object.assign(new Error("Saved Render key not found"), { status: 404 });
    return decryptSecret(row.key_ciphertext);
  }
  return apiKey;
}

app.get("/api/render/keys", requireAuth, h((req) => listRenderCredentials(req.user.id)));

app.post(
  "/api/render/keys",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    const { name, apiKey } = req.body || {};
    if (!name || !String(name).trim()) throw Object.assign(new Error("name is required"), { status: 400 });
    if (!apiKey || !String(apiKey).trim()) throw Object.assign(new Error("apiKey is required"), { status: 400 });
    // Validate the key against Render before storing (rejects a typo'd/dead key).
    await render.listServices(apiKey.trim());
    const saved = createRenderCredential({ userId: req.user.id, name: String(name).trim(), keyCiphertext: encryptSecret(apiKey.trim()) });
    record(req, "render.key.save", { metadata: { name: saved.name } }); // never the key
    return saved; // { id, name } — never echoes the key
  })
);

app.delete("/api/render/keys/:id", requireAuth, mutateGuard, h((req) => {
  const changes = deleteRenderCredential(req.user.id, Number(req.params.id));
  if (!changes) throw Object.assign(new Error("Saved Render key not found"), { status: 404 });
  record(req, "render.key.delete", { metadata: { id: req.params.id } });
  return { ok: true };
}));

// --- Render importer ---
app.post(
  "/api/import/render/services",
  requireAuth,
  mutateGuard,
  // POST (not GET) because the API key travels in the body; never logged.
  h((req) => render.listServices(resolveRenderKey(req)))
);

// Render Postgres instances — the migration SOURCE picker.
app.post(
  "/api/import/render/databases",
  requireAuth,
  mutateGuard,
  h((req) => render.listDatabases(resolveRenderKey(req)))
);

app.post(
  "/api/import/render",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    const { renderServiceId, target } = req.body || {};
    const apiKey = resolveRenderKey(req);
    // Provisioning dedicated infra (real, billed Hetzner servers) is admin-only,
    // matching the /api/hetzner/* + /api/servers/provision routes. Non-admins may
    // only import onto existing shared infra. Fail closed when mode is unclear.
    if (target?.mode !== "shared" && req.user.role !== "admin") {
      throw Object.assign(
        new Error("Admin role required to import onto dedicated/provisioned infrastructure"),
        { status: 403 }
      );
    }
    // Migrating INTO an existing Coolify DB reads its credentials and pg_restores
    // over it — the caller must own that database (admins bypass in assertOwns).
    if (target?.dbTarget?.mode === "existing") {
      assertOwns(req.user, "database", target.dbTarget.uuid);
    }
    const result = await importFromRender({ renderServiceId, target, userId: req.user.id, apiKey });
    // audit without the apiKey
    record(req, "import.render", { metadata: { renderServiceId, target } });
    return result;
  })
);

// Migrate MULTIPLE selected services of a Render project in one pass, sharing one
// database target. Same admin gate as single import for dedicated infra.
app.post(
  "/api/import/render/project",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    const { services, target } = req.body || {};
    const apiKey = resolveRenderKey(req);
    if (!Array.isArray(services) || services.length === 0) {
      throw Object.assign(new Error("services (array of Render service ids) is required"), { status: 400 });
    }
    if (target?.mode !== "shared" && req.user.role !== "admin") {
      throw Object.assign(new Error("Admin role required to import onto dedicated/provisioned infrastructure"), { status: 403 });
    }
    // Same DB-ownership gate as the single-service route: restoring into an
    // existing Coolify DB exposes its creds + overwrites it, so require ownership.
    if (target?.dbTarget?.mode === "existing") {
      assertOwns(req.user, "database", target.dbTarget.uuid);
    }
    const results = [];
    for (const renderServiceId of services) {
      const r = await importFromRender({ renderServiceId, target, userId: req.user.id, apiKey });
      results.push({ renderServiceId, ok: r.ok, appUuid: r.appUuid, steps: r.steps });
    }
    record(req, "import.render.project", { metadata: { count: services.length, target } });
    return { results };
  })
);

// --- activity events ---
app.get(
  "/api/events",
  requireAuth,
  h((req) => {
    const isAdmin = req.user.role === "admin";
    return listEvents({
      userId: isAdmin ? null : req.user.id,
      // include system (user_id NULL) down/up events on the customer's own apps
      ownedUuids: isAdmin ? [] : ownedUuids(req.user.id, "application"),
      limit: Number(req.query.limit) || 100,
    });
  })
);

app.get(
  "/api/services/:id/events",
  requireAuth,
  h((req) => {
    assertOwns(req.user, "application", req.params.id);
    return listEventsForResource(req.params.id, {
      limit: 100,
      viewerId: req.user.id,
      isAdmin: req.user.role === "admin",
    });
  })
);

// --- notification / webhook settings ---
app.get(
  "/api/notifications",
  requireAuth,
  // Include the event catalog so the Webhooks UI can render the event checkboxes.
  h((req) => ({ ...getNotificationSettings(req.user.id), catalog: EVENT_TYPES }))
);

app.put(
  "/api/notifications",
  requireAuth,
  mutateGuard,
  h((req) => {
    const { webhookUrl, enabled, events } = req.body || {};
    const saved = setNotificationSettings({ userId: req.user.id, webhookUrl, enabled, events });
    record(req, "notification.update", { metadata: { enabled: !!enabled, events: saved.events } });
    return { ...saved, catalog: EVENT_TYPES };
  })
);

// --- serve the built client (single-process hosting) ---
// When client/dist exists (prod build), serve it + SPA fallback so client-side
// routes like /activity resolve. In local dev the client is served by Vite, so
// this is a no-op (dist absent) — run `npm run build` to produce it.
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    // Only HTML navigations — let API/auth/github 404s stay JSON, and don't
    // shadow static assets (already handled above).
    if (req.method !== "GET") return next();
    if (/^\/(api|auth|github)(\/|$)/.test(req.path)) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// --- error handler ---
app.use((err, _req, res, _next) => {
  // Log upstream detail server-side only; never forward it (it carries raw
  // Coolify/Hetzner/Render response bodies — internal hosts, paths, other UUIDs).
  console.error(err.message, err.detail || "");
  const status = err.status || 500;
  res.status(status).json({ error: status >= 500 ? "Internal error" : err.message });
});

// --- health monitor: poll live services, audit + notify owners on transitions ---
let healthSnapshot = {};
let healthRunning = false; // reentrancy guard: a slow tick must not overlap the next
if (!demoMode && process.env.NODE_ENV !== "test") {
  const timer = setInterval(async () => {
    if (healthRunning) return; // previous run still in flight (Coolify slow / many flaps)
    healthRunning = true;
    try {
      const { snapshot } = await runHealthCheck({
        listServices: coolify.listServices,
        prev: healthSnapshot,
        onTransition: async (t) => {
          // t = { uuid, name, from, to, down }
          recordSystem(t.down ? "service.down" : "service.up", {
            resourceType: "application",
            resourceUuid: t.uuid,
            metadata: { name: t.name, from: t.from, to: t.to },
          });
          const owner = db.prepare("SELECT user_id FROM resource_ownership WHERE coolify_uuid = ?").get(t.uuid);
          if (owner?.user_id) {
            await notify({
              userId: owner.user_id,
              event: {
                type: t.down ? "service.down" : "service.up",
                resource_uuid: t.uuid,
                message: `${t.name}: ${t.from} → ${t.to}`,
              },
            });
          }
        },
      });
      healthSnapshot = snapshot;
    } catch (err) {
      console.error("health monitor:", err.message);
    } finally {
      healthRunning = false;
    }
  }, 60_000); // VERIFY LIVE: cadence
  timer.unref?.();
}

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DebutDeploy API on :${PORT} [${demoMode ? "DEMO data" : "LIVE → Coolify"}]`);
});
