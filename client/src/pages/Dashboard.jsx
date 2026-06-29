import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Rocket, Plus, ChevronRight, Search } from "lucide-react";
import { api } from "../lib/api.js";
import {
  StatusPill, Spinner, Button, EmptyState, Mono, timeAgo, RuntimeIcon,
} from "../components/ui.jsx";

export default function Dashboard() {
  const [services, setServices] = useState(null);
  const [deploying, setDeploying] = useState({});
  const [query, setQuery] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api.services().then(setServices).catch(() => setServices([]));
  }, []);

  const filtered = useMemo(() => {
    if (!services) return [];
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.domain?.toLowerCase().includes(q) ||
        s.branch?.toLowerCase().includes(q) ||
        s.uuid?.toLowerCase().includes(q)
    );
  }, [services, query]);

  const counts = useMemo(() => {
    if (!services) return { total: 0, live: 0, issues: 0 };
    return {
      total: services.length,
      live: services.filter((s) => s.status === "running").length,
      issues: services.filter((s) =>
        ["degraded", "failed", "stopped"].includes(s.status || s.health)
      ).length,
    };
  }, [services]);

  async function quickDeploy(e, id) {
    e.stopPropagation();
    setDeploying((d) => ({ ...d, [id]: true }));
    try {
      await api.deploy(id);
    } finally {
      setTimeout(() => setDeploying((d) => ({ ...d, [id]: false })), 1200);
    }
  }

  if (!services) {
    return (
      <div className="flex h-64 items-center justify-center" style={{ color: "var(--text-muted)" }}>
        <Spinner className="mr-2" /> Loading services…
      </div>
    );
  }

  const newServiceBtn = (
    <Button variant="primary" onClick={() => nav("/new")}>
      <Plus className="h-4 w-4" /> New Service
    </Button>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "var(--text)" }}
          >
            Services
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {counts.total} services ·{" "}
            <span style={{ color: "var(--ok)" }}>{counts.live} live</span>
            {counts.issues > 0 && (
              <>
                {" "}·{" "}
                <span style={{ color: "var(--warn)" }}>{counts.issues} need attention</span>
              </>
            )}
          </p>
        </div>
        {newServiceBtn}
      </div>

      {/* True empty — no services at all */}
      {services.length === 0 && (
        <div className="card mt-8">
          <EmptyState
            title="No services yet"
            description="Deploy your first app or database to Coolify and it will appear here."
            action={
              <Link to="/new">
                <Button variant="primary">
                  <Plus className="h-4 w-4" /> Deploy your first one
                </Button>
              </Link>
            }
          />
        </div>
      )}

      {/* Search — only when there are services */}
      {services.length > 0 && (
        <div className="relative mb-5">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            className="input pl-9"
            placeholder="Search by name, domain, branch, or uuid…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* Search-empty state */}
      {services.length > 0 && filtered.length === 0 && (
        <EmptyState
          title={`No results for "${query}"`}
          description="Try a different name, domain, or branch."
        />
      )}

      {/* Service cards */}
      {filtered.length > 0 && (
        <div
          className="overflow-hidden rounded-xl"
          style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
        >
          {filtered.map((s, i) => (
            <div
              key={s.uuid}
              onClick={() => nav(`/services/${s.uuid}`)}
              className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors"
              style={{
                borderTop: i !== 0 ? "1px solid var(--border)" : undefined,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            >
              {/* Runtime icon */}
              <RuntimeIcon runtime={s.runtime} />

              {/* Name + meta */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate font-medium" style={{ color: "var(--text)" }}>
                    {s.name}
                  </span>
                  {s.type && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                      style={{
                        background: "var(--surface-2)",
                        color: "var(--text-muted)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {s.type}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {s.branch && <span>{s.branch}</span>}
                  {s.domain && (
                    <span
                      className="truncate"
                      style={{ color: "var(--accent)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={s.domain.startsWith("http") ? s.domain : `https://${s.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--accent)" }}
                      >
                        {s.domain}
                      </a>
                    </span>
                  )}
                  {/* uuid short + last deploy — mono */}
                  <Mono className="hidden sm:inline" style={{ color: "var(--text-muted)" }}>
                    {s.uuid?.slice(0, 8)}
                  </Mono>
                </div>
              </div>

              {/* Last deploy — hidden on small */}
              <div className="hidden w-24 shrink-0 text-xs sm:block" style={{ color: "var(--text-muted)" }}>
                <Mono>{timeAgo(s.lastDeployedAt)}</Mono>
              </div>

              {/* Status pill */}
              <div className="shrink-0">
                <StatusPill status={s.status} />
              </div>

              {/* Quick deploy — appears on hover */}
              <Button
                variant="ghost"
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => quickDeploy(e, s.uuid)}
                disabled={deploying[s.uuid]}
              >
                {deploying[s.uuid] ? <Spinner /> : <Rocket className="h-4 w-4" />}
                <span className="hidden sm:inline">Deploy</span>
              </Button>

              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--border)" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
