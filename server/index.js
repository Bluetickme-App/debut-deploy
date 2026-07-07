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
import { assertOwns, assign, ownedUuids, release, getAutoDeploy, setAutoDeploy, getNotifyPref, setNotifyPref } from "./ownership.js";
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
  getMembership,
  listOrgMembers,
  countOrgOwners,
  setMemberRole,
  removeMembership,
  createInvite,
  getValidInvite,
  addMembership,
  markInviteAccepted,
  listPendingInvites,
  deleteInvite,
  listOrgsWithCounts,
  getOrgDetail,
  listOrgResources,
  getOrgBillingInfo,
  setOrgBillingInfo,
  ensureUserOrg,
  listProjects,
  createProject,
  getProject,
  renameProject,
  deleteProject,
  createEnvironment,
  renameEnvironment,
  deleteEnvironment,
  transferProject,
  getUserByEmail,
} from "./db.js";
import { hasCapability } from "./rbac.js";
import { record, recordSystem } from "./audit.js";
import {
  walletBalance, recentLedger, creditWallet, createTopupSession, handleWebhookEvent, stripeClient,
  getOrCreateStripeCustomer, chargeMonthlyHardware, currentPeriod, usdToPence,
  stripeMode, setStripeMode, stripeWebhookSecret,
} from "./billing.js";
import * as stripeadmin from "./stripeadmin.js";
import { ensureCatalog } from "./stripecatalog.js";
import * as subscriptions from "./subscriptions.js";
import { getComp, setComp } from "./comp.js";
import { getAutoRecharge, setAutoRecharge, maybeAutoRecharge } from "./autorecharge.js";
import { planPriceUsd, detectComputePlan } from "./plans.js";
import { renderInvoiceHtml } from "./invoice.js";
import { listEvents, listEventsForResource } from "./events.js";
import { getNotificationSettings, setNotificationSettings, notify, EVENT_TYPES } from "./notifications.js";
import { runHealthCheck } from "./monitor.js";
import * as dns from "./dns.js";
import * as resources from "./resources.js";
import * as volumes from "./volumes.js";
import * as envstore from "./envstore.js";
import * as coolifydb from "./coolifydb.js";
import * as sharedvars from "./sharedvars.js";
import * as backups from "./backups.js";
import * as hetzner from "./hetzner.js";
import { provisionServer } from "./provision.js";
import { importFromRender, migratePostgres } from "./migrate.js";
import { scanEnv } from "./envscan.js";
import * as render from "./render.js";
import { generateDeployKeypair, registerDeployKey, createDeployKeyApp, setAppDomain, deployApp, ensureAccountKey, toSshUrl } from "./deploykey.js";
import { computePlans, dbPlans } from "./plans.js";
import { repoKey, verifyWebhookSig } from "./webhook.js";
import { createRenderCredential, listRenderCredentials, getRenderCredential, deleteRenderCredential } from "./db.js";
import { encryptSecret, decryptSecret } from "./secretbox.js";
import { getContainerStats } from "./hostexec.js";
import { meterResources, usageSummary } from "./metering.js";
import { sampleAndStore, sweepMetrics, metricsHistory, demoHistory } from "./metrics.js";
import { placeResourceInEnvironment } from "./placement.js";
import { deriveResourceKind } from "./resourcekind.js";
import { buildProjectDetail } from "./projectview.js";
import { renderStatusHtml } from "./status.js";

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
        req.tokenScope = user.tokenScope || "full";
        // Read-only keys may only make safe requests. This single guard covers
        // every Bearer caller — curl, CI, and the MCP server alike.
        if (req.tokenScope === "read" && req.method !== "GET" && req.method !== "HEAD") {
          return res.status(403).json({ error: "read-only API key" });
        }
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

// Attach the caller's org context. Admin is cross-org (no membership required).
function attachOrgContext(req, res, next) {
  if (req.user?.role === "admin") { req.org = null; return next(); }
  const m = req.user ? getMembership(req.user.id) : null;
  if (!m) return res.status(403).json({ error: "No organization" });
  req.org = { id: m.org_id, role: m.role };
  next();
}

// Gate a route on a capability level. Must run AFTER attachOrgContext.
function requireCapability(level) {
  return (req, res, next) => {
    if (req.user?.role === "admin") return next();
    if (req.org && hasCapability(req.org.role, level)) return next();
    return res.status(403).json({ error: "Insufficient permissions" });
  };
}

// Gate a DEPLOY on the target app's billing state. Resolves the app's OWNING org + plan from
// resource_ownership — independent of who clicks — so an unpaid app can't deploy even via an
// admin; the operator's own project is freed with comp, not an admin bypass. Emits a 402 with a
// machine-readable `code` the client maps to onboarding (see the error responder).
const GATE_MESSAGES = {
  account_suspended: "Account suspended for non-payment — settle the balance to deploy.",
  plan_required: "Assign a plan to this service before you can deploy it.",
  billing_setup_required: "Add a card and start your subscription before deploying.",
};
function requireBillingActive(req, res, next) {
  const row = db.prepare(
    "SELECT org_id, plan_id FROM resource_ownership WHERE type='application' AND coolify_uuid = ?"
  ).get(req.params.id);
  if (!row) return next(); // unowned/unclaimed resource — no org billing to enforce
  const { comp } = getComp(row.org_id);
  const st = subscriptions.getSubState(row.org_id);
  const d = subscriptions.deployGateDecision({
    comp, subStatus: st.status, failedAt: st.failedAt, planId: row.plan_id, nowMs: Date.now(),
  });
  if (d.allow) return next();
  return next(Object.assign(new Error(GATE_MESSAGES[d.code] || "Billing setup required"), { status: d.status, code: d.code }));
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

// Public systems status page (like status.render.com). No auth — it must render
// even when auth/the SPA is broken. Reachable three ways: at /api/status (dev
// Vite-proxied, prod PWA-safe), and served at the ROOT of the dedicated status
// subdomain (STATUS_HOSTNAME, default status.debutdepoly.com) via the host check
// registered below. Overall status = the worst of the live component checks.
// buildStatus never throws — a status page that 500s is worse than useless.
async function buildStatus() {
  const RANK = { operational: 0, degraded: 1, unknown: 2, outage: 3 };
  // Platform infrastructure only — NOT individual customer apps. A customer
  // stopping their own service is not a DebutDeploy incident, so nothing here
  // rolls up per-app running state.
  const components = [
    // This handler is running, so the panel API is up by definition.
    { name: "Control Panel API", status: "operational", note: "Dashboard & API" },
  ];

  // One live Coolify fetch backs both the orchestrator-API row and the servers row.
  let servers = null;
  try {
    servers = await Promise.race([
      coolify.listServers(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
  } catch { /* servers stays null → Coolify unreachable */ }

  components.push({
    name: "Coolify Orchestrator",
    status: servers ? "operational" : "outage",
    note: "Deployment API",
  });

  if (servers) {
    // Every registered server counts — an attached host that's unreachable (incl.
    // a customer's own server) is a real degradation, not something to hide.
    const total = servers.length;
    const reachable = servers.filter((s) => s.reachable !== false).length;
    const critical = servers.filter((s) => (s.disk ?? 0) >= 90 || (s.memory ?? 0) >= 90).length;
    components.push({
      name: "Servers",
      status: total === 0 ? "unknown"
        : reachable === 0 ? "outage"
        : reachable < total || critical > 0 ? "degraded"
        : "operational",
      note: total
        ? `${reachable}/${total} reachable${critical ? ` · ${critical} resource-critical` : ""}`
        : "no servers",
    });
  } else {
    components.push({ name: "Servers", status: "unknown", note: "orchestrator unreachable" });
  }

  // Platform data store (the panel's own DB) — a running API with an unreachable
  // store is still an outage, so probe it directly.
  let dbOk = true;
  try { db.prepare("SELECT 1").get(); } catch { dbOk = false; }
  components.push({ name: "Database", status: dbOk ? "operational" : "outage", note: "Control-plane store" });

  const overall = components.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), "operational");
  return { overall, components, mode: demoMode ? "demo" : "live", checkedAt: Date.now() };
}

async function serveStatus(res) {
  res.type("html").send(renderStatusHtml(await buildStatus()));
}

app.get("/api/status", (_req, res) => serveStatus(res));

// Dedicated status subdomain: on status.debutdepoly.com every path is the status
// page (self-contained HTML, so no static assets needed). Registered before all
// authed routes and the SPA fallback so it wins for that host. Add the hostname as
// a domain on the panel's Coolify app so Traefik routes + certs it to this process.
const STATUS_HOST = (process.env.STATUS_HOSTNAME || "status.debutdepoly.com").toLowerCase();
app.use((req, res, next) => {
  if (req.hostname?.toLowerCase() === STATUS_HOST) return serveStatus(res);
  next();
});

app.get("/api/me", requireAuth, h((req) => {
  const m = req.user.role === "admin" ? null : getMembership(req.user.id);
  return {
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    avatar_url: req.user.avatar_url,
    role: req.user.role,
    orgId: m?.org_id ?? null,
    orgRole: m?.role ?? null,
    platformIp: dns.expectedIp, // IP custom domains must A-record to (from COOLIFY_BASE_URL)
  };
}));

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
    const svc = ensureFound(await coolify.getService(req.params.id), "Service");
    return { ...svc, autoDeploy: getAutoDeploy(req.params.id), notifyPref: getNotifyPref(req.params.id) };
  })
);

// Toggle whether a git push auto-deploys this service (checked in /github/webhook).
app.patch(
  "/api/services/:id/auto-deploy",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const enabled = !!req.body?.enabled;
    setAutoDeploy(req.params.id, enabled);
    return { ok: true, autoDeploy: enabled };
  })
);

// Per-service notification preference: 'default' | 'failures' | 'off' (see notifyOwner).
app.patch(
  "/api/services/:id/notifications",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    setNotifyPref(req.params.id, String(req.body?.pref || "default"));
    return { ok: true, notifyPref: getNotifyPref(req.params.id) };
  })
);

// Notify a resource's OWNER (not the actor) of an event — fire-and-forget.
// Honours the per-service notify preference before deferring to the owner's
// workspace webhook settings (single choke point for both deploy + health events).
const FAILURE_EVENTS = new Set(["deploy.failed", "service.down"]);
function notifyOwner(uuid, event) {
  const owner = db.prepare("SELECT user_id FROM resource_ownership WHERE coolify_uuid = ?").get(uuid);
  if (!owner?.user_id) return;
  const pref = getNotifyPref(uuid);
  if (pref === "off") return;
  if (pref === "failures" && !FAILURE_EVENTS.has(event.type)) return;
  notify({ userId: owner.user_id, event: { ...event, resource_uuid: event.resource_uuid ?? uuid } }).catch(() => {});
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
  attachOrgContext,
  requireCapability("deploy"),
  requireBillingActive,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const force = req.body?.clearCache === true; // "Clear build cache & deploy"
    record(req, "deploy", { resourceType: "application", resourceUuid: req.params.id, metadata: { force } });
    const result = await coolify.deployService(req.params.id, { force });
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
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    record(req, req.params.action, { resourceType: "application", resourceUuid: req.params.id });
    return coolify.controlService(req.params.id, req.params.action);
  })
);

// Live metrics for a service (Coolify has no metrics API — `docker stats` on the
// host via SSH). Owner-scoped. Returns [] if the SSH host isn't configured.
app.get(
  "/api/services/:id/metrics",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    try {
      return { containers: await getContainerStats(req.params.id) };
    } catch (e) {
      return { containers: [], error: e.status === 501 ? "metrics host not configured" : "unavailable" };
    }
  })
);

// Windowed metrics history for the graphs (1h/6h/24h). Owner-scoped; SQL-bucketed.
// Demo mode synthesises a series (no sampler runs in demo).
app.get(
  "/api/services/:id/metrics/history",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const window = String(req.query.window || "1h");
    return demoMode ? demoHistory(window) : metricsHistory(req.params.id, window);
  })
);

// Rename a service (Render-style editable Name). Owner-scoped.
app.patch(
  "/api/services/:id/rename",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
    record(req, "service.rename", { resourceType: "application", resourceUuid: req.params.id, metadata: { name } });
    return coolify.renameService(req.params.id, name);
  })
);

// Update a service's container resource limits (CPU / memory). Owner-scoped.
// Applied on next deploy — Coolify recreates the container with the new cgroup limits.
app.patch(
  "/api/services/:id/resources",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const cpus = req.body?.cpus, memory = req.body?.memory;
    if (cpus === undefined && memory === undefined) {
      throw Object.assign(new Error("cpus or memory is required"), { status: 400 });
    }
    record(req, "service.resources", { resourceType: "application", resourceUuid: req.params.id, metadata: { cpus, memory } });
    return coolify.updateServiceResources(req.params.id, { cpus, memory });
  })
);

// --- deployments & logs ---
// Fleet build queue: active (in_progress + queued) deploys across all apps, for
// the Render-style Build Queue panel. Non-admins see only their org's apps.
app.get(
  "/api/deployments/active",
  requireAuth,
  h(async (req) => {
    const active = await coolify.listActiveDeployments();
    return filterByOwnership(active, req.user, "application");
  })
);

// Cancel a running/queued build. Ownership resolved from the deployment's app
// (looked up server-side — never trust a client-supplied id); admins bypass in
// assertOwns. Coolify returns 500 "cannot be cancelled" if it already finished —
// surface that as a soft 409 rather than a hard error.
app.post(
  "/api/deployments/:uuid/cancel",
  requireAuth,
  mutateGuard,
  h(async (req) => {
    const active = await coolify.listActiveDeployments();
    const dep = active.find((d) => d.deploymentUuid === req.params.uuid);
    if (!dep) throw Object.assign(new Error("Deployment not found or already finished"), { status: 404 });
    assertOwns(req.user, "application", dep.uuid);
    await coolify.cancelDeployment(req.params.uuid);
    record(req, "deploy.cancel", { resourceType: "application", resourceUuid: dep.uuid });
    return { ok: true };
  })
);

app.get(
  "/api/services/:id/deployments",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    // Prefer durable history from Coolify's DB (persists finished deploys); fall
    // back to the REST /deployments list (active-only) if the SSH channel is down.
    try {
      const hist = await coolifydb.getDeploymentHistory(req.params.id);
      if (hist.length) return hist;
    } catch { /* SSH/host issue → fall back */ }
    return coolify.listDeployments(req.params.id);
  })
);

app.get(
  "/api/services/:id/logs",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    // Prefer real runtime logs (docker logs via host); fall back to Coolify's.
    try {
      const lines = await getServiceLogs(req.params.id, { tail: 400 });
      if (lines.length) return { lines };
    } catch { /* host not configured / container down → fall through */ }
    const raw = await coolify.getLogLines(req.params.id).catch(() => []);
    const arr = Array.isArray(raw) ? raw : String(raw || "").split("\n").filter(Boolean);
    return { lines: arr.map((l) => (typeof l === "string" ? { time: null, level: "LOG", message: l } : l)) };
  })
);

// Build/deploy logs for the LATEST deployment. Coolify's REST API never returns
// these, so read them from Coolify's own DB over the SSH channel — this is how you
// see WHY a build failed (the app-logs route only tails a running container).
app.get(
  "/api/services/:id/build-logs",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    try {
      return { lines: await coolifydb.getBuildLogs(req.params.id) };
    } catch (e) {
      return { lines: [], error: e.message };
    }
  })
);

// --- panel-native projects / environments / placement ---
// Admins are first-class users here (the operator owns resources in their own org), so
// resolve everyone to their real org. ensureUserOrg is idempotent (existing org reused).
const orgOf = (user) => getMembership(user.id)?.org_id ?? ensureUserOrg(user.id);

app.get("/api/projects", requireAuth, h(async (req) => listProjects(orgOf(req.user))));

app.post("/api/projects", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => createProject(orgOf(req.user), String(req.body?.name || "").trim() || "Untitled")));

app.get("/api/projects/:id", requireAuth, h(async (req) => {
  const detail = buildProjectDetail(orgOf(req.user), Number(req.params.id)); // sync
  if (!detail) throw Object.assign(new Error("Not found"), { status: 404 });
  return detail;
}));

app.patch("/api/projects/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: renameProject(orgOf(req.user), Number(req.params.id), String(req.body?.name || "").trim()) })));

app.delete("/api/projects/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: deleteProject(orgOf(req.user), Number(req.params.id)) })));

// Master-admin only: reassign a project + its resources to another user's account (by email).
// Metadata move — nothing on Coolify changes. Not org-scoped: admin can move any project.
app.post("/api/admin/projects/:id/transfer", requireAuth, requireAdmin, mutateGuard, h(async (req) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const target = email && getUserByEmail(email);
  if (!target) throw Object.assign(new Error("No user found with that email"), { status: 404 });
  const result = transferProject(Number(req.params.id), target.id);
  record(req, "project.transfer", { metadata: { projectId: Number(req.params.id), toEmail: target.email, moved: result.moved } });
  return result;
}));

app.post("/api/projects/:id/environments", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => createEnvironment(orgOf(req.user), Number(req.params.id), String(req.body?.name || "").trim() || "Untitled")));

app.patch("/api/environments/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: renameEnvironment(orgOf(req.user), Number(req.params.id), String(req.body?.name || "").trim()) })));

app.delete("/api/environments/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => ({ changed: deleteEnvironment(orgOf(req.user), Number(req.params.id)) })));

// Derive a resource's display kind from the live Coolify resource (postgres vs
// key_value for DBs; static_site vs web_service for apps). Best-effort — placement
// falls back to a sane default if the lookup fails.
async function deriveKindFor(type, uuid) {
  try {
    if (type === "database") {
      const d = await coolify.getDatabase(uuid);
      return deriveResourceKind({ type: "database", image: d?.image || d?.type || "" });
    }
    const s = await coolify.getService(uuid);
    return deriveResourceKind({ type: "application", buildPack: s?.runtime, hasDomain: !!s?.domain });
  } catch { return undefined; }
}

// type ∈ application|database; id is the coolify_uuid. Replaces the old /move routes.
app.patch("/api/resources/:type/:id/placement", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => {
    const environmentId = req.body?.environmentId ?? null;
    // Classify the resource so it lands in the right section (only when placing).
    const kind = environmentId == null ? undefined : await deriveKindFor(req.params.type, req.params.id);
    const r = placeResourceInEnvironment({
      user: req.user, type: req.params.type, resourceUuid: req.params.id, environmentId, kind,
    });
    record(req, "resource.place", { resourceType: req.params.type, resourceUuid: req.params.id, metadata: { environmentId, kind } });
    return r;
  }));

// --- env vars ---
app.get(
  "/api/services/:id/envs",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return coolify.listEnvs(req.params.id);
  })
);

// Reveal one stored secret value on demand (owner-scoped). Coolify's API never
// returns env values, so this reads our encrypted mirror (envstore) — only keys
// set through the panel/migration are revealable.
app.get(
  "/api/services/:id/envs/reveal",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const value = envstore.revealEnv(req.params.id, String(req.query.key || ""));
    return { revealable: value != null, value: value ?? null };
  })
);

// Migration check: scan the stored env for values that break off the old PaaS
// (leftover *.onrender.com URLs, provider-internal DB/Redis hosts, RENDER_* vars).
// Reads the envstore mirror (only panel/migration-set keys have plaintext), so it
// works on already-migrated services without unmasking anything to Coolify.
app.get(
  "/api/services/:id/env-scan",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const stored = envstore.storedEnvs(req.params.id); // Map<key,{value,is_secret}>
    const envs = [...stored].map(([key, v]) => ({ key, value: v.value }));
    return { warnings: scanEnv(envs), scannable: envs.length };
  })
);

app.post(
  "/api/services/:id/envs",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
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
  attachOrgContext,
  requireCapability("deploy"),
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

// Full detail for one database (Render-style DB page). Owner-scoped (admin bypasses).
app.get(
  "/api/databases/:uuid",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "database", req.params.uuid);
    const d = await coolify.getDatabase(req.params.uuid);
    // Merge the billing plan so the detail page can show price + preselect the tier.
    const own = db.prepare("SELECT plan_id FROM resource_ownership WHERE type='database' AND coolify_uuid = ?").get(req.params.uuid);
    return { ...d, plan_id: own?.plan_id || null };
  })
);

// Rename a database (Render-style editable Name). Owner-scoped.
app.patch(
  "/api/databases/:uuid/rename",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "database", req.params.uuid);
    const name = String(req.body?.name ?? "").trim();
    if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
    record(req, "database.rename", { resourceType: "database", resourceUuid: req.params.uuid, metadata: { name } });
    return coolify.renameDatabase(req.params.uuid, name);
  })
);

app.post(
  "/api/databases",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("manage"),
  h(async (req) => {
    const userId = req.user.id;
    const { type, name, version, serverUuid } = req.body || {};
    if (!type || !name) throw Object.assign(new Error("type and name are required"), { status: 400 });
    if (serverUuid && req.user.role !== "admin") {
      throw Object.assign(new Error("Only admins can choose a target server"), { status: 403 });
    }
    // projectUuid intentionally NOT accepted here — Coolify-side project is the server default;
    // customer grouping is panel-native via PATCH /api/resources/:type/:id/placement.
    const { uuid } = await databases.createDatabase({ type, name, version, serverUuid });
    assign(uuid, "database", userId);
    const planId = req.body?.plan_id ? String(req.body.plan_id) : null;
    if (planId && planPriceUsd(planId) > 0) {
      db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?")
        .run(planId, "database", uuid);
    }
    record(req, "db.create", { resourceType: "database", resourceUuid: uuid });
    return { uuid };
  })
);

app.post(
  "/api/databases/:id/:action(start|stop)",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
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
  attachOrgContext,
  requireCapability("manage"),
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    await databases.deleteDatabase(req.params.id);
    release("database", req.params.id);
    record(req, "db.delete", { resourceType: "database", resourceUuid: req.params.id });
    return { ok: true };
  })
);

app.delete(
  "/api/services/:id",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("manage"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    await lifecycle.deleteApp(req.params.id);
    release("application", req.params.id);
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
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await lifecycle.setDomain(req.params.id, req.body?.fqdn);
    record(req, "app.domain", { resourceType: "application", resourceUuid: req.params.id, metadata: { fqdn: req.body?.fqdn } });
    return result;
  })
);

// List bound domains with live Verified + Certificate status (Render-style manager).
app.get(
  "/api/services/:id/domains",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    return lifecycle.listDomains(req.params.id);
  })
);

// Remove a custom domain (apex + www) from the service.
app.delete(
  "/api/services/:id/domains",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await lifecycle.removeDomain(req.params.id, req.body?.fqdn);
    record(req, "app.domain.remove", { resourceType: "application", resourceUuid: req.params.id, metadata: { fqdn: req.body?.fqdn } });
    return result;
  })
);

app.get(
  "/api/servers",
  requireAuth,
  requireAdmin,
  h(async () => {
    const servers = await coolify.listServers();
    // Coolify exposes no host specs; enrich with real Hetzner capacity by IP match
    // (best-effort — non-Hetzner hosts like localhost simply keep null specs).
    let hz = [];
    try { hz = (await hetzner.listServersWithCost()).servers || []; } catch { /* optional */ }
    const byIp = new Map(hz.map((s) => [s.ip, s]));
    return servers.map((s) => {
      const h = byIp.get(s.ip);
      return h ? { ...s, cores: h.cores, memoryGb: h.memory, diskGb: h.disk ?? null, serverType: h.type, monthly: h.monthly } : s;
    });
  })
);

app.get(
  "/api/admin/users",
  requireAuth,
  requireAdmin,
  h(() => listUsers())
);

// Master Admin: all client orgs with counts.
app.get("/api/admin/orgs", requireAuth, requireAdmin, h(() => listOrgsWithCounts()));

app.get("/api/admin/orgs/:id", requireAuth, requireAdmin, h((req) => {
  const detail = getOrgDetail(Number(req.params.id));
  if (!detail) throw Object.assign(new Error("Organization not found"), { status: 404 });
  return detail;
}));

// ponytail: legacy alias — Clients page will call /api/admin/orgs; keep one release.
app.get("/api/customers", requireAuth, requireAdmin, h(() => listOrgsWithCounts()));

// --- usage metering (read-only; produced by the health tick) ---
app.get("/api/org/usage", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => {
    // Admin has no single org; a targeted org must go through the admin route.
    if (req.user.role === "admin") {
      throw Object.assign(new Error("Use /api/admin/orgs/:id/usage"), { status: 400 });
    }
    const period = /^\d{4}-\d{2}$/.test(req.query.period) ? req.query.period : currentPeriod();
    return usageSummary(req.org.id, period);
  })
);

app.get("/api/org/usage/current", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => {
    if (req.user.role === "admin") {
      throw Object.assign(new Error("Use /api/admin/orgs/:id/usage"), { status: 400 });
    }
    return usageSummary(req.org.id, currentPeriod());
  })
);

app.get("/api/admin/orgs/:id/usage", requireAuth, requireAdmin, h((req) => {
  const detail = getOrgDetail(Number(req.params.id));
  if (!detail) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const period = /^\d{4}-\d{2}$/.test(req.query.period) ? req.query.period : currentPeriod();
  return usageSummary(Number(req.params.id), period, detail.org.name);
}));

// Master-Admin: read one client org's wallet (balance + recent ledger).
app.get("/api/admin/orgs/:id/wallet", requireAuth, requireAdmin, h((req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  return { balance_pence: walletBalance(orgId), recent_ledger: recentLedger(orgId) };
}));

// Master-Admin: a client's Stripe payment attempts — succeeded AND failed/abandoned.
// Our ledger only records successful credits, so failures live only in Stripe; pull
// them live. Empty (not an error) if the org has no Stripe customer yet.
app.get("/api/admin/orgs/:id/payments", requireAuth, requireAdmin, h(async (req) => {
  const orgId = Number(req.params.id);
  const detail = getOrgDetail(orgId);
  if (!detail) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const row = db.prepare("SELECT stripe_customer_id FROM organizations WHERE id = ?").get(orgId);
  const stripe = stripeClient();
  if (!stripe || !row?.stripe_customer_id) {
    return { customer: row?.stripe_customer_id || null, configured: !!stripe, payments: [] };
  }
  const list = await stripe.paymentIntents.list({ customer: row.stripe_customer_id, limit: 20 });
  return {
    customer: row.stripe_customer_id,
    configured: true,
    payments: list.data.map((p) => ({
      id: p.id,
      amount_pence: p.amount,          // Stripe amount is already minor units (pence for GBP)
      currency: p.currency,
      status: p.status,                // succeeded | requires_payment_method | canceled | processing | …
      created: new Date(p.created * 1000).toISOString(),
      error: p.last_payment_error?.message || null,
    })),
  };
}));

// Master-Admin: a client's resources and their assigned plan + monthly £ (the "Plan" view).
app.get("/api/admin/orgs/:id/resources", requireAuth, requireAdmin, h((req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const rows = listOrgResources(orgId).map((r) => ({
    type: r.type,
    uuid: r.coolify_uuid,
    plan_id: r.plan_id || null,
    monthly_pence: r.plan_id ? usdToPence(planPriceUsd(r.plan_id)) : 0,  // £0 = free until assigned
    created_at: r.created_at,
  }));
  const monthlyTotalPence = rows.reduce((s, r) => s + r.monthly_pence, 0);
  return { resources: rows, monthly_total_pence: monthlyTotalPence };
}));

// Per-service plan view for the billing panel: each owned app with its LIVE Docker limits and
// the plan we detect from them (null when unset/unlimited → the operator picks). Detection is a
// suggestion; nothing is written until the admin assigns via PATCH /api/services/:id/plan.
app.get("/api/admin/orgs/:id/service-plans", requireAuth, requireAdmin, h(async (req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const apps = listOrgResources(orgId).filter((r) => r.type === "application");
  const services = await Promise.all(apps.map(async (r) => {
    let cpus = null, memory = null, name = r.coolify_uuid;
    try {
      const s = await coolify.getService(r.coolify_uuid); // detail carries real limits_cpus/memory
      if (s) { cpus = s.resources?.cpus ?? null; memory = s.resources?.memory ?? null; name = s.name || name; }
    } catch { /* live fetch failed — still list it for manual assignment */ }
    return {
      uuid: r.coolify_uuid, name, cpus, memory,
      plan_id: r.plan_id || null,
      detected_plan_id: r.plan_id ? null : detectComputePlan(cpus, memory),
    };
  }));
  return { services, plans: computePlans().map((p) => ({ id: p.id, name: p.name, priceMo: p.priceMo, vcpu: p.vcpu, ram: p.ram })) };
}));

// Master-Admin: read/update a client's billing information (email/company/VAT for statements).
app.get("/api/admin/orgs/:id/billing-info", requireAuth, requireAdmin, h((req) => {
  const orgId = Number(req.params.id);
  const info = getOrgBillingInfo(orgId);
  if (!info) throw Object.assign(new Error("Organization not found"), { status: 404 });
  return info;
}));

app.patch("/api/admin/orgs/:id/billing-info", requireAuth, requireAdmin, mutateGuard, h((req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const clean = (v) => (v == null ? null : String(v).slice(0, 200).trim() || null);
  setOrgBillingInfo(orgId, {
    email: clean(req.body?.billing_email),
    company: clean(req.body?.billing_company),
    vat: clean(req.body?.billing_vat),
    address: req.body?.billing_address == null ? null : String(req.body.billing_address).slice(0, 500).trim() || null,
  });
  record(req, "billing.info_updated", { metadata: { org_id: orgId } });
  return getOrgBillingInfo(orgId);
}));

// Master-Admin: a downloadable/printable invoice for one client + period (HTML → Save as PDF).
// Not h()-wrapped: returns HTML, not JSON. Same-origin navigation carries the admin session.
app.get("/api/admin/orgs/:id/invoice", requireAuth, requireAdmin, (req, res, next) => {
  try {
    const orgId = Number(req.params.id);
    const detail = getOrgDetail(orgId);
    if (!detail) return res.status(404).json({ error: "Organization not found" });
    const period = /^\d{4}-\d{2}$/.test(req.query.period) ? req.query.period : currentPeriod();
    const planLines = listOrgResources(orgId)
      .filter((r) => r.plan_id)
      .map((r) => ({
        label: `${r.type === "application" ? "service" : r.type} ${String(r.uuid).slice(0, 12)} · ${r.plan_id}`,
        amount_pence: usdToPence(planPriceUsd(r.plan_id)),
      }));
    const planTotalPence = planLines.reduce((s, l) => s + l.amount_pence, 0);
    const summary = usageSummary(orgId, period, detail.org.name);
    const usageLines = (summary.lines || []).map((l) => ({
      label: l.type,
      detail:
        l.type === "compute" ? `${(l.computeHours ?? 0).toFixed(1)} hr`
        : l.type === "disk" ? `${l.allocatedGb ?? 0} GB × ${(l.hours ?? 0).toFixed(0)} hr`
        : `${l.usedGb ?? 0} / ${l.allowanceGb ?? 0} GB`,
      pence: l.pence,
    }));
    const charge = db.prepare(
      "SELECT amount_pence, created_at FROM credit_ledger WHERE org_id = ? AND type = 'hardware_charge' AND period = ? ORDER BY id DESC LIMIT 1"
    ).get(orgId, period);
    const html = renderInvoiceHtml({
      issuer: { name: "DebutDeploy" }, // ponytail: move operator billing details to app_settings when needed
      org: detail.org,
      info: getOrgBillingInfo(orgId),
      period,
      invoiceNo: `INV-${orgId}-${period}`,
      planLines, planTotalPence, usageLines,
      charge: charge || null,
      balancePence: walletBalance(orgId),
    });
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="invoice-${orgId}-${period}.html"`);
    res.type("html").send(html);
  } catch (err) { next(err); }
});

// Master-Admin: manual credit/debit adjustment (comp credit, refund, correction).
// Writes an audited 'adjustment' ledger row; positive = credit, negative = debit.
app.post("/api/admin/orgs/:id/credit", requireAuth, requireAdmin, mutateGuard, h((req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const amountPence = Number(req.body?.amount_pence);
  if (!Number.isInteger(amountPence) || amountPence === 0) {
    throw Object.assign(new Error("amount_pence must be a non-zero integer"), { status: 400 });
  }
  const notes = String(req.body?.notes || "").slice(0, 500) || null;
  creditWallet({ orgId, amountPence, type: "adjustment", notes, createdBy: req.user.id });
  // An adjustment can clear or trigger arrears — recompute advisory status from the new balance.
  db.prepare("UPDATE organizations SET billing_status = ? WHERE id = ?")
    .run(walletBalance(orgId) < 0 ? "arrears" : "ok", orgId);
  record(req, "billing.admin_adjust", { metadata: { org_id: orgId, amount_pence: amountPence, notes } });
  return { ok: true, balance_pence: walletBalance(orgId) };
}));

// Start a service subscription for a client — returns a Stripe Checkout URL (subscription
// mode: collects the card + creates the subscription from the org's plans). Send the URL
// to the client to complete. Charges only after they enter a card in Checkout.
app.post("/api/admin/orgs/:id/subscribe", requireAuth, requireAdmin, mutateGuard, h(async (req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const result = await subscriptions.startSubscriptionCheckout(orgId, {
    successUrl: `${clientOrigin}/clients?subscribe=success`,
    cancelUrl: `${clientOrigin}/clients?subscribe=cancel`,
  });
  record(req, "billing.subscribe_initiated", { metadata: { org_id: orgId } });
  return result;
}));

// A client's subscription-billing view: currency, subscription state, and the current
// usage-credit top-up minimum (max £25, last month's usage).
app.get("/api/admin/orgs/:id/billing", requireAuth, requireAdmin, h((req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const now = new Date();
  const prev = currentPeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const lastMonthPence = (usageSummary(orgId, prev)?.lines || []).reduce((s, l) => s + (l.pence || 0), 0);
  return {
    currency: subscriptions.orgCurrency(orgId),
    subscription: subscriptions.getSubState(orgId),
    min_topup_pence: subscriptions.minTopUpMinor(lastMonthPence),
    balance_pence: walletBalance(orgId),
    lines: subscriptions.subscriptionLinesFor(orgId),
    comp: getComp(orgId), // { comp, discountPct } — drives the admin override controls
  };
}));

// Set a client's billing currency (UK £ vs rest-of-world $).
app.put("/api/admin/orgs/:id/currency", requireAuth, requireAdmin, mutateGuard, h((req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const currency = subscriptions.setOrgCurrency(orgId, req.body?.currency);
  record(req, "billing.currency_set", { metadata: { org_id: orgId, currency } });
  return { currency };
}));

// Operator override: mark an org comp (100% free — skips the deploy gate + zeroes charges) or
// set a 0–99% discount. Reconciles any LIVE Stripe subscription so billing matches the UI.
// Audited because it moves revenue directly.
app.patch("/api/admin/orgs/:id/comp", requireAuth, requireAdmin, mutateGuard, h(async (req) => {
  const orgId = Number(req.params.id);
  if (!getOrgDetail(orgId)) throw Object.assign(new Error("Organization not found"), { status: 404 });
  const next = setComp(orgId, { comp: req.body?.comp, discountPct: req.body?.discountPct });
  await subscriptions.syncSubscriptionDiscount(orgId).catch((e) => {
    // Advisory: state is saved even if the Stripe reconcile fails — surfaced, never silent.
    recordSystem("billing.comp_sync_failed", { metadata: { org_id: orgId, error: e.message } });
  });
  record(req, "billing.comp_changed", { metadata: { org_id: orgId, ...next } });
  return next;
}));

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

// Customer-facing plan catalog: priced presets for the instance-type picker and
// the new-service form. Strips cost/margin (those are admin-only in /api/billing)
// — customers see price + specs only.
app.get(
  "/api/plans",
  requireAuth,
  h(async () => {
    const pub = (p) => ({
      id: p.id, name: p.name, priceMo: p.priceMo, vcpu: p.vcpu, vcpuCount: p.vcpuCount,
      ram: p.ram, ramGb: p.ramGb, disk: p.disk, storage: p.storage, shared: p.shared,
      popular: !!p.popular, note: p.note, renderMo: p.renderMo,
    });
    return { compute: computePlans().map(pub), db: dbPlans().map(pub) };
  })
);

// --- Stripe admin dashboard (operator only) ---------------------------------
// See Stripe data (balance, payments, customers, payouts) and flip test<->live at
// runtime — no Stripe login, no server restart. Keys stay in env; only the active
// mode is stored. GET is read-only; the mode switch is an audited mutation.
app.get("/api/admin/stripe/config", requireAuth, requireAdmin, h(() => stripeadmin.stripeConfig()));
app.get("/api/admin/stripe/overview", requireAuth, requireAdmin, h(() => stripeadmin.stripeOverview()));
app.put("/api/admin/stripe/mode", requireAuth, requireAdmin, mutateGuard, h((req) => {
  const mode = setStripeMode(req.body?.mode); // throws 400 if the target mode has no key
  record(req, "stripe.mode_switch", { metadata: { mode } });
  recordSystem("stripe.mode_switch", { metadata: { mode, by: req.user.email } });
  return { mode };
}));
// Sync the plan catalog (Products + GBP/USD Prices) into the active Stripe mode. No
// charges — creates the price objects subscriptions will use. Run in Test mode first.
app.post("/api/admin/stripe/catalog", requireAuth, requireAdmin, mutateGuard, h(async (req) => {
  const r = await ensureCatalog();
  recordSystem("stripe.catalog_sync", { metadata: { mode: r.mode, count: r.count, by: req.user.email } });
  return r;
}));

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
      if (!getAutoDeploy(s.uuid)) {
        recordSystem("github.push.skipped", { resourceType: "application", resourceUuid: s.uuid, metadata: { name: s.name, repo: repoFull, branch, reason: "auto-deploy off" } });
        continue;
      }
      await coolify.deployService(s.uuid);
      recordSystem("github.push.deploy", { resourceType: "application", resourceUuid: s.uuid, metadata: { name: s.name, repo: repoFull, branch } });
    }
    if (!matches.length) recordSystem("github.push.nomatch", { metadata: { repo: repoFull, branch } });
  } catch (err) {
    recordSystem("github.push.error", { metadata: { repo: repoFull, branch, error: err.message } });
  }
});

// --- Stripe webhook: inbound Stripe call, no session/cookie ------------------
// Outside requireAuth + mutateGuard, same as /github/webhook.
// Signature-verified against the exact raw bytes (req.rawBody captured at the
// express.json verify callback above). Without this check, forged webhooks
// could credit wallets.
app.post("/api/stripe/webhook", (req, res) => {
  const stripe = stripeClient();
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody, req.get("stripe-signature"), stripeWebhookSecret()
    );
  } catch (err) {
    recordSystem("billing.webhook_bad_signature", { metadata: { error: err.message } });
    return res.status(400).json({ error: "bad signature" });
  }
  try {
    handleWebhookEvent(event); // idempotent credit (INSERT OR IGNORE) — safe to retry
    subscriptions.applySubscriptionEvent(event); // subscription lifecycle: paid/failed/cancelled → org billing state
  } catch (err) {
    // 500 so Stripe retries; handler is idempotent so a retry is always safe.
    console.error("stripe webhook handler error:", err.message);
    return res.status(500).json({ error: "handler error" });
  }
  res.json({ received: true });
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

app.post("/api/apps", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"), h(async (req, res) => {
  const userId = req.user.id;
  const { repo, branch, name, port, envs, buildPack, installCommand, buildCommand, startCommand, serverUuid } = req.body || {};

  // 0. Validate input
  if (!repo || !branch || !name || port === undefined || port === null || port === "") {
    throw Object.assign(new Error("repo, branch, name, and port are required"), { status: 400 });
  }
  // Choosing a target server is admin-only (customers deploy to the default host).
  if (serverUuid && req.user.role !== "admin") {
    throw Object.assign(new Error("Only admins can choose a target server"), { status: 403 });
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
  // A chosen server needs its Docker destination resolved (Coolify requires both).
  const placement = serverUuid
    ? { serverUuid, destinationUuid: await coolify.getDefaultDestination(serverUuid) }
    : {};
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
    ...placement,
  });

  // 3. Assign ownership + audit (only after a successful create).
  assign(uuid, "application", userId);
  const planId = req.body?.plan_id ? String(req.body.plan_id) : null;
  if (planId && planPriceUsd(planId) > 0) {
    db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?")
      .run(planId, "application", uuid);
  }
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
  const scope = req.body?.scope === "read" ? "read" : "full";
  const { id, token } = createApiToken(req.user.id, name, scope);
  record(req, "token.create", { metadata: { id, name, scope } });
  // token is returned ONCE; only its hash is stored
  return { id, name, scope, token };
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
  attachOrgContext,
  requireCapability("deploy"),
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
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await resources.setHealthcheck(req.params.id, req.body || {});
    record(req, "app.healthcheck", { resourceType: "application", resourceUuid: req.params.id, metadata: req.body });
    return result;
  })
);

// Save build/runtime config (build+start+pre-deploy commands, root dir, health path).
// The panel's ServiceDetail "Build" section posts here; patchApp maps to Coolify's
// field names and drops empty values (so a blank field never clears an existing one).
app.patch(
  "/api/services/:id/build",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("deploy"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const { rootDirectory, buildCommand, startCommand, preDeployCommand, healthCheckPath, branch } = req.body || {};
    await coolify.patchApp(req.params.id, {
      base_directory: rootDirectory,
      build_command: buildCommand,
      start_command: startCommand,
      pre_deployment_command: preDeployCommand,
      health_check_path: healthCheckPath,
      git_branch: branch,  // deploy a test branch — applied on next deploy
    });
    record(req, "app.build", { resourceType: "application", resourceUuid: req.params.id });
    return { ok: true };
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
  attachOrgContext,
  requireCapability("deploy"),
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
  attachOrgContext,
  requireCapability("manage"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await volumes.addVolume(req.params.id, req.body || {});
    await coolify.deployService(req.params.id); // redeploy so Coolify mounts the volume
    record(req, "volume.add", { resourceType: "application", resourceUuid: req.params.id, metadata: { mountPath: req.body?.mountPath } });
    return { ...result, redeployed: true };
  })
);

app.delete(
  "/api/services/:id/volumes/:vid",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("manage"),
  h(async (req) => {
    assertOwns(req.user, "application", req.params.id);
    const result = await volumes.deleteVolume(req.params.id, req.params.vid);
    await coolify.deployService(req.params.id); // redeploy so Coolify detaches the volume
    record(req, "volume.delete", { resourceType: "application", resourceUuid: req.params.id, metadata: { volumeUuid: req.params.vid } });
    return { ...result, redeployed: true };
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
  attachOrgContext,
  requireCapability("deploy"),
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
  attachOrgContext,
  requireCapability("deploy"),
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
    const { name, serverType, location, image } = req.body || {};
    const result = await provisionServer({ name, serverType, location, ...(image ? { image } : {}) });
    record(req, "server.provision", { metadata: { name, serverType, location, image } });
    return result;
  })
);

// Admin: copy one Postgres into another (pg_dump | psql on the host, version-aware).
// URLs are validated as postgres:// by migratePostgres and passed via ENV, never argv.
app.post(
  "/api/admin/migrate-db",
  requireAuth,
  requireAdmin,
  mutateGuard,
  h(async (req) => {
    const { source, target } = req.body || {};
    if (!source || !target) throw Object.assign(new Error("source and target are required"), { status: 400 });
    let result;
    try {
      result = await migratePostgres({ source, target });
    } catch (e) {
      // Surface the real cause (masked by the generic 500 handler) — no URLs in it.
      return { ok: false, error: e.message, detail: e.detail ? String(e.detail).slice(0, 800) : null };
    }
    record(req, "db.migrate", { metadata: { ok: result?.ok, srcMajor: result?.srcMajor, tgtMajor: result?.tgtMajor } });
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
  attachOrgContext,
  requireCapability("manage"),
  // POST (not GET) because the API key travels in the body; never logged.
  h((req) => render.listServices(resolveRenderKey(req)))
);

// Render Postgres instances — the migration SOURCE picker.
app.post(
  "/api/import/render/databases",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("manage"),
  h((req) => render.listDatabases(resolveRenderKey(req)))
);

app.post(
  "/api/import/render",
  requireAuth,
  mutateGuard,
  attachOrgContext,
  requireCapability("manage"),
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
    // Same gate for reusing an existing Redis: resolving its URL exposes its creds.
    if (target?.redisTarget?.mode === "existing") {
      assertOwns(req.user, "database", target.redisTarget.uuid);
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
  attachOrgContext,
  requireCapability("manage"),
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
    // Same gate for reusing an existing Redis: resolving its URL exposes its creds.
    if (target?.redisTarget?.mode === "existing") {
      assertOwns(req.user, "database", target.redisTarget.uuid);
    }
    const results = [];
    for (const renderServiceId of services) {
      const r = await importFromRender({ renderServiceId, target, userId: req.user.id, apiKey });
      results.push({ renderServiceId, ok: r.ok, appUuid: r.appUuid, steps: r.steps, warnings: r.warnings });
    }
    record(req, "import.render.project", { metadata: { count: services.length, target } });
    return { results };
  })
);

// Provision ONE dedicated box, then import a GROUP of Render services onto it —
// the "isolate a heavy fleet on its own instance" flow (e.g. a browser/ML tier).
// Admin-only: provisioning is real, billed Hetzner infra.
app.post(
  "/api/import/render/dedicated-group",
  requireAuth,
  requireAdmin,
  mutateGuard,
  attachOrgContext,
  requireCapability("manage"),
  h(async (req) => {
    const { services, provision, dbTarget, redisTarget } = req.body || {};
    const apiKey = resolveRenderKey(req);
    if (!Array.isArray(services) || services.length === 0) {
      throw Object.assign(new Error("services (array of Render service ids) is required"), { status: 400 });
    }
    if (!provision?.serverType) {
      throw Object.assign(new Error("provision.serverType is required (e.g. cx43)"), { status: 400 });
    }
    // 1) Provision the single shared box for the whole group.
    const { serverUuid, hetznerId } = await provisionServer({
      name: provision.name || "render-group",
      serverType: provision.serverType,
      location: provision.location,
    });
    // 2) Import each service onto it — dedicated mode + existing serverUuid means no
    // per-service box is provisioned. A failed service cleans up its own app (the box
    // is shared, so it's left for the siblings).
    const target = { mode: "dedicated", serverUuid, dbTarget: dbTarget || { mode: "none" }, redisTarget: redisTarget || { mode: "none" } };
    const results = [];
    for (const renderServiceId of services) {
      const r = await importFromRender({ renderServiceId, target, userId: req.user.id, apiKey });
      results.push({ renderServiceId, ok: r.ok, appUuid: r.appUuid, steps: r.steps, warnings: r.warnings });
    }
    record(req, "import.render.group", { metadata: { count: services.length, serverType: provision.serverType, serverUuid } });
    return { serverUuid, hetznerId, results };
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

// --- organization + team ---
app.get("/api/org", requireAuth, attachOrgContext, h((req) =>
  req.user.role === "admin" ? { id: null, role: "admin" } : { id: req.org.id, role: req.org.role }
));

app.get("/api/org/members", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => listOrgMembers(req.org.id))
);

app.post("/api/org/invites", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const { email = null, role } = req.body || {};
    if (!["owner", "manager", "deployer", "viewer"].includes(role)) {
      throw Object.assign(new Error("valid role is required"), { status: 400 });
    }
    const { id, token } = createInvite({ orgId: req.org.id, email, role, invitedBy: req.user.id });
    record(req, "invite.create", { metadata: { org_id: req.org.id, role, email } });
    // ponytail: return the link for copy-paste; email delivery slots in here later.
    return { id, link: `${clientOrigin}/accept-invite?token=${token}` };
  })
);

app.get("/api/org/invites", requireAuth, attachOrgContext, requireCapability("owner"),
  h((req) => listPendingInvites(req.org.id))
);

app.delete("/api/org/invites/:id", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const changes = deleteInvite(req.org.id, Number(req.params.id));
    if (!changes) throw Object.assign(new Error("Invite not found"), { status: 404 });
    record(req, "invite.revoke", { metadata: { invite_id: Number(req.params.id) } });
    return { ok: true };
  })
);

app.post("/api/org/invites/accept", requireAuth, mutateGuard, h((req) => {
  const { token } = req.body || {};
  const invite = getValidInvite(token);
  if (!invite) throw Object.assign(new Error("Invalid or expired invite"), { status: 400 });
  if (getMembership(req.user.id)) {
    throw Object.assign(new Error("You already belong to an organization"), { status: 409 });
  }
  if (invite.email && invite.email.toLowerCase() !== (req.user.email || "").toLowerCase()) {
    throw Object.assign(new Error("This invite was issued to a different email"), { status: 403 });
  }
  addMembership(req.user.id, invite.org_id, invite.role);
  markInviteAccepted(invite.id, req.user.id);
  record(req, "invite.accept", { metadata: { org_id: invite.org_id, role: invite.role } });
  return { ok: true, role: invite.role };
}));

app.patch("/api/org/members/:userId", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const userId = Number(req.params.userId);
    const { role } = req.body || {};
    if (!["owner", "manager", "deployer", "viewer"].includes(role)) {
      throw Object.assign(new Error("valid role is required"), { status: 400 });
    }
    const target = getMembership(userId);
    if (!target || target.org_id !== req.org.id) throw Object.assign(new Error("Member not found"), { status: 404 });
    if (target.role === "owner" && role !== "owner" && countOrgOwners(req.org.id) <= 1) {
      throw Object.assign(new Error("An organization must keep at least one owner"), { status: 409 });
    }
    setMemberRole(userId, role);
    record(req, "member.role_change", { metadata: { user_id: userId, role } });
    return { ok: true };
  })
);

app.delete("/api/org/members/:userId", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const userId = Number(req.params.userId);
    const target = getMembership(userId);
    if (!target || target.org_id !== req.org.id) throw Object.assign(new Error("Member not found"), { status: 404 });
    if (target.role === "owner" && countOrgOwners(req.org.id) <= 1) {
      throw Object.assign(new Error("An organization must keep at least one owner"), { status: 409 });
    }
    removeMembership(userId);
    record(req, "member.remove", { metadata: { user_id: userId } });
    return { ok: true };
  })
);

// --- billing (prepaid wallet) ---
app.get("/api/billing/wallet", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => {
    // No org (e.g. an admin) → empty wallet instead of dereferencing null → 500.
    if (!req.org?.id) return { balance_pence: 0, billing_status: "ok", recent_ledger: [] };
    const org = db.prepare("SELECT billing_status FROM organizations WHERE id = ?").get(req.org.id);
    return {
      balance_pence: walletBalance(req.org.id),
      billing_status: org?.billing_status || "ok",
      recent_ledger: recentLedger(req.org.id),
    };
  })
);

// Client self-service: the org's own billing information (VAT/company/email).
app.get("/api/org/billing-info", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => getOrgBillingInfo(req.org.id))
);
app.patch("/api/org/billing-info", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const clean = (v) => (v == null ? null : String(v).slice(0, 200).trim() || null);
    setOrgBillingInfo(req.org.id, {
      email: clean(req.body?.billing_email),
      company: clean(req.body?.billing_company),
      vat: clean(req.body?.billing_vat),
      address: req.body?.billing_address == null ? null : String(req.body.billing_address).slice(0, 500).trim() || null,
    });
    record(req, "billing.info_updated", { metadata: { org_id: req.org.id } });
    return getOrgBillingInfo(req.org.id);
  })
);

// Client self-service: download their own invoice (HTML → Save as PDF).
app.get("/api/org/invoice", requireAuth, attachOrgContext, requireCapability("read"), (req, res, next) => {
  try {
    const orgId = req.org.id;
    const detail = getOrgDetail(orgId);
    const period = /^\d{4}-\d{2}$/.test(req.query.period) ? req.query.period : currentPeriod();
    const planLines = listOrgResources(orgId).filter((r) => r.plan_id).map((r) => ({
      label: `${r.type === "application" ? "service" : r.type} ${String(r.uuid).slice(0, 12)} · ${r.plan_id}`,
      amount_pence: usdToPence(planPriceUsd(r.plan_id)),
    }));
    const planTotalPence = planLines.reduce((s, l) => s + l.amount_pence, 0);
    const summary = usageSummary(orgId, period, detail.org.name);
    const usageLines = (summary.lines || []).map((l) => ({
      label: l.type,
      detail: l.type === "compute" ? `${(l.computeHours ?? 0).toFixed(1)} hr`
        : l.type === "disk" ? `${l.allocatedGb ?? 0} GB × ${(l.hours ?? 0).toFixed(0)} hr`
        : `${l.usedGb ?? 0} / ${l.allowanceGb ?? 0} GB`,
      pence: l.pence,
    }));
    const charge = db.prepare("SELECT amount_pence, created_at FROM credit_ledger WHERE org_id = ? AND type = 'hardware_charge' AND period = ? ORDER BY id DESC LIMIT 1").get(orgId, period);
    const html = renderInvoiceHtml({
      issuer: { name: "DebutDeploy" }, org: detail.org, info: getOrgBillingInfo(orgId), period,
      invoiceNo: `INV-${orgId}-${period}`, planLines, planTotalPence, usageLines,
      charge: charge || null, balancePence: walletBalance(orgId),
    });
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="invoice-${period}.html"`);
    res.type("html").send(html);
  } catch (err) { next(err); }
});

app.post("/api/billing/topup", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h(async (req) => {
    const amountPence = Number(req.body?.amount_pence);
    if (!Number.isInteger(amountPence) || amountPence < 100) {
      throw Object.assign(new Error("amount_pence must be an integer >= 100"), { status: 400 });
    }
    // Minimum top-up = max(£25, last month's usage) — protects against tiny top-ups
    // that don't cover a month of metered usage.
    const now = new Date();
    const prev = currentPeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const lastMonthPence = (usageSummary(req.org.id, prev)?.lines || []).reduce((s, l) => s + (l.pence || 0), 0);
    const minPence = subscriptions.minTopUpMinor(lastMonthPence);
    if (amountPence < minPence) {
      throw Object.assign(new Error(`Minimum top-up is £${(minPence / 100).toFixed(2)}`), { status: 400 });
    }
    record(req, "billing.topup_initiated", { metadata: { org_id: req.org.id, amount_pence: amountPence } });
    return createTopupSession({
      orgId: req.org.id, amountPence,
      successUrl: `${clientOrigin}/wallet?topup=success`,
      cancelUrl: `${clientOrigin}/wallet?topup=cancel`,
    });
  })
);

// Auto-recharge settings for the client's own wallet. Read at 'read'; edit at 'owner' (it moves
// money). Returns a client-safe view (no internal lock/token).
app.get("/api/billing/autorecharge", requireAuth, attachOrgContext, requireCapability("read"),
  h((req) => {
    const c = getAutoRecharge(req.org.id);
    return { enabled: c.enabled, thresholdPence: c.thresholdPence, amountPence: c.amountPence, consecutiveFails: c.consecutiveFails };
  }));
app.patch("/api/billing/autorecharge", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h((req) => {
    const c = setAutoRecharge(req.org.id, req.body || {});
    record(req, "billing.autorecharge_set", { metadata: { org_id: req.org.id, enabled: c.enabled, threshold_pence: c.thresholdPence, amount_pence: c.amountPence } });
    return { enabled: c.enabled, thresholdPence: c.thresholdPence, amountPence: c.amountPence, consecutiveFails: c.consecutiveFails };
  }));

app.post("/api/billing/portal", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h(async (req) => {
    const stripe = stripeClient();
    if (!stripe) throw Object.assign(new Error("Stripe is not configured"), { status: 503 });
    record(req, "billing.portal_accessed", {});
    const customer = await getOrCreateStripeCustomer(req.org.id);
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${clientOrigin}/billing` });
    return { url: session.url };
  })
);

// Customer self-serve: start your OWN org's Server+DB subscription (card + subscription in one
// Stripe Checkout). Owner-only — this is the onboarding step the deploy gate directs a blocked
// client to. Needs a priced service assigned first (startSubscriptionCheckout throws otherwise),
// which the gate enforces via the plan_required → billing_setup_required ordering.
app.post("/api/billing/subscribe", requireAuth, mutateGuard, attachOrgContext, requireCapability("owner"),
  h(async (req) => {
    record(req, "billing.subscribe_initiated", { metadata: { org_id: req.org.id, self: true } });
    return subscriptions.startSubscriptionCheckout(req.org.id, {
      successUrl: `${clientOrigin}/services?subscribe=success`,
      cancelUrl: `${clientOrigin}/services?subscribe=cancel`,
    });
  })
);

// Plan assignment — manage-gated. Sets resource_ownership.plan_id (drives monthly charge).
function setResourcePlan(req, type) {
  const uuid = req.params.id;
  assertOwns(req.user, type, uuid); // org-scoped 404 on cross-org
  // Accept either key: the client sends camelCase `planId`, older callers snake_case `plan_id`.
  const raw = req.body?.plan_id !== undefined ? req.body.plan_id : req.body?.planId;
  const planId = raw === null ? null : String(raw || "");
  if (planId && planPriceUsd(planId) === 0) {
    throw Object.assign(new Error("Unknown plan_id"), { status: 400 });
  }
  const changes = db.prepare("UPDATE resource_ownership SET plan_id = ? WHERE type = ? AND coolify_uuid = ?")
    .run(planId || null, type, uuid).changes;
  if (!changes) throw Object.assign(new Error("Resource not found"), { status: 404 });
  record(req, "billing.plan_assigned", { resourceType: type, resourceUuid: uuid, metadata: { plan_id: planId || null } });
  return { ok: true, plan_id: planId || null };
}

app.patch("/api/services/:id/plan", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h((req) => setResourcePlan(req, "application")));

app.patch("/api/databases/:id/plan", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h((req) => setResourcePlan(req, "database")));

// Scale a database's container memory limit (paired with the plan change so the
// tier actually resizes RAM, not just billing). Applied on next restart.
app.patch("/api/databases/:id/resources", requireAuth, mutateGuard, attachOrgContext, requireCapability("manage"),
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    await coolify.updateDatabaseResources(req.params.id, { memory: req.body?.memory });
    record(req, "database.resources", { resourceType: "database", resourceUuid: req.params.id, metadata: { memory: req.body?.memory } });
    return { ok: true };
  }));

// Master-Admin external-cron entry point for the monthly charge. Idempotent per (org, period).
app.post("/api/admin/billing/run-monthly", requireAuth, requireAdmin, h(async () => {
  const { chargeMonthlyHardware, currentPeriod } = await import("./billing.js");
  const period = currentPeriod();
  const orgs = db.prepare("SELECT id FROM organizations").all();
  let charged = 0;
  for (const o of orgs) { if (chargeMonthlyHardware(o.id, period).charged > 0) charged += 1; }
  recordSystem("billing.run_monthly", { metadata: { period, orgs: orgs.length, charged } });
  return { period, orgs: orgs.length, charged };
}));

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
  const body = { error: status >= 500 ? "Internal error" : err.message };
  if (err.code && status < 500) body.code = err.code; // machine-readable client codes (e.g. billing_setup_required)
  res.status(status).json(body);
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
          notifyOwner(t.uuid, {
            type: t.down ? "service.down" : "service.up",
            message: `${t.name}: ${t.from} → ${t.to}`,
          });
        },
      });
      healthSnapshot = snapshot;

      // --- usage metering (best-effort; must never crash the health monitor) ---
      // ponytail: metering INSERT is best-effort inside the health tick; a failed
      // write skips one sample, never throws. Compute-only (uptime); disk/bandwidth
      // are plan-derived at rollup, not sampled here.
      try {
        const [apps, dbs] = await Promise.all([
          coolify.listServices(),
          coolify.listDatabases(),
        ]);
        const resources = [
          ...apps.map((a) => ({ uuid: a.uuid, type: "application", status: a.status })),
          ...dbs.map((d) => ({ uuid: d.uuid, type: "database", status: d.status })),
        ];
        meterResources(resources, new Date().toISOString(), 60);
      } catch (meterErr) {
        console.error("usage metering:", meterErr.message);
      }

      // --- metrics history sampling (best-effort; must never crash the monitor) ---
      // ponytail: one SSH `docker stats` over ALL containers per tick; a failed
      // sample skips one minute, never throws (same stance as metering).
      try {
        await sampleAndStore(new Date().toISOString());
      } catch (mErr) {
        console.error("metrics sampling:", mErr.message);
      }
    } catch (err) {
      console.error("health monitor:", err.message);
    } finally {
      healthRunning = false;
    }
  }, 60_000); // VERIFY LIVE: cadence
  timer.unref?.();
}

// --- monthly hardware charge: hourly tick, idempotent per (org, period) ---
// ponytail: single-process setInterval; the (org, period) guard makes double-fire safe,
// but if the server is down for ALL of the billing day the charge is deferred until it
// next runs (any later tick in the same month still charges once). Reliable upgrade path:
// the admin POST /api/admin/billing/run-monthly hit by an external cron (Hetzner/GitHub Actions).
if (!demoMode && process.env.NODE_ENV !== "test") {
  const runMonthly = async () => {
    const period = currentPeriod();
    for (const o of db.prepare("SELECT id FROM organizations").all()) {
      // chargeMonthlyHardware is idempotent per (org, period), so the hourly tick doubles as an
      // hourly "top up if the wallet dipped below threshold" check — no separate timer needed.
      // ponytail: the future usage-drawdown seam should also call maybeAutoRecharge after debiting.
      try { chargeMonthlyHardware(o.id, period); await maybeAutoRecharge(o.id); }
      catch (err) { console.error("monthly charge / auto-recharge:", o.id, err.message); }
    }
  };
  const billingTimer = setInterval(runMonthly, 60 * 60_000); // hourly; guard makes it idempotent
  billingTimer.unref?.();

  // Suspension sweep: suspend orgs past the 14-day subscription grace or the -£10/-$10
  // wallet overdraft (and restore those whose conditions cleared). Marks state + audits;
  // no destructive action here. ponytail: 6h cadence; a failed sub already has a 14-day
  // runway so nothing is time-critical.
  const runSweep = () => {
    try {
      for (const c of subscriptions.runSuspensionSweep(Date.now())) {
        recordSystem(c.action === "suspended" ? "billing.suspended" : "billing.restored", { metadata: { org_id: c.orgId, reason: c.reason } });
      }
    } catch (err) { console.error("suspension sweep:", err.message); }
    // Metrics retention: drop samples older than 24h (rides this 6h sweep, no new timer).
    try { sweepMetrics(new Date(Date.now() - 24 * 60 * 60_000).toISOString()); }
    catch (err) { console.error("metrics sweep:", err.message); }
  };
  const sweepTimer = setInterval(runSweep, 6 * 60 * 60_000);
  sweepTimer.unref?.();
}

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DebutDeploy API on :${PORT} [${demoMode ? "DEMO data" : "LIVE → Coolify"}]`);
});
