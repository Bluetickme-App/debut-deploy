import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { LayoutGrid, Database, Server, Search, LogOut, UserCircle2, Plus, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./lib/api.js";
import Dashboard from "./pages/Dashboard.jsx";
import ServiceDetail from "./pages/ServiceDetail.jsx";
import Databases from "./pages/Databases.jsx";
import NewService from "./pages/NewService.jsx";
import NewDatabase from "./pages/NewDatabase.jsx";
import Login from "./pages/Login.jsx";
import { AuthProvider, RequireAuth, useAuth } from "./auth.jsx";
import { ThemeProvider, useTheme } from "./lib/theme.jsx";

function Sidebar() {
  const { user } = useAuth();

  const link = ({ isActive }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
        : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    }`;

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r p-3"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 py-3 mb-1">
        <div
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-bold text-sm"
          style={{ background: "var(--accent)", color: "var(--accent-contrast)", fontFamily: "'Space Grotesk', sans-serif" }}
        >
          D
        </div>
        <span
          className="text-sm font-bold tracking-tight"
          style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)", fontWeight: 700 }}
        >
          DebutDeploy
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        <NavLink to="/" end className={link}>
          <LayoutGrid className="h-4 w-4 shrink-0" /> Services
        </NavLink>
        <NavLink to="/databases" className={link}>
          <Database className="h-4 w-4 shrink-0" /> Databases
        </NavLink>

        {/* Divider */}
        <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />

        <NavLink to="/new" className={link}>
          <Plus className="h-4 w-4 shrink-0" /> New Service
        </NavLink>
        <NavLink to="/new-database" className={link}>
          <Plus className="h-4 w-4 shrink-0" /> New Database
        </NavLink>

        {user?.role === "admin" && (
          <>
            <div className="my-1.5 border-t" style={{ borderColor: "var(--border)" }} />
            <NavLink to="/servers" className={link}>
              <Server className="h-4 w-4 shrink-0" /> Servers
            </NavLink>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="mt-auto px-2 pt-3 text-[11px] mono" style={{ color: "var(--text-muted)" }}>
        v0.1 · Coolify · Hetzner
      </div>
    </aside>
  );
}

function Topbar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [mode, setMode] = useState(null);

  useEffect(() => {
    api.health().then((h) => setMode(h.mode)).catch(() => setMode("offline"));
  }, []);

  // map mode → pill class + label
  const modePill = {
    live:    { cls: "pill-ok",   label: "Live · Coolify" },
    demo:    { cls: "pill-warn", label: "Demo · Coolify" },
    offline: { cls: "pill-err",  label: "API offline" },
  }[mode] ?? null;

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b px-5"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="ml-auto flex items-center gap-2">
        {/* Mode pill */}
        {modePill && (
          <span className={`pill ${modePill.cls}`}>
            {/* ponytail: live dot is purely decorative */}
            <span
              className={`pulse-dot ${modePill.cls === "pill-ok" ? "bg-[var(--ok)]" : modePill.cls === "pill-warn" ? "bg-[var(--warn)]" : "bg-[var(--err)]"}`}
            />
            {modePill.label}
          </span>
        )}

        {/* User chip */}
        <div
          className="hidden sm:flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }}
        >
          <UserCircle2 className="h-4 w-4 shrink-0" />
          <span className="max-w-36 truncate" style={{ color: "var(--text)" }}>
            {user?.name || user?.email || "Signed in"}
          </span>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="btn btn-ghost"
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Logout */}
        <button onClick={logout} className="btn btn-ghost">
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}

function AppShell() {
  const location = useLocation();
  return (
    <div className="flex h-full" style={{ background: "var(--bg)" }}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main key={location.pathname} className="flex-1 overflow-y-auto p-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/services/:id" element={<ServiceDetail />} />
            <Route path="/databases" element={<Databases />} />
            <Route path="/new" element={<NewService />} />
            <Route path="/new-database" element={<NewDatabase />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

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
                <AppShell />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
