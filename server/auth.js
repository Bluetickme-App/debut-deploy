import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { createUser, getIdentity, getUserByEmail, getUserById, getUserByIdentity, seedUser, upsertIdentity } from "./db.js";
import { record } from "./audit.js";

const SQLiteStore = connectSqlite3(session);

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

function userPayload(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    role: user.role,
  };
}

function readVerifiedEmail(provider, profile) {
  if (provider === "google") {
    const verified = profile?._json?.email_verified === true || profile?._json?.email_verified === "true";
    const email = profile?.emails?.[0]?.value;
    if (verified && email) return email.toLowerCase();
    return null;
  }

  if (provider === "github") {
    const emails = Array.isArray(profile?.emails) ? profile.emails : [];
    const chosen =
      emails.find((item) => item.primary && item.verified) ||
      emails.find((item) => item.verified) ||
      null;
    return chosen?.value?.toLowerCase() || null;
  }

  return null;
}

// passport-github2 doesn't reliably include primary/verified flags on
// profile.emails, so fall back to GitHub's /user/emails API with the token
// (granted via the user:email scope).
async function fetchGithubVerifiedEmail(accessToken) {
  try {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "DebutDeploy",
      },
    });
    if (!res.ok) return null;
    const emails = await res.json();
    if (!Array.isArray(emails)) return null;
    const chosen = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
    return chosen?.email?.toLowerCase() || null;
  } catch {
    return null;
  }
}

async function finishLogin(req, res, user, clientOrigin) {
  const destination = req.session?.returnTo || clientOrigin || "/";
  await new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.login(user, (loginErr) => {
        if (loginErr) return reject(loginErr);
        resolve();
      });
    });
  });
  record(req, "login");
  res.redirect(destination);
}

function providerStrategyEnv(provider, suffix) {
  return process.env[`${provider.toUpperCase()}_${suffix}`] || "";
}

function strategyReady(provider) {
  return Boolean(providerStrategyEnv(provider, "CLIENT_ID") && providerStrategyEnv(provider, "CLIENT_SECRET"));
}

export function setupAuth(app, { demoMode, clientOrigin }) {
  const adminEmails = new Set(splitList(process.env.ADMIN_EMAILS));
  const sessionSecret = process.env.SESSION_SECRET || "";
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const sessionDir = path.join(serverDir, "data");
  fs.mkdirSync(sessionDir, { recursive: true });

  if (!demoMode && !sessionSecret) {
    throw error(500, "SESSION_SECRET is required outside demo mode");
  }

  app.use(
    session({
      store: new SQLiteStore({
        db: "sessions",
        dir: sessionDir,
        createDirIfNotExists: true,
        concurrentDB: true,
      }),
      // No guessable fallback: outside demo mode SESSION_SECRET is required (throws
      // above); in demo/dev we mint a random per-boot secret so cookies can't be
      // forged from a public constant (sessions just don't survive a restart).
      secret: sessionSecret || randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => done(null, getUserById(id)));

  if (!demoMode) {
    if (!strategyReady("google") || !strategyReady("github")) {
      throw error(500, "OAuth credentials are required outside demo mode");
    }

    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${process.env.OAUTH_CALLBACK_BASE || "http://localhost:8787"}/auth/google/callback`,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = readVerifiedEmail("google", profile);
            if (!email) return done(error(401, "Google account must have a verified email"));

            const existing = getUserByIdentity("google", profile.id);
            if (existing) {
              return done(null, existing);
            }

            let user = getUserByEmail(email);
            if (!user) {
              user = createUser({
                email,
                name: profile.displayName || profile.name?.givenName || email,
                avatar_url: profile.photos?.[0]?.value || null,
                role: adminEmails.has(email) ? "admin" : "customer",
              });
            }

            upsertIdentity({ provider: "google", provider_user_id: profile.id, user_id: user.id });
            return done(null, user);
          } catch (err) {
            return done(err);
          }
        }
      )
    );

    passport.use(
      new GitHubStrategy(
        {
          clientID: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          callbackURL: `${process.env.OAUTH_CALLBACK_BASE || "http://localhost:8787"}/auth/github/callback`,
          scope: ["user:email"],
        },
        async (accessToken, _refreshToken, profile, done) => {
          try {
            let email = readVerifiedEmail("github", profile);
            if (!email) email = await fetchGithubVerifiedEmail(accessToken);
            if (!email) return done(error(401, "GitHub account must have a verified primary email"));

            const existing = getUserByIdentity("github", profile.id);
            if (existing) {
              return done(null, existing);
            }

            let user = getUserByEmail(email);
            if (!user) {
              user = createUser({
                email,
                name: profile.displayName || profile.username || email,
                avatar_url: profile.photos?.[0]?.value || null,
                role: adminEmails.has(email) ? "admin" : "customer",
              });
            }

            upsertIdentity({ provider: "github", provider_user_id: profile.id, user_id: user.id });
            return done(null, user);
          } catch (err) {
            return done(err);
          }
        }
      )
    );
  }

  const demoUser = demoMode
    ? seedUser({
        email: "demo@debutdeploy.local",
        name: "Demo Admin",
        avatar_url: null,
        role: "admin",
      })
    : null;

  if (demoMode) {
    app.use((req, _res, next) => {
      req.user = demoUser;
      next();
    });
  }

  function requireAuth(req, res, next) {
    if (demoMode) {
      req.user = demoUser;
      return next();
    }
    if (req.isAuthenticated?.() || req.user) return next();
    return res.status(401).json({ error: "Unauthorized" });
  }

  function requireAdmin(req, res, next) {
    if (demoMode) {
      req.user = demoUser;
      return next();
    }
    if (req.user?.role === "admin") return next();
    return res.status(403).json({ error: "Forbidden" });
  }

  // Only same-origin/relative redirects survive — blocks OAuth open-redirect
  // (?returnTo=https://evil.example) used for post-login phishing.
  function safeReturnTo(raw) {
    if (!raw) return clientOrigin || "/";
    try {
      const u = new URL(raw, clientOrigin || "http://localhost");
      const base = new URL(clientOrigin || "http://localhost");
      return u.origin === base.origin ? u.pathname + u.search : clientOrigin || "/";
    } catch {
      return clientOrigin || "/";
    }
  }

  function setReturnTo(req, _res, next) {
    req.session.returnTo = safeReturnTo(req.query.returnTo);
    next();
  }

  app.get("/auth/google", setReturnTo, passport.authenticate("google", { scope: ["profile", "email"], session: true }));
  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login?error=oauth", session: true }),
    async (req, res, next) => {
      try {
        await finishLogin(req, res, req.user, clientOrigin);
      } catch (err) {
        next(err);
      }
    }
  );

  app.get("/auth/github", setReturnTo, passport.authenticate("github", { scope: ["user:email"], session: true }));
  app.get(
    "/auth/github/callback",
    passport.authenticate("github", { failureRedirect: "/login?error=oauth", session: true }),
    async (req, res, next) => {
      try {
        await finishLogin(req, res, req.user, clientOrigin);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post("/auth/logout", requireAuth, (req, res, next) => {
    const origin = req.get("origin") || req.get("referer") || "";
    let originHost = "";
    try {
      originHost = origin ? new URL(origin).origin : "";
    } catch {
      originHost = "";
    }
    if (!demoMode && originHost && originHost !== clientOrigin) {
      return res.status(403).json({ error: "Forbidden" });
    }
    record(req, "logout");
    if (demoMode) return res.json({ ok: true });
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => res.json({ ok: true }));
    });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json(userPayload(req.user));
  });

  return { requireAuth, requireAdmin, demoMode, demoUser, userPayload };
}
