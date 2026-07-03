# Mobile/Tablet Responsive + PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DebutDeploy React+Vite+Tailwind client fully usable on mobile/tablet and installable as a PWA, without changing desktop layout.

**Architecture:** Add a drawer-based sidebar toggle for ≤1024px screens (state in AppShell, passed as props to Sidebar/Topbar), apply Tailwind responsive prefixes across pages for fluid grids/tables/forms, then install vite-plugin-pwa and configure it with a minimal Workbox setup.

**Tech Stack:** React 18, Vite 6, Tailwind v4 (via @tailwindcss/vite), vite-plugin-pwa (Workbox), lucide-react.

## Global Constraints

- Work only in `client/` directory.
- Desktop (>1024px) layout must be pixel-identical to today — responsive changes additive only.
- No new dependencies except `vite-plugin-pwa` in devDependencies.
- Tailwind v4 is in use — no `tailwind.config.js`; use `@tailwindcss/vite` plugin; Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) work normally.
- All existing CSS tokens (`var(--...)`) must remain the sole source of color/surface/shadow.
- ESM everywhere (`"type": "module"`).
- No git commits — user will commit manually.

---

### Task 1: App Shell — Off-Canvas Sidebar Drawer

**Files:**
- Modify: `client/src/App.jsx` (AppShell, Sidebar, Topbar components)
- Modify: `client/src/index.css` (drawer + backdrop + hamburger CSS)

**Interfaces:**
- Produces: `AppShell` manages `drawerOpen: boolean` state; passes `onClose: () => void` to `Sidebar`; passes `onMenuClick: () => void` to `Topbar`.
- Desktop (>1024px): `Sidebar` renders as before — fixed 240px, always visible. No prop needed to change anything at >1024px.
- Mobile/tablet (≤1024px): `Sidebar` slides in from left as an overlay; a semi-transparent backdrop div closes it on click.

**Implementation details:**

The existing `Sidebar` has `aside` with inline `style={{ width: 240, ... }}`. We need to:
1. Add a CSS class `.sidebar-drawer` that controls the off-canvas behavior at ≤1024px.
2. Add a `.sidebar-backdrop` div rendered behind the drawer at ≤1024px when open.
3. Add a hamburger `<button>` in the Topbar left of the breadcrumb, visible only ≤1024px (hidden via CSS `display:none` at `@media (min-width: 1025px)`).
4. Add `drawerOpen` state in `AppShell`, pass handlers down.

- [ ] **Step 1: Add CSS for drawer, backdrop, hamburger in `client/src/index.css`**

Append to the end of `client/src/index.css`:

```css
/* ── Mobile drawer ── */
@media (max-width: 1024px) {
  .sidebar-drawer {
    position: fixed !important;
    top: 0; left: 0; bottom: 0;
    z-index: 200;
    transform: translateX(-100%);
    transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
    box-shadow: var(--shadow-lg);
  }
  .sidebar-drawer.is-open {
    transform: translateX(0);
  }
  .sidebar-backdrop {
    display: block;
    position: fixed; inset: 0;
    z-index: 199;
    background: rgba(0,0,0,0.45);
    animation: dd-fade-in 0.2s ease;
  }
  @keyframes dd-fade-in { from { opacity: 0 } to { opacity: 1 } }
  .topbar-menu-btn {
    display: flex !important;
  }
  .app-shell-sidebar-spacer {
    display: none !important;
  }
}
@media (min-width: 1025px) {
  .sidebar-drawer {
    position: relative !important;
    transform: none !important;
    box-shadow: none !important;
  }
  .sidebar-backdrop { display: none !important; }
  .topbar-menu-btn { display: none !important; }
}

/* ── Topbar responsive ── */
@media (max-width: 479px) {
  .topbar-env-pill { display: none !important; }
  .topbar-divider { display: none !important; }
}
@media (max-width: 639px) {
  .topbar-user-name { display: none !important; }
}
/* Minimum 40px hit targets for mobile */
.topbar-menu-btn,
.topbar-theme-btn,
.topbar-logout-btn {
  min-width: 40px !important;
  min-height: 40px !important;
}
```

- [ ] **Step 2: Modify `AppShell` in `client/src/App.jsx` to manage drawer state**

Replace the current `AppShell` function (lines 409–435):

```jsx
function AppShell() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change (user tapped a nav link)
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div style={{ display: "flex", height: "100%", background: "var(--bg)" }}>
      {/* Backdrop (mobile only, shown when drawer open) */}
      {drawerOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        drawerOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
        <Topbar onMenuClick={() => setDrawerOpen((o) => !o)} />
        <main
          key={location.pathname}
          style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--bg)" }}
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/services/:id" element={<ServiceDetail />} />
            <Route path="/databases" element={<Databases />} />
            <Route path="/new" element={<NewService />} />
            <Route path="/new-database" element={<NewDatabase />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/notifications" element={<NotificationSettings />} />
            <Route path="/shared-vars" element={<SharedVars />} />
            <Route path="/servers" element={<Servers />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/import" element={<ImportRender />} />
            <Route path="/projects" element={<Projects />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `drawerOpen`/`onClose` props to `Sidebar` and apply `sidebar-drawer` class**

Replace the `Sidebar` function's opening `<aside>` (currently line ~168):

```jsx
function Sidebar({ drawerOpen, onClose }) {
  // ... (existing HoverNavLink + user + navLink remain)
  // Change HoverNavLink to also call onClose:
  function HoverNavLink({ to, end, children }) {
    const [hov, setHov] = useState(false);
    return (
      <NavLink
        to={to}
        end={end}
        onClick={onClose}   // ← close drawer on nav (mobile)
        style={({ isActive }) => ({
          ...navLink({ isActive }),
          ...(hov && !isActive ? { background: "var(--surface-2)", color: "var(--text)" } : {}),
        })}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
      >
        {children}
      </NavLink>
    );
  }

  return (
    <aside
      className={`sidebar-drawer${drawerOpen ? " is-open" : ""}`}
      style={{
        width: 240, flexShrink: 0, height: "100%",
        display: "flex", flexDirection: "column",
        background: "var(--surface)", borderRight: "1px solid var(--border)",
      }}
    >
      {/* ... rest of sidebar unchanged ... */}
    </aside>
  );
}
```

- [ ] **Step 4: Add `onMenuClick` prop and hamburger button to `Topbar`**

In `Topbar`, add `onMenuClick` param and hamburger before the breadcrumb. Change the function signature and the `<header>` interior. The hamburger uses `Menu` icon from lucide-react (add to existing import).

In the `import` at the top of App.jsx, add `Menu` to the lucide-react import line.

Then in `Topbar({ onMenuClick })`, change the left side of the header:

```jsx
{/* Left: hamburger (mobile) + breadcrumb */}
<div style={{ display: "flex", alignItems: "center", gap: 9 }}>
  <button
    className="topbar-menu-btn"
    onClick={onMenuClick}
    aria-label="Open menu"
    style={{
      display: "none", /* overridden by CSS on ≤1024px */
      alignItems: "center", justifyContent: "center",
      width: 40, height: 40, borderRadius: 8,
      border: "none", background: "transparent",
      cursor: "pointer", color: "var(--text-muted)",
      marginLeft: -6,
    }}
  >
    <Menu size={20} />
  </button>
  <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-muted)", fontSize: 13 }}>
    <span style={{ fontWeight: 500, color: "var(--text)" }}>{crumb}</span>
  </div>
</div>
```

- [ ] **Step 5: Add responsive classes to Topbar right cluster**

Wrap the env pill `<div>` to add `className="topbar-env-pill"`.
Wrap the divider `<span>` to add `className="topbar-divider"`.
Wrap the user name/role `<div>` (the inner flexColumn div inside the user button) to add `className="topbar-user-name"`.
Add `className="topbar-theme-btn"` to the theme toggle button.
Add `className="topbar-logout-btn"` to the logout button.

No style changes — the CSS classes added in Step 1 handle visibility.

- [ ] **Step 6: Verify drawer in dev mode**

Run: `npm --prefix client run dev`
Expected: No console errors. Resize browser to <1024px width — no sidebar visible. Click hamburger — sidebar slides in from left over a dark backdrop. Click a nav link or backdrop — sidebar closes. At >1024px — sidebar fixed, hamburger hidden.

---

### Task 2: Page-Level Responsive — Grids, Tables, Forms

**Files:**
- Modify: `client/src/pages/Dashboard.jsx`
- Modify: `client/src/pages/Projects.jsx`
- Modify: `client/src/pages/ServiceDetail.jsx`
- Modify: `client/src/pages/Customers.jsx`
- Modify: `client/src/pages/SharedVars.jsx`
- Modify: `client/src/pages/Databases.jsx`
- Modify: `client/src/pages/Login.jsx`
- Modify: `client/src/index.css` (utility classes for responsive tables)

**Interfaces:**
- Consumes: Tailwind responsive prefixes (`sm:`, `md:`, `lg:`)
- Produces: No new components — inline changes to className and style props.

---

#### 2a — Dashboard (Services grid + list table)

The grid currently uses inline `style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:15 }}`. Replace with a Tailwind className approach. Also the list table uses a CSS grid with hardcoded `gridTemplateColumns`.

- [ ] **Step 1: Fix the page padding on Dashboard**

In `Dashboard`, change the outer div:
```jsx
// Before:
<div style={{ padding: "26px 30px 40px", maxWidth: 1100, margin: "0 auto" }}>
// After:
<div style={{ padding: "16px 16px 40px", maxWidth: 1100, margin: "0 auto" }}
     className="sm:px-7 sm:pt-6">
```
(Tailwind v4 supports standard responsive prefixes directly.)

- [ ] **Step 2: Fix the service grid columns**

Replace the inline style grid in the grid view render:
```jsx
// Before (line ~411):
<div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 15 }}>
// After:
<div className="grid gap-[15px]"
     style={{ gridTemplateColumns: "repeat(1,1fr)" }}
     // Use a CSS class for responsive cols:
>
```

Actually, simpler: add a CSS class to `index.css`:

```css
/* ── Responsive service grid ── */
.services-grid {
  display: grid;
  gap: 15px;
  grid-template-columns: 1fr;
}
@media (min-width: 641px) {
  .services-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1025px) {
  .services-grid { grid-template-columns: repeat(3, 1fr); }
}
```

Then in Dashboard replace:
```jsx
// Before:
<div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 15 }}>
// After:
<div className="services-grid">
```

Also fix `SkeletonGrid` which hardcodes `gridTemplateColumns: "repeat(3,1fr)"`:
```jsx
// Before:
<div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 15 }}>
// After:
<div className="services-grid">
```

- [ ] **Step 3: Wrap the list table in a horizontal scroll container**

The `ListTable` uses a CSS grid div — it won't scroll naturally. Wrap it:

```jsx
function ListTable({ services, onRowClick }) {
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{
        minWidth: 640,  /* prevent collapse below readable width */
        border: "1px solid var(--border)", borderRadius: 13, overflow: "hidden",
        background: "var(--surface)", boxShadow: "var(--shadow)",
      }}>
        {/* ... rest unchanged ... */}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Make the toolbar wrap nicely on mobile**

The toolbar already has `flexWrap: "wrap"` — confirm both the search input and the grid/list toggle have reasonable min-widths on mobile. The search input has `style={{ width: 230 }}` — keep it but ensure it doesn't cause overflow:

```jsx
// search input wrapper — add maxWidth:
<input
  className="input"
  placeholder="Search services"
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  style={{ width: 230, maxWidth: "calc(100vw - 180px)", paddingLeft: 33 }}
/>
```

---

#### 2b — Projects grid

The Projects page renders project cards in a grid. Find the grid and apply the same `services-grid` class (or a similar `.projects-grid` that's 1-col mobile, 2-col tablet, 3-col desktop).

- [ ] **Step 5: Add responsive grid to Projects page**

In `client/src/index.css` add:
```css
.projects-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}
@media (min-width: 641px) {
  .projects-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1025px) {
  .projects-grid { grid-template-columns: repeat(3, 1fr); }
}
```

In `Projects.jsx`, find the project cards container. Look for the grid `div` that maps over projects and add `className="projects-grid"`, removing the inline `gridTemplateColumns` style. Also reduce the page padding:

```jsx
// Outer page wrapper — add responsive padding class
<div className="mx-auto max-w-5xl px-4 pb-11 pt-4 sm:px-7 sm:pt-6">
```

---

#### 2c — ServiceDetail tab bar (horizontal scroll)

The tab bar at line ~158 of ServiceDetail.jsx is `flex gap-1 border-b`. On mobile with 5 tabs it overflows. Make it scrollable.

- [ ] **Step 6: Make ServiceDetail tab bar horizontally scrollable on mobile**

In `client/src/index.css` add:
```css
.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none; /* hide scrollbar */
  -webkit-overflow-scrolling: touch;
}
.tab-bar::-webkit-scrollbar { display: none; }
```

In `ServiceDetail.jsx`, replace the tab bar div:
```jsx
// Before:
<div className="mb-[22px] flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
// After:
<div className="tab-bar mb-[22px]">
```

Also reduce ServiceDetail page padding on mobile:
```jsx
// Before:
<div className="mx-auto max-w-5xl px-7 pb-11 pt-6">
// After:
<div className="mx-auto max-w-5xl px-4 pb-11 pt-4 sm:px-7 sm:pt-6">
```

And the action buttons row needs to wrap on small screens:
```jsx
// Before:
<div className="flex items-center gap-2.5">
// After:
<div className="flex flex-wrap items-center gap-2.5">
```

---

#### 2d — Customers table (horizontal scroll)

- [ ] **Step 7: Wrap Customers table in overflow-x:auto**

In `Customers.jsx`, the `<Card>` containing the `<table>` already has `overflow-hidden`. Wrap the table in a scroll container instead:

```jsx
// Before:
<Card className="!p-0 overflow-hidden">
  <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
// After:
<Card className="!p-0 overflow-hidden">
  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
    <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 520 }}>
```

Close the wrapper div after `</table>` but before `</Card>`.

Also reduce page padding:
```jsx
// Before:
<div className="mx-auto max-w-5xl px-7 pb-11 pt-6">
// After:
<div className="mx-auto max-w-5xl px-4 pb-11 pt-4 sm:px-7 sm:pt-6">
```

---

#### 2e — SharedVars / Databases tables

- [ ] **Step 8: Check and wrap SharedVars and Databases tables**

Read the top 80 lines of `client/src/pages/SharedVars.jsx` and `client/src/pages/Databases.jsx`. For any `<table>` or wide grid `<div>` found, wrap in `<div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>` with `minWidth: 520` on the inner element. Also reduce page padding to use `px-4 pt-4 sm:px-7 sm:pt-6` pattern.

---

#### 2f — Login page — hide right panel <768px

- [ ] **Step 9: Hide Login BrandPanel on small screens**

In `Login.jsx`, the `BrandPanel` component renders at `width: "52%"`. It's already conditionally shown only on wide screens in spirit — confirm and enforce it:

```jsx
// In Login.jsx, find the outer two-column container and BrandPanel.
// Add a CSS class approach:
```

In `client/src/index.css` add:
```css
@media (max-width: 767px) {
  .login-brand-panel { display: none !important; }
  .login-form-panel { width: 100% !important; }
}
```

In `Login.jsx`, add `className="login-brand-panel"` to the `<BrandPanel>` wrapper div, and `className="login-form-panel"` to the form side div. The existing inline `width: "52%"` on the brand panel will be overridden by the CSS class at <768px.

---

### Task 3: PWA Setup

**Files:**
- Modify: `client/package.json` (add vite-plugin-pwa devDependency)
- Modify: `client/vite.config.js` (add VitePWA plugin)
- Create: `client/public/icon.svg`
- Modify: `client/index.html` (add meta tags)

**Interfaces:**
- Produces: `dist/sw.js`, `dist/manifest.webmanifest` on build, registered by the plugin.

---

- [ ] **Step 1: Add vite-plugin-pwa to package.json devDependencies**

In `client/package.json`, add to `"devDependencies"`:
```json
"vite-plugin-pwa": "^0.21.0"
```

Full updated devDependencies block:
```json
"devDependencies": {
  "@tailwindcss/vite": "^4.0.0",
  "@vitejs/plugin-react": "^4.3.4",
  "tailwindcss": "^4.0.0",
  "vite": "^6.0.0",
  "vite-plugin-pwa": "^0.21.0"
}
```

- [ ] **Step 2: Install the new dependency**

Run: `npm --prefix client install`
Expected: Lock file updated, `node_modules/vite-plugin-pwa` present. No errors.

- [ ] **Step 3: Configure VitePWA in `client/vite.config.js`**

Replace the entire file:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "DebutDeploy",
        short_name: "DebutDeploy",
        description: "Render-style control panel for Coolify-hosted apps",
        display: "standalone",
        start_url: "/",
        scope: "/",
        theme_color: "#0a0c11",
        background_color: "#0a0c11",
        icons: [
          {
            src: "icon.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache the app shell; do NOT cache API/auth/github routes
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/github/],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5180,
    proxy: {
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
      "/github": "http://localhost:8787",
    },
  },
});
```

- [ ] **Step 4: Create the app icon SVG at `client/public/icon.svg`**

Create `client/public/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <!-- rounded-square background -->
  <rect width="192" height="192" rx="40" ry="40" fill="#2563eb"/>
  <!-- white "D" lettermark, centered -->
  <text
    x="96" y="138"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="120"
    font-weight="700"
    fill="#ffffff"
    text-anchor="middle"
  >D</text>
</svg>
```

- [ ] **Step 5: Update `client/index.html` with PWA meta tags**

Replace the current `index.html`:

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DebutDeploy</title>
    <meta name="theme-color" content="#0a0c11" />
    <meta name="description" content="Render-style control panel for Coolify-hosted apps" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <link rel="apple-touch-icon" href="/icon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Note: vite-plugin-pwa injects the manifest `<link rel="manifest">` automatically via the plugin. No manual manifest link needed.

- [ ] **Step 6: Build and verify**

Run: `npm --prefix client run build`

Expected output includes:
- `dist/sw.js` (Workbox service worker)
- `dist/manifest.webmanifest` (generated from the manifest config)
- `dist/index.html` (with injected `<link rel="manifest">`)
- No build errors.

Check: `ls dist/` or `dir dist\` — confirm `sw.js` and `manifest.webmanifest` present.

---

## Known Limitations / Notes

- **SVG icons for PWA**: vite-plugin-pwa accepts SVG icons in the manifest config and will reference them by URL. Some older Android versions may not display SVG icons — acceptable for this admin tool. If PNG icons are needed later, add a `scripts/gen-icons.js` step using `sharp` or similar.
- **apple-touch-icon**: Pointing to the SVG is accepted by modern iOS Safari. If iOS install icon shows incorrectly, generate a 180×180 PNG and point `apple-touch-icon` there.
- **Theme-color meta**: Set to dark bg `#0a0c11`. This controls the browser chrome color on mobile. The app supports both themes but the PWA installs with a dark chrome — acceptable for a server-admin tool.
- **Offline behavior**: The Workbox config caches the app shell (HTML/JS/CSS/fonts). `/api`, `/auth`, `/github` are excluded. On offline load, the SPA shell loads but API calls fail gracefully (the app already handles API errors with loading/error states).
