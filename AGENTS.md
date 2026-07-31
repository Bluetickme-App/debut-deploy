# DebutDeploy

Render-style control panel that proxies Coolify's REST API (running on Hetzner).
React+Vite UI → Express proxy (this repo's server) → Coolify `/api/v1`.
The Express layer exists so the Coolify token never reaches the browser.

## Commands
```bash
npm run setup     # install root + server + client
npm run dev       # run API (:8787) + UI (:5173) together via concurrently
npm run dev:api   # server only (node --watch)
npm run dev:ui    # client only (vite)
npm run build     # build client (vite)
npm start         # production server (node server/index.js)
```
UI: http://localhost:5173 · API: http://localhost:8787

## Architecture
- `server/` — Express proxy. `index.js` defines all routes inline (no `routes/` dir
  despite the README); `coolify.js` is the Coolify client + normalisers; `fixtures.js`
  is demo data.
- `client/` — React + Vite + Tailwind v4 SPA. `pages/`, `components/`, `lib/api.js`.
- Vite proxies `/api` → `:8787` (see `client/vite.config.js`).

## Demo vs live (important)
- `isDemo()` is read ONCE at module load (`server/coolify.js`). Changing `server/.env`
  requires a **server restart**.
- Demo mode is the default; it also auto-engages when `COOLIFY_BASE_URL` or
  `COOLIFY_API_TOKEN` is missing, even if `DEMO_MODE=false`.
- Every method in `coolify.js` branches on `isDemo()`: a fixture path and a live path.
  Adding an endpoint = add both + a normaliser. Keep routes in `index.js` thin.

## Conventions
- ESM everywhere (`"type": "module"`); use `import`, not `require`.
- Coolify status is compound, e.g. `"running:healthy"` → split into `status`/`health`.
- Tailwind v4 via `@tailwindcss/vite` — no `tailwind.config.js`.
- Live config lives in `server/.env` (copy from `server/.env.example`); it's gitignored.
