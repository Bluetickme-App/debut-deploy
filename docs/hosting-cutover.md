# Hosting cutover — localhost → app.debutdepoly.com

Take DebutDeploy from a local tool to a public, https, login-protected panel by
**dogfooding it onto its own Coolify** (it's just another app on the Hetzner box).
Env-var names below are the real ones the code reads (`server/auth.js`,
`server/github-app.js`, `server/index.js`).

## 1. DNS — DONE ✅
```
A   app   167.233.206.184
```
`app.debutdepoly.com → 167.233.206.184` (the Hetzner/Coolify host). Traefik issues
the Let's Encrypt cert automatically once the app's domain is set in Coolify
(HTTP-01 — needs only this A record).

## 2. Deploy the panel onto Coolify
- New app in Coolify from this repo (private GitHub App source).
- Build: `npm run build` (produces `client/dist`). Start: `npm start` (`node server/index.js`).
  Express now serves `client/dist` + SPA fallback, so the panel is **one process**.
- Set the app's **domain = `app.debutdepoly.com`**, port `8787` (or set `PORT`).
- Coolify + Traefik terminate TLS; `app.set("trust proxy", 1)` is already in code so
  secure cookies + real client IP work behind the proxy.

## 3. Environment variables (Coolify → the app's Env)
```
NODE_ENV=production                         # secure cookies + fail-fast on missing secrets
DEMO_MODE=false
SESSION_SECRET=<64+ random chars>           # REQUIRED in prod (auth.js throws without it)
ADMIN_EMAILS=encodeshared@gmail.com,debutwebconsultants@gmail.com   # who is admin
CLIENT_ORIGIN=https://app.debutdepoly.com
OAUTH_CALLBACK_BASE=https://app.debutdepoly.com
ALLOWED_ORIGINS=https://app.debutdepoly.com

# already configured (carry over from server/.env)
COOLIFY_BASE_URL=http://167.233.206.184:8000
COOLIFY_API_TOKEN=<token>
HETZNER_API_KEY=<token>
# RENDER_API_KEY=<token>                     # optional; importer reads live when set

# OAuth login providers
GOOGLE_CLIENT_ID=<...>
GOOGLE_CLIENT_SECRET=<...>
GITHUB_CLIENT_ID=<...>                       # "Sign in with GitHub" OAuth app
GITHUB_CLIENT_SECRET=<...>

# GitHub App (repo deploys + multi-account)
GITHUB_APP_ID=<...>
GITHUB_APP_SLUG=<...>
GITHUB_APP_PRIVATE_KEY=<PEM>
GITHUB_APP_CLIENT_ID=<...>                   # enables the user-OAuth multi-account flow
GITHUB_APP_CLIENT_SECRET=<...>
```
Note: `DATABASE_FILE` defaults to `server/data/debut.db` (SQLite). Put it on a
Coolify **persistent volume** so it survives redeploys. (SQLite → Postgres is a
later durability step; fine for launch.)

## 4. Update the OAuth provider configs (the localhost → https swap)
- **Google** (console.cloud.google.com → Credentials): authorized redirect URI
  `https://app.debutdepoly.com/auth/google/callback`.
- **GitHub OAuth app** (Settings → Developer settings → OAuth Apps): callback
  `https://app.debutdepoly.com/auth/github/callback`.
- **GitHub App** (Settings → Developer settings → GitHub Apps → your app):
  - Homepage URL: `https://app.debutdepoly.com`
  - **Setup URL** + **Callback URL**: `https://app.debutdepoly.com/github/setup`
  - Tick **"Request user authorization (OAuth) during installation"** → this is
    what activates the multi-account-in-one-connect flow.

## 5. Verify (no demo auto-login in prod — real OAuth required)
- Load `https://app.debutdepoly.com` → redirected to login.
- Sign in with Google AND GitHub; confirm your email is admin (`ADMIN_EMAILS`).
- Connect GitHub → repos list aggregates across installations.
- Do one real deploy; check the **Activity** feed + a service's **Events** tab.
- Set a webhook in **Notifications** (a private URL is rejected — SSRF guard).

## Caveats
- Single box: the panel shares the Hetzner host with customer sites. Fine to
  launch; move the panel to its own box as the fleet grows (the 20-site plan).
- SQLite is single-instance; don't run >1 panel replica until it's on Postgres.
