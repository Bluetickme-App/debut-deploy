import { Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Layers, Database, SquarePlus, Activity as ActivityIcon, Bell,
  ServerCog, Braces, DownloadCloud, ChevronsUpDown, Check, Plus,
  Sun, Moon, LogOut, ChevronDown, FolderOpen, Users, Mail, Menu, GitBranch, CreditCard, Wallet, Gauge, Landmark, Settings as SettingsIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "./lib/api.js";
import Dashboard from "./pages/Dashboard.jsx";
import ServiceDetail from "./pages/ServiceDetail.jsx";
import Databases from "./pages/Databases.jsx";
import DatabaseDetail from "./pages/DatabaseDetail.jsx";
import NewService from "./pages/NewService.jsx";
import NewDatabase from "./pages/NewDatabase.jsx";
import Activity from "./pages/Activity.jsx";
import NotificationSettings from "./pages/NotificationSettings.jsx";
import SharedVars from "./pages/SharedVars.jsx";
import Servers from "./pages/Servers.jsx";
import ImportRender from "./pages/ImportRender.jsx";
import Email from "./pages/Email.jsx";
import Projects from "./pages/Projects.jsx";
import ProjectDetail from "./pages/ProjectDetail.jsx";
import DocsCustomDomains from "./pages/DocsCustomDomains.jsx";
import Customers from "./pages/Customers.jsx";
import Team from "./pages/Team.jsx";
import Clients from "./pages/Clients.jsx";
import NewServiceGit from "./pages/NewServiceGit.jsx";
import Billing from "./pages/Billing.jsx";
import StripeAdmin from "./pages/StripeAdmin.jsx";
import WalletPage from "./pages/Wallet.jsx";
import Usage from "./pages/Usage.jsx";
import Settings from "./pages/Settings.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import Login from "./pages/Login.jsx";
import { AuthProvider, RequireAuth, useAuth } from "./auth.jsx";
import { ThemeProvider, useTheme } from "./lib/theme.jsx";
import { ProjectProvider, useProjects } from "./lib/projects.jsx";

// ─── Project Switcher ────────────────────────────────────────────────────────

function ProjectSwitcher() {
  const { projects, activeProject, setActive } = useProjects();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const tile = (color) => ({
    width: 22, height: 22, borderRadius: 6,
    background: color, color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 700, flexShrink: 0,
  });

  return (
    <div ref={ref} style={{ position: "relative", padding: "0 12px 12px" }}>
      {/* trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 8, padding: "8px 10px", borderRadius: 6,
          border: "1px solid var(--border)", background: "var(--surface)",
          cursor: "pointer", width: "100%", transition: "background .15s, border-color .15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.background = "var(--surface-2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--surface)"; }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={tile(activeProject.color)}>
            {activeProject.name[0].toUpperCase()}
          </span>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-muted)", textTransform: "uppercase" }}>
              Project
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeProject.name}
            </span>
          </div>
        </div>
        <ChevronsUpDown size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      </button>

      {/* dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 12, right: 12, marginTop: 5,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "var(--shadow-lg)", padding: 6, zIndex: 40,
        }}>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => { setActive(p.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "7px 8px", borderRadius: 6, cursor: "pointer",
                width: "100%", background: "transparent", border: "none",
                transition: "background .15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={tile(p.color)}>{p.name[0].toUpperCase()}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </span>
              {p.id === activeProject.id && (
                <Check size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
              )}
            </button>
          ))}

          <div style={{ height: 1, background: "var(--border)", margin: "6px 4px" }} />

          <button
            onClick={() => { setOpen(false); navigate("/projects"); }}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "7px 8px", borderRadius: 6, cursor: "pointer",
              width: "100%", background: "transparent", border: "none",
              color: "var(--accent-text)", fontSize: 13, fontWeight: 600,
              transition: "background .15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-soft)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <Plus size={16} />
            New project
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ drawerOpen, onClose }) {
  const { user } = useAuth();

  const navLink = ({ isActive }) => ({
    display: "flex", alignItems: "center", gap: 11,
    padding: "8px 11px", borderRadius: 6,
    textDecoration: "none", fontSize: 13.5, fontWeight: isActive ? 600 : 500,
    color: isActive ? "var(--accent-text)" : "var(--text-muted)",
    background: isActive ? "var(--accent-soft)" : "transparent",
    transition: "background .15s, color .15s",
  });

  // hover handled via onMouse events on the <NavLink> wrapper
  function HoverNavLink({ to, end, children }) {
    const [hov, setHov] = useState(false);
    return (
      <NavLink
        to={to}
        end={end}
        onClick={onClose}
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
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 18px 14px" }}>
        <img src="/icon.svg" alt="" width={30} height={30} style={{ display: "block" }} />
        <span style={{ fontFamily: "'Inter',sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em", color: "var(--text)" }}>
          Debut<span style={{ color: "var(--accent-text)" }}>Deploy</span>
        </span>
      </div>

      {/* Project switcher */}
      <ProjectSwitcher />

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "6px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <HoverNavLink to="/projects"><FolderOpen size={18} /><span>Projects</span></HoverNavLink>
        <HoverNavLink to="/" end><Layers size={18} /><span>Services</span></HoverNavLink>
        <HoverNavLink to="/databases"><Database size={18} /><span>Infrastructure</span></HoverNavLink>
        <HoverNavLink to="/new"><SquarePlus size={18} /><span>New Service</span></HoverNavLink>
        <HoverNavLink to="/new-database"><Database size={18} /><span>New Database</span></HoverNavLink>
        <HoverNavLink to="/activity"><ActivityIcon size={18} /><span>Activity</span></HoverNavLink>
        <HoverNavLink to="/notifications"><Bell size={18} /><span>Notifications</span></HoverNavLink>

        {(user?.orgRole === "owner" || user?.orgRole === "manager") && (
          <HoverNavLink to="/team"><Users size={18} /><span>Team</span></HoverNavLink>
        )}

        {user?.orgRole && (
          <HoverNavLink to="/wallet"><Wallet size={18} /><span>Wallet</span></HoverNavLink>
        )}

        {user?.orgRole && (
          <HoverNavLink to="/usage"><Gauge size={18} /><span>Usage</span></HoverNavLink>
        )}

        {(user?.orgRole || user?.role === "admin") && (
          <HoverNavLink to="/email"><Mail size={18} /><span>Email</span></HoverNavLink>
        )}

        {user?.role === "admin" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 10px 6px" }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.09em", color: "var(--text-muted)", textTransform: "uppercase" }}>Admin</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            <HoverNavLink to="/clients"><Users size={18} /><span>Clients</span></HoverNavLink>
            <HoverNavLink to="/billing"><CreditCard size={18} /><span>Billing &amp; Plans</span></HoverNavLink>
            <HoverNavLink to="/stripe"><Landmark size={18} /><span>Stripe</span></HoverNavLink>
            <HoverNavLink to="/new-git"><GitBranch size={18} /><span>Deploy from Git</span></HoverNavLink>
            <HoverNavLink to="/servers"><ServerCog size={18} /><span>Servers</span></HoverNavLink>
            <HoverNavLink to="/shared-vars"><Braces size={18} /><span>Variable Groups</span></HoverNavLink>
            <HoverNavLink to="/import"><DownloadCloud size={18} /><span>Import from Render</span></HoverNavLink>
          </>
        )}
      </nav>

      {/* Footer */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>v1.4.2</span>
        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-muted)", opacity: 0.6 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Coolify 4.0</span>
        <a
          href="/api/status"
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)", textDecoration: "none" }}
        >
          Status ↗
        </a>
      </div>
    </aside>
  );
}

// ─── Topbar ──────────────────────────────────────────────────────────────────

const CRUMB_MAP = {
  "/": "Services",
  "/projects": "Projects",
  "/databases": "Infrastructure",
  "/new": "New Service",
  "/new-database": "New Database",
  "/activity": "Activity",
  "/notifications": "Notifications",
  "/servers": "Servers",
  "/shared-vars": "Variable Groups",
  "/import": "Import from Render",
  "/email": "Email",
  "/customers": "Customers",
  "/team": "Team",
  "/clients": "Clients",
  "/new-git": "Deploy from Git",
  "/billing": "Billing & Plans",
  "/stripe": "Stripe",
  "/wallet": "Wallet",
  "/usage": "Usage",
  "/settings": "Account settings",
};

function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [logoutHov, setLogoutHov] = useState(false);
  const [themeHov, setThemeHov] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    api.health().then((h) => setMode(h.mode)).catch(() => setMode("offline"));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const crumb = CRUMB_MAP[location.pathname] ??
    (location.pathname.startsWith("/services/") ? "Service Detail" :
     location.pathname.startsWith("/databases/") ? "Database" :
     location.pathname.startsWith("/projects/") ? "Project Detail" : "");

  const isLive = mode === "live";
  const envLabel = mode === "demo" ? "Demo" : mode === "live" ? "Live" : null;

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : (user?.email?.[0] ?? "?").toUpperCase();

  return (
    <header style={{
      height: 56, flexShrink: 0,
      borderBottom: "1px solid var(--border)", background: "var(--surface)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 18px 0 24px",
    }}>
      {/* Left: hamburger (mobile/tablet) + breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <button
          className="topbar-menu-btn"
          onClick={onMenuClick}
          aria-label="Open menu"
          style={{
            display: "none", /* overridden to flex by CSS on ≤1024px */
            alignItems: "center", justifyContent: "center",
            width: 40, height: 40, borderRadius: 6,
            border: "none", background: "transparent",
            cursor: "pointer", color: "var(--text-muted)",
            marginLeft: -6, flexShrink: 0,
          }}
        >
          <Menu size={20} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-muted)", fontSize: 13 }}>
          <span style={{ fontWeight: 500, color: "var(--text)" }}>{crumb}</span>
        </div>
      </div>

      {/* Right cluster */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Env pill */}
        {envLabel && (
          <div className="topbar-env-pill" style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "5px 11px", borderRadius: 999,
            fontSize: 12, fontWeight: 600,
            background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)",
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: isLive ? "var(--ok)" : "var(--warn)",
              boxShadow: isLive ? "0 0 0 3px var(--ok-soft)" : "0 0 0 3px var(--warn-soft)",
            }} />
            {envLabel}
            <span style={{ opacity: 0.6, fontWeight: 450 }}> · Coolify</span>
          </div>
        )}

        {/* Divider */}
        <span className="topbar-divider" style={{ width: 1, height: 22, background: "var(--border)", margin: "0 2px" }} />

        {/* Theme toggle */}
        <button
          className="topbar-theme-btn"
          onClick={toggle}
          title="Toggle theme"
          onMouseEnter={() => setThemeHov(true)}
          onMouseLeave={() => setThemeHov(false)}
          style={{
            width: 34, height: 34, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", border: "1px solid transparent",
            background: themeHov ? "var(--surface-2)" : "transparent",
            color: themeHov ? "var(--text)" : "var(--text-muted)",
            transition: "background .15s, color .15s",
          }}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User chip + account menu */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "4px 8px 4px 5px", borderRadius: 6, cursor: "pointer",
              border: "1px solid transparent", background: menuOpen ? "var(--surface-2)" : "transparent",
              transition: "background .15s",
            }}
          >
            <span style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "linear-gradient(135deg,#6366f1,#2563eb)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em",
            }}>
              {initials}
            </span>
            <div className="topbar-user-name" style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, textAlign: "left" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
                {user?.name || user?.email || "User"}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                {user?.role || "member"}
              </span>
            </div>
            <ChevronDown size={14} style={{ color: "var(--text-muted)", marginLeft: 1 }} />
          </button>

          {menuOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 8px)", width: 244, zIndex: 50,
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
              boxShadow: "var(--shadow-lg)", overflow: "hidden",
            }}>
              <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{user?.name || "Signed in"}</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                  <Mail size={12} /> {user?.email || "—"}
                </div>
                <span className={`pill ${user?.role === "admin" ? "pill-accent" : "pill-neutral"}`} style={{ marginTop: 8 }}>
                  {user?.role || "customer"}
                </span>
              </div>
              <button
                onClick={() => { setMenuOpen(false); navigate("/settings"); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px",
                  background: "transparent", border: "none", cursor: "pointer", fontSize: 13,
                  color: "var(--text)", fontFamily: "inherit", borderTop: "1px solid var(--border)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <SettingsIcon size={15} /> Account settings
              </button>
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px",
                  background: "transparent", border: "none", cursor: "pointer", fontSize: 13,
                  color: "var(--err-text)", fontFamily: "inherit",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--err-soft)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>

        {/* Logout */}
        <button
          className="topbar-logout-btn"
          onClick={logout}
          title="Log out"
          onMouseEnter={() => setLogoutHov(true)}
          onMouseLeave={() => setLogoutHov(false)}
          style={{
            width: 34, height: 34, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", border: "1px solid transparent",
            background: logoutHov ? "var(--err-soft)" : "transparent",
            color: logoutHov ? "var(--err-text)" : "var(--text-muted)",
            transition: "background .15s, color .15s",
          }}
        >
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}

// ─── App Shell ───────────────────────────────────────────────────────────────

function AppShell() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change (nav link tapped on mobile)
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div style={{ display: "flex", height: "100%", background: "var(--bg)" }}>
      {/* Backdrop — mobile/tablet only, shown when drawer open */}
      {drawerOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
        <Topbar onMenuClick={() => setDrawerOpen((o) => !o)} />
        <main key={location.pathname} style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--bg)" }}>
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/services/:id" element={<ServiceDetail />} />
            <Route path="/databases" element={<Databases />} />
            <Route path="/databases/:uuid" element={<DatabaseDetail />} />
            <Route path="/new" element={<NewService />} />
            <Route path="/new-database" element={<NewDatabase />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/notifications" element={<NotificationSettings />} />
            <Route path="/shared-vars" element={<SharedVars />} />
            <Route path="/servers" element={<Servers />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/team" element={<Team />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/new-git" element={<NewServiceGit />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/stripe" element={<StripeAdmin />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/import" element={<ImportRender />} />
            <Route path="/email" element={<Email />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/docs/custom-domains" element={<DocsCustomDomains />} />
          </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <ProjectProvider>
                  <AppShell />
                </ProjectProvider>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
