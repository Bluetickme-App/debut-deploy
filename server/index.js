import "dotenv/config";
import express from "express";
import cors from "cors";
import * as coolify from "./coolify.js";
import { setupAuth } from "./auth.js";
import { assertOwns, assign, ownedUuids } from "./ownership.js";
import { listUsers } from "./db.js";
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

// --- error handler ---
app.use((err, _req, res, _next) => {
  console.error(err.message, err.detail || "");
  res.status(err.status || 500).json({ error: err.message, detail: err.detail });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DebutDeploy API on :${PORT} [${demoMode ? "DEMO data" : "LIVE → Coolify"}]`);
});
