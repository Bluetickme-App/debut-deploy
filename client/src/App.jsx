import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { LayoutGrid, Database, Server, Search, LogOut, UserCircle2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./lib/api.js";
import Dashboard from "./pages/Dashboard.jsx";
import ServiceDetail from "./pages/ServiceDetail.jsx";
import Databases from "./pages/Databases.jsx";
import NewService from "./pages/NewService.jsx";
import NewDatabase from "./pages/NewDatabase.jsx";
import Login from "./pages/Login.jsx";
import { AuthProvider, RequireAuth, useAuth } from "./auth.jsx";

function Sidebar() {
  const { user } = useAuth();
  const link = ({ isActive }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
    }`;
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/8 bg-[#0e1117] p-3">
      <div className="flex items-center gap-2 px-2 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500 font-bold text-white">
          D
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">DebutDeploy</div>
          <div className="text-[11px] text-zinc-500">Coolify · Hetzner</div>
        </div>
      </div>
      <nav className="mt-2 flex flex-col gap-1">
        <NavLink to="/" end className={link}>
          <LayoutGrid className="h-4 w-4" /> Services
        </NavLink>
        <NavLink to="/databases" className={link}>
          <Database className="h-4 w-4" /> Databases
        </NavLink>
        <NavLink to="/new" className={link}>
          <Plus className="h-4 w-4" /> New Service
        </NavLink>
        <NavLink to="/new-database" className={link}>
          <Plus className="h-4 w-4" /> New Database
        </NavLink>
        {user?.role === "admin" && (
          <a className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600">
            <Server className="h-4 w-4" /> Servers
          </a>
        )}
      </nav>
      <div className="mt-auto px-2 text-[11px] text-zinc-600">
        Scaffold v0.1 · {new Date().getFullYear()}
      </div>
    </aside>
  );
}

function Topbar() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState(null);
  useEffect(() => {
    api.health().then((h) => setMode(h.mode)).catch(() => setMode("offline"));
  }, []);
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/8 px-6">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          placeholder="Search services…"
          className="w-full rounded-lg border border-white/8 bg-[#13161d] py-1.5 pl-9 pr-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
        />
      </div>
      <div className="ml-auto flex items-center gap-3">
        {mode && (
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              mode === "live"
                ? "bg-emerald-500/15 text-emerald-300"
                : mode === "demo"
                ? "bg-amber-500/15 text-amber-300"
                : "bg-rose-500/15 text-rose-300"
            }`}
          >
            {mode === "demo" ? "Demo data" : mode === "live" ? "Live · Coolify" : "API offline"}
          </span>
        )}
        <div className="hidden items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-sm text-zinc-300 sm:flex">
          <UserCircle2 className="h-4 w-4 text-zinc-500" />
          <span className="max-w-40 truncate">{user?.name || user?.email || "Signed in"}</span>
        </div>
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.04] px-3 py-1.5 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </header>
  );
}

function AppShell() {
  const location = useLocation();
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main key={location.pathname} className="flex-1 overflow-y-auto">
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
  );
}
