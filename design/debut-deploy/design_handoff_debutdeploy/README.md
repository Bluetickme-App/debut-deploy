# Handoff: DebutDeploy — UI redesign

## Overview
DebutDeploy is a developer cloud-hosting control panel — a Render.com-style product that
deploys apps and databases to a customer's **own** servers (it drives **Coolify** running on
**Hetzner** hardware). This bundle is a **high-fidelity UI redesign** covering the app shell and
five screens, plus two newly designed features: **Projects** and **Variable Groups**.

The underlying product functionality already exists — this is a **visual + UX redesign only**.

## About the design files
The files in this bundle are **design references created in HTML**, not production code to ship.
They use a lightweight in-house "Design Component" format: each screen is a `*.dc.html` file with
an inline `<x-dc>` template and a `class Component extends DCLogic { renderVals() {…} }` logic block,
rendered by the shared `support.js` runtime.

**Your task:** recreate these designs in the target codebase's existing environment (React, Vue,
Svelte, etc.) using its established component library, styling approach, and conventions. If no
front-end environment exists yet, choose the most appropriate framework and implement there.
Do **not** copy `.dc.html`/`support.js` into production — they are a visual reference.

**To view the designs live:** open any `.dc.html` in a browser with `support.js` in the same folder.
Every screen accepts a `theme` prop of `"light"` (default) or `"dark"`.

## Fidelity
**High-fidelity.** Final colors, Geist typography, spacing, radii, shadows, and working interactions
(tab switching, theme toggle, modals, dropdowns, reveal/assign actions, wizard-style state). Recreate
the UI faithfully, mapping these tokens onto the codebase's primitives.

---

## Design tokens

### Typography
- **UI + display:** `Geist` (Google Fonts). Weights used: 400, 500, 600, 700. Headings/wordmark 600–700
  with `letter-spacing: -0.01em`. Body 400–500.
- **Monospace:** `Geist Mono` (Google Fonts), weights 400/500/600 — used for identifiers, repo paths,
  SHAs, env keys/values, connection strings, secrets, and terminal logs.
- Google Fonts URL:
  `https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap`

### Color tokens
Everything is driven by CSS custom properties set per-theme on the screen's root element. Inner
elements reference `var(--token)`. Provide both themes.

**Light theme**
| Token | Value | Token | Value |
|---|---|---|---|
| `--bg` | `#f5f6f8` | `--accent` | `#2563eb` |
| `--surface` | `#ffffff` | `--accent-hover` | `#1d4ed8` |
| `--surface-2` | `#f3f5f7` | `--accent-contrast` | `#ffffff` |
| `--border` | `#e6e8ec` | `--accent-soft` | `#eaf0fe` |
| `--border-strong` | `#d6dae0` | `--accent-text` | `#1d4ed8` |
| `--text` | `#0d1117` | `--ok` / `--ok-soft` / `--ok-text` | `#16a34a` / `#e7f6ec` / `#15803d` |
| `--text-muted` | `#5a6573` | `--warn` / `--warn-soft` / `--warn-text` | `#d97706` / `#fdf1dc` / `#b45309` |
| `--neutral-soft` | `#eef0f3` | `--err` / `--err-soft` / `--err-text` | `#dc2626` / `#fdeaea` / `#b91c1c` |
| `--neutral-text` | `#475569` | `--ring` | `rgba(37,99,235,.35)` |
| `--shadow` | `0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.10)` | `--shadow-lg` | `0 10px 30px -10px rgba(16,24,40,.18)` |

**Dark theme**
| Token | Value | Token | Value |
|---|---|---|---|
| `--bg` | `#0a0c11` | `--accent` | `#3b82f6` |
| `--surface` | `#11141b` | `--accent-hover` | `#5b9bff` |
| `--surface-2` | `#171b24` | `--accent-contrast` | `#ffffff` |
| `--border` | `#222734` | `--accent-soft` | `rgba(59,130,246,.16)` |
| `--border-strong` | `#2d3442` | `--accent-text` | `#7eb0ff` |
| `--text` | `#e7eaf0` | `--ok` / `--ok-soft` / `--ok-text` | `#22c55e` / `rgba(34,197,94,.15)` / `#4ade80` |
| `--text-muted` | `#8b94a3` | `--warn` / `--warn-soft` / `--warn-text` | `#f59e0b` / `rgba(245,158,11,.15)` / `#fbbf24` |
| `--neutral-soft` | `rgba(255,255,255,.07)` | `--err` / `--err-soft` / `--err-text` | `#ef4444` / `rgba(239,68,68,.15)` / `#f87171` |
| `--neutral-text` | `#9aa3b2` | `--ring` | `rgba(59,130,246,.45)` |
| `--shadow` | `0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.5)` | `--shadow-lg` | `0 16px 40px -12px rgba(0,0,0,.6)` |

Terminal/log surface stays dark in **both** themes: bg `#0b0e14`, text `#cdd6e4`, timestamps `#5b6678`,
levels INFO `#6ea8fe`, OK `#34d77a`, WARN `#f5b945`, ERROR `#f87171`.

### Radii, spacing, sizing
- Radius: cards/panels **13–14px**, inputs/buttons/select **8–9px**, pills/chips **999px**, icon tiles 6–11px.
- Sidebar width **240px**; topbar height **56px**; default content gutter **26–30px**.
- Status dot 6–7px; meter bar track height ~6px.
- Hit targets ≥ 30px; primary buttons ~38px tall.
- Transitions: **150ms** on background / border / color / transform. Card hover lifts `translateY(-2px)` + `--shadow-lg`.

### Status semantics (pills)
`running · healthy` → ok (green) · `building` → warn (amber, pulsing dot) · `exited · failed` → err (red) ·
`stopped` → neutral. Pulse keyframe: `@keyframes dd-pulse{0%,100%{opacity:1}50%{opacity:.3}}`.
Skeleton shimmer: `@keyframes dd-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`.

---

## App shell (`AppShell.dc.html`)
Persistent chrome wrapping every authenticated screen. Props: `theme`, `activeNav`, `crumb`, `env`
(`live`/`demo`), `userName`, `userRole`, `admin`.

- **Sidebar (240px, `--surface`, right border):**
  - Brand: 30px rounded-square "D" mark in `--accent` + wordmark "Debut" (`--text`) + "Deploy" (`--accent-text`).
  - **Project switcher** (button): colored 22px tile + first letter, label "PROJECT" + active project name, up/down chevron.
    Opens a dropdown listing projects (active gets a check) + a "New project" row. Switching updates the active project.
  - **Nav** (icon + label; active item = `--accent-soft` bg + `--accent-text`): Projects, Services, Infrastructure,
    New Service, New Database, Activity, Notifications. Then an **ADMIN** divider: Servers, Shared Vars (Variable Groups),
    Import from Render.
  - Footer: `v1.4.2 · Coolify 4.0` (muted).
- **Topbar (56px):** left = breadcrumb (`crumb`). Right cluster = environment pill (`● Live · Coolify` green / `● Demo · Coolify` amber),
  theme toggle (moon in light / sun in dark — flips theme live), user chip (gradient avatar w/ initials + name + role + chevron),
  logout icon button (hover → `--err-soft`).
- Root is a 240px + fluid flex row, **820px tall**, rounded 14px, `--shadow-lg`; content area scrolls.

## Screens

### 1. Login (`Login.dc.html`) — unauthenticated, no shell
Two-column, 1180×760, rounded 14px. **Left:** centered 372px column — D mark + wordmark, a `--surface` card
(radius 16, `--shadow-lg`) with "Welcome back", tagline "Deploy apps & databases to your own cloud.", and two
secondary OAuth buttons (**Continue with Google** w/ 4-color G logo, **Continue with GitHub** w/ mark), a Terms/Privacy
footnote; below the card an invite-only beta note. **Right (52%):** brand panel with a fixed blue→indigo radial gradient,
faint grid overlay (masked), headline "Ship to your own cloud, on your own terms.", a frosted-glass floating service card
(api-gateway · running·healthy · api.mflh.io), and two feature pills (GitHub-native, Your data/your servers). No email/password.

### 2. Services (`Services.dc.html`)
Dashboard listing deployed apps. Header "Services" + subtitle + primary **New Service** button. Toolbar: search input,
status `<select>`, a **grid/list** view toggle, and a (demo-only) **Populated / Empty / Loading** preview switch.
- **Grid:** 3-col cards. Each: name (ellipsized), status pill, domain as `--accent-text` link w/ external-arrow (or "Internal service"),
  divider, repo·branch in mono w/ git-branch icon, runtime chip (colored dot: Node `#4f9d4f`, Go `#00acd7`, Python `#ffd43b`, Static `#94a3b8`),
  and "last deploy" time. Hover lifts.
- **List:** table with columns Service / Status / Domain / Runtime / Last deploy.
- **Empty:** dashed card, layers icon in `--accent-soft`, "No services yet", CTA.
- **Loading:** 6 shimmer skeleton cards.
Sample data (8 services, mixed statuses) is in the file's `renderVals()`.

### 3. Service detail (`ServiceDetail.dc.html`)
Header: back link, app name + status pill, domain link, actions **Deploy** (primary, rocket icon), **Stop**, **Restart**.
Meta row: repo·branch, runtime, server·region, last deploy. **Underline tab bar** (active = `--accent` border-bottom) with 5 tabs:
- **Deployments:** "Redeploy latest" + a list of deploys — green check / red X status tile, commit message, `sha · branch · trigger` in mono,
  duration, relative time, and a **Live** pill (current) or **Rollback** button (past successes) / **Failed** label.
- **Logs:** terminal panel — dark in both themes; header has a pulsing "Live tail" + Copy/Wrap; monospace lines with colored timestamps/levels and a blinking cursor.
- **Environment:** an **Attached variable groups** card (chips: `shared-prod · 3 vars`, `stripe-keys · 2 vars · secrets`, … + "Attach group"),
  then the service's own key/value table (mono inputs; values masked, **Reveal values** toggle; Paste .env; Add variable; per-row delete).
- **Events:** vertical timeline; colored dots — `Service went DOWN` red, `Service recovered` green, others accent; each w/ detail, actor, time.
- **Settings:** Build & deploy (build-pack select, exposed port, build/start commands), Custom domain (input + Verify DNS + DNS-verified & TLS-active pills),
  Resources (CPU/memory selects), and a red **Danger zone** card with **Delete service**.

### 4. Projects (`Projects.dc.html`) — NEW
A Project is a **folder/grouping** that owns a set of services, databases, and servers; the app is scoped to the active project
(see sidebar switcher). Header "Projects" + subtitle + **New Project** button. **2-col grid** of project cards: colored folder
tile, name, environment badge (Production = ok / Staging = warn), description, resource counts (services / databases / servers
with icons), stacked member avatars, "Updated …". Hover lifts; whole card is the entry point.
**New Project modal:** name input, **color** swatch picker (selected swatch gets a ring), description, **Production/Staging** segmented
control, Cancel / Create. Backdrop dims the content area.

### 5. Variable Groups (`SharedVars.dc.html`, nav "Shared Vars") — NEW / extends shared vars
Admin page for **reusable sets of env variables you attach to services**. Header "Variable Groups" + **Reveal values** toggle + **New Group**.
- **New Group** reveals an inline create card: name (mono), scope select (Global / Project: …), a variables mini-table (KEY / value / Secret checkbox), Add variable, Cancel / Create group.
- **Group list:** each group is an expandable card — expand chevron, `{}` tile, group name (mono), scope badge (Global = neutral / Project = accent), variable count, a "secrets" lock if any secret, and "Attached to N services".
  - Expanded: a KEY/VALUE table (secret values masked unless Reveal is on; each secret row tagged), then **Attached to services** — removable service chips (● dot + name + ✕) and an **Assign to service** button that opens a checklist dropdown of all services (checked = attached). Toggling assigns/unassigns.

---

## Interactions & state
- **Theme** is per-screen state initialized from the `theme` prop; the topbar toggle flips all tokens live.
- **Service detail:** `tab` (deployments|logs|environment|events|settings); `reveal` (env masking).
- **Projects:** `modalOpen`, selected `color`, `env` (prod|staging). Sidebar switcher: `switcherOpen`, active `project` index.
- **Variable Groups:** `reveal`, `creating`, `expanded` (per-group), `assignOpen` (which group's dropdown), and `assigned` (group → service list; mutated by chip ✕ and the assign checklist).
- All hover/active/focus states are specified inline (`style-hover`, `style-focus`). Focus rings use `--ring`.

## Icons
All UI icons are inline **Lucide-style** strokes (`stroke="currentColor"`, width 1.75–2, round caps/joins) — substitute your icon
library's equivalents (layers, database/cylinder, square-plus, activity, bell, server-rack, braces, download, git-branch,
rocket, refresh, eye, trash, lock, check, chevrons, external-arrow). The Google "G" (4-color) and GitHub mark are exact brand
SVGs for the OAuth buttons. Database engine tiles are brand-colored squares with a cylinder glyph.

## Files
- `AppShell.dc.html` — sidebar + topbar chrome + project switcher (wraps screens 2–5)
- `Login.dc.html`, `Services.dc.html`, `ServiceDetail.dc.html`, `Projects.dc.html`, `SharedVars.dc.html`
- `support.js` — DC runtime (reference only; needed to open the files in a browser)

## Not yet designed (planned, for context)
Infrastructure (servers + databases, grouped into project folders), New Service wizard, New Database, Servers
(provisioning flow), Import from Render (migration wizard), Activity feed, Notifications settings, a component/token
gallery, and a side-by-side light+dark review canvas. Build these to match the same tokens and patterns.
