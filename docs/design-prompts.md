# DebutDeploy — UI redesign prompt pack

Paste **Prompt 0 (Foundation)** into Claude first and have it produce a design
system + shell. Then paste each page prompt — they assume the foundation. Ask
Claude for a high-fidelity React + Tailwind (or HTML/CSS) mockup in **both light
and dark**. DebutDeploy is a Render-style control panel over Coolify on Hetzner.

---

## Prompt 0 — Foundation: design system + app shell

> Design a corporate-grade design system and app shell for **DebutDeploy**, a
> developer cloud-hosting control panel (a Render.com competitor that deploys
> apps and databases to a customer's own servers). Target aesthetic: **clean,
> trustworthy, modern SaaS** — think Render, Vercel, Linear, Railway. Confident
> use of whitespace, crisp hairline borders, restrained color, fast and legible.
> Deliver a polished React + Tailwind mockup with **full light AND dark themes**.
>
> **Brand:** product name "DebutDeploy", square "D" mark. Display font for the
> wordmark/headings (Space Grotesk or similar geometric sans); UI font Inter.
>
> **Color tokens** — define both themes as CSS variables and show a swatch sheet:
> `--bg, --surface, --surface-2, --border, --text, --text-muted, --accent,
> --accent-contrast, --ok, --warn, --err`. Light = near-white surfaces, soft gray
> borders, dark ink. Dark = deep desaturated navy/near-black surfaces, lighter
> borders, off-white ink. Pick ONE confident primary accent (propose 2–3 options,
> e.g. indigo/violet, teal, or electric blue) used sparingly for primary actions,
> active nav, focus rings. Semantic green/amber/red for status.
>
> **Primitives to design (light+dark, all states):** buttons (primary, secondary,
> ghost, destructive; default/hover/active/disabled/loading), text/select inputs
> + labels + help + error, cards, **status pills/badges** (running/healthy=green,
> building=amber, stopped/failed=red, neutral), tabs, data tables/lists with
> dividers, **resource meters** (CPU/RAM/Disk horizontal bars with %), inline
> toasts/alerts, empty states, loading skeletons/spinners, a copy-to-clipboard
> field for secrets (masked).
>
> **App shell:** left **sidebar** (D wordmark; nav items with icons: Services,
> Databases, New Service, New Database, Activity, Notifications; an admin-only
> section divider then Servers, Shared Vars, Import from Render; version footer).
> **Top bar** (right-aligned: an environment pill "Live · Coolify" green /
> "Demo · Coolify" amber, a user chip with avatar+name, a light/dark toggle, a
> logout button). Content area scrolls; sidebar + topbar fixed. Show the shell in
> both themes. Accessible contrast (WCAG AA), visible focus states, keyboard-nav
> friendly, subtle 150ms transitions only.

---

## Prompt 1 — Login

> Design the **Login** page for DebutDeploy (uses the foundation system). Minimal,
> trustworthy, centered. A branded card on a subtle background: the D mark +
> "DebutDeploy" wordmark, a one-line tagline ("Deploy apps & databases to your own
> cloud."), and two OAuth buttons — **Continue with Google** and **Continue with
> GitHub** (provider logos, secondary-button style). A small footer line. No
> email/password. Show light + dark. Bonus: a tasteful right-side brand panel
> (gradient/mesh or a faint product screenshot) for wider viewports.

---

## Prompt 2 — Services (dashboard / home)

> Design the **Services** dashboard — the landing page listing a customer's
> deployed apps. Header: "Services" + a primary **New Service** button. Below, a
> responsive grid (or table toggle) of **service cards**. Each card shows: app
> name, a status pill (e.g. `running · healthy` green, `building` amber, `exited`
> red), the live domain as a link (e.g. `api.mflh.io`), the git repo + branch
> (`debutweb/mflh · main`), runtime (`Node`), and "Last deploy: 7m ago". Hover =
> subtle lift; whole card clickable to detail. Include an **empty state**
> ("No services yet — deploy your first app") and a loading skeleton grid. Show a
> realistic populated view (6–8 cards, mixed statuses) in light + dark.

---

## Prompt 3 — Service detail

> Design the **Service detail** page for one app. Top: back link, app name + status
> pill, the domain as an external link, and primary actions **Deploy**, **Stop**,
> **Restart**. A meta row: repo·branch, runtime, server, last deploy. Then a
> **tab bar**: Deployments · Logs · Environment · Events · Settings. Design each:
> - **Deployments**: a list of deploys — commit message, short SHA · branch ·
>   trigger (`git push`/`manual`), status (`Live` green / `Failed` red / building),
>   duration, relative time, and a **Rollback** button per row; a "Redeploy latest"
>   action.
> - **Logs**: a terminal-style log viewer (monospace, dark even in light theme),
>   with a tail/scroll affordance.
> - **Environment**: an editable key/value table (values masked, reveal toggle),
>   add-row, and a "bulk paste .env" affordance.
> - **Events**: a vertical activity timeline for this service (action label, actor,
>   relative time; `Service went DOWN` in red, `Service recovered` in green).
> - **Settings**: build-pack select + build/start commands, custom domain (set +
>   "verify DNS" + TLS status), resource limits (CPU/MEM), health-check config,
>   volumes, and a clearly separated **Danger zone** (delete service).
> Show the page with the Deployments tab active, light + dark.

---

## Prompt 4 — Infrastructure (Databases + Servers usage)

> Design the **Infrastructure** page. Header: "Infrastructure" + subtitle counts
> ("2 servers · 3 databases") + a **New Database** button. Two sections:
> - **Servers**: cards each showing server name, region · IP · spec
>   (`4 vCPU · 8 GB · 80 GB SSD`), a `Running` pill, and three **usage meters**
>   (CPU / RAM / Disk as labeled % bars; green→amber→red by load).
> - **Databases**: cards each showing engine icon, name, version
>   (`PostgreSQL 16`), a **masked connection string** with copy button, size +
>   active connections, a `Running` pill, **Stop / Delete** actions, a **Backups**
>   button, and a list of linked apps. Mixed Postgres/Redis examples.
> Empty + loading states. Light + dark.

---

## Prompt 5 — New Service (deploy wizard)

> Design the **New Service** wizard — connect a GitHub repo and deploy. Steps (a
> clean stepper or single well-grouped form): (1) **Pick repository** — a
> searchable list of repos grouped by GitHub account/installation, each row showing
> `owner/repo`, private badge, default branch; (2) **Branch** select; (3) **Build**
> — auto-detected build pack (Nixpacks/Docker/Static) with override, optional
> build & start commands, exposed port; (4) **Name** + a **Deploy** primary button.
> Show a "connect more GitHub accounts" affordance and a not-connected empty state.
> Light + dark.

---

## Prompt 6 — New Database

> Design the **New Database** page. Pick an engine from a row of selectable cards
> (PostgreSQL, Redis/Valkey, MySQL, MongoDB — each with logo + one-liner), a name
> field, optional version, and a **Create database** primary button. Show the
> selected-card state and a brief "what you'll get" note (internal connection URL,
> auto DATABASE_URL link). Light + dark.

---

## Prompt 7 — Servers (provision new infrastructure, admin)

> Design the **Servers** admin page. Top: existing servers as cards (name, IP ·
> region · spec, Running pill, CPU/RAM/Disk meters). Below, a **Provision new
> server** panel: a name field, a **server type** select (showing specs + monthly
> price, e.g. `cx32 — 4 vCPU, 8 GB RAM, 80 GB · €6.49/mo`), a **location** select
> (Falkenstein, Nuremberg, Helsinki, Ashburn), and a **Provision** button. After
> submit, show a **step-progress list** with status icons: `validate ✓`,
> `prepare SSH key ✓`, `create server ✓`, `await running �…`, `register with
> Coolify`. Then a success row with the new server's IP. Design the in-progress and
> success states. Light + dark.

---

## Prompt 8 — Import from Render (migration wizard, admin)

> Design the **Import from Render** wizard — migrate a service off Render.com onto
> DebutDeploy. Step 1: a **Render API key** field (password style) + "List services".
> Step 2: a selectable list of the user's Render services (name, repo@branch, type).
> Step 3: choose a **deployment target** — radio between **Shared** (existing infra)
> and **Dedicated** (provision a new server; reveals a server-size picker). Then a
> **Migrate** button. Step 4: a live **step-progress** panel (read service → resolve
> server → resolve GitHub → create app → migrate database → push env → deploy →
> done), each step with ok/in-progress/error/skipped state, ending in the new live
> URL. Design the populated step-2 list and the in-progress step-4 states. Make the
> API-key field clearly handled-securely. Light + dark.

---

## Prompt 9 — Activity feed

> Design the **Activity** page — a Render-style audit/event feed across the user's
> services. Header "Activity" + subtitle. A vertical timeline list, newest first;
> each row: a small colored dot (red for `Service went DOWN`, green for `Service
> recovered`, neutral/accent otherwise), a human action label (Deployed, Restarted,
> Env var set, Provisioned server, Imported from Render, Signed in, …), the resource
> (`application · app-mflh`), the actor (name or "system"), and a right-aligned
> relative time ("8s ago"). Group by day optionally. Empty + loading states. Light
> + dark.

---

## Prompt 10 — Notifications settings

> Design the **Notifications** settings page. Header "Notifications" + subtitle ("Get
> a webhook when your services go down or deploys finish."). A card with: an
> **Enable notifications** toggle, a **Webhook URL** field with help text ("We POST a
> JSON payload on service.down / service.up and deploy events. Internal/private
> addresses are rejected."), and a **Save** button. Design the success state
> ("Saved") and an inline **error** state showing a server rejection reason ("webhook
> host is not allowed"). Light + dark.

---

## Prompt 11 — Shared Variables (admin)

> Design the **Shared Variables** admin page — team-wide env vars injected into new
> services. Header + subtitle. An add-row form (key, value, "secret" toggle) and a
> table of existing shared vars (key, masked value with reveal, delete). Empty +
> loading states. Light + dark.

---

### Tips for the design runs
- Paste Prompt 0 first; ask Claude to keep the resulting tokens/components and
  reuse them for each page so the set is cohesive.
- Provide your brand accent color(s) if you have them; otherwise let it propose.
- Ask for both themes every time, and for the empty/loading/error states — those
  are where most panels look unfinished.
