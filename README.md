# DebutDeploy

A self-hosted, Render-style control panel for your infrastructure — backed by **Coolify** running on **Hetzner**.

It mimics the Render dashboard UX (services list, one-click deploys, live build logs, environment variable editor, databases & server metrics) while talking to Coolify's REST API under the hood. The goal: keep the workflow your team already knows, drop the bill from ~$624/mo to ~£20/mo.

```
┌──────────────┐     /api      ┌──────────────┐   /api/v1    ┌──────────────┐
│  React UI    │ ────────────▶ │  Express     │ ───────────▶ │  Coolify     │
│  (Render     │  ◀──────────  │  proxy       │  ◀─────────  │  on Hetzner  │
│   look)      │   JSON        │  (this repo) │   JSON       │              │
└──────────────┘               └──────────────┘              └──────────────┘
```

The Express layer exists so your Coolify API token **never reaches the browser** and so you can reshape Coolify's responses into the tidy objects the UI expects.

---

## Quick start

```bash
# 1. Install everything (root, server, client)
npm run setup

# 2. Run both the API proxy and the UI together
npm run dev
```

- UI:  http://localhost:5173
- API: http://localhost:8787

For local development, copy `server/.env.example` to `server/.env`. It ships with `DEMO_MODE=true`, which boots the server with sample data that mirrors the MFLH / TikTok / CryptoPilot / Aurora / Bluetick / QrConnect stack from your migration guide.

## Going live against Coolify

Copy `server/.env.example` to `server/.env` and fill in:

```
COOLIFY_BASE_URL=https://coolify.yourdomain.com   # your Coolify instance
COOLIFY_API_TOKEN=your-team-scoped-bearer-token    # Coolify → Keys & Tokens → API tokens
DEMO_MODE=false
```

Generate the token in Coolify under **Keys & Tokens → API tokens** (give it read + deploy abilities). Restart the server and the dashboard now reflects your real services.

## What maps to what

| Render concept        | DebutDeploy screen      | Coolify API                                   |
|-----------------------|-------------------------|-----------------------------------------------|
| Services list         | Dashboard               | `GET /applications`, `GET /services`          |
| Manual Deploy         | Deploy button           | `POST /deploy?uuid=`                          |
| Deploy/build logs     | Service → Logs tab      | `GET /deployments`, `GET /applications/{u}/logs` |
| Environment           | Service → Environment   | `GET/POST/PATCH/DELETE /applications/{u}/envs` |
| Databases             | Databases               | `GET /databases`                              |
| Metrics               | Databases / server cards| `GET /servers`, `GET /servers/{u}/resources`  |

## Project layout

```
debut-deploy/
├── server/        Express proxy + Coolify client + demo fixtures
│   ├── index.js
│   ├── coolify.js
│   ├── fixtures.js
│   └── routes/
└── client/        React + Vite + Tailwind SPA (the Render-style UI)
    └── src/
        ├── pages/        Dashboard, ServiceDetail, Databases
        ├── components/    Sidebar, StatusBadge, LogStream, EnvEditor...
        └── lib/api.js
```

## Notes & next steps

- **Auth**: this scaffold has no login yet — add one before exposing it publicly (the proxy is the right place for it).
- **Live logs**: demo mode fakes a streaming log; against Coolify you can upgrade `/api/services/:id/logs` to Server-Sent Events.
- **Hetzner**: Coolify can provision Hetzner boxes via its API — a "Servers" create flow is a natural follow-up.
