import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Layers, Search, GitBranch, ExternalLink, LayoutGrid, List, Plus, Lock,
} from "lucide-react";
import { api } from "../lib/api.js";
import {
  PageHeader, Button, StatusPill, Spinner, timeAgo,
} from "../components/ui.jsx";
import BuildQueue from "../components/BuildQueue.jsx";

// Health light for the runtime cell: green up / amber mid / red down / grey unknown.
// (Was a language-colour dot keyed to Node/Go/Python — those never matched the real
//  runtime values nixpacks/dockerfile/static, so every dot rendered grey anyway.)
function statusLight(status) {
  if (["running", "healthy", "success"].includes(status)) return "var(--ok)";
  if (["building", "deploying", "in_progress", "degraded"].includes(status)) return "var(--warn)";
  if (["exited", "failed", "error", "unhealthy", "stopped"].includes(status)) return "var(--err)";
  return "var(--text-muted)";
}

// Turn a git remote (git@github.com:owner/repo.git or https://github.com/owner/repo)
// into a browsable GitHub URL, or null if it isn't recognisably a repo.
function repoHref(repo) {
  const m = String(repo || "").match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
  if (m) return `https://github.com/${m[1]}`;
  return /^https?:\/\//.test(repo || "") ? repo : null;
}

// Repo text that links straight to the repo when possible. stopPropagation so clicking
// it inside a clickable card/row opens GitHub instead of navigating to the service.
function RepoText({ repo, name, isPrivate }) {
  const href = repoHref(repo);
  const label = repo || name;
  // Lock marks private repos — GitHub 404s their web URL for anyone not signed in
  // with access, so the icon explains "not a broken link, just private".
  const lock = isPrivate ? (
    <Lock size={11} style={{ flexShrink: 0, opacity: 0.7 }} aria-label="Private repository" />
  ) : null;
  if (!href) return <>{lock}{label}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
       title={isPrivate ? "Private repository — opens on GitHub (sign-in required)" : "Open repository on GitHub"}
       style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "inherit", textDecoration: "none" }}
       onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
       onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}>
      {lock}{label}
    </a>
  );
}

function RuntimeChip({ runtime, status }) {
  return (
    <span
      title={`Status: ${status || "unknown"}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px",
        borderRadius: 6, background: "var(--surface-2)", border: "1px solid var(--border)",
        fontSize: 11.5, fontWeight: 500, color: "var(--text)",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusLight(status), flexShrink: 0 }} />
      {runtime || "Unknown"}
    </span>
  );
}

// 6 shimmer skeleton cards for loading state
function SkeletonGrid() {
  const sk = {
    background: "linear-gradient(90deg,var(--surface-2) 25%,var(--border) 50%,var(--surface-2) 75%)",
    backgroundSize: "200% 100%",
    animation: "dd-shimmer 1.5s linear infinite",
    borderRadius: 6,
    display: "block",
  };
  return (
    <div className="services-grid">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            display: "flex", flexDirection: "column", gap: 13, padding: 17,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, boxShadow: "var(--shadow)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ ...sk, width: "42%", height: 15 }} />
            <span style={{ ...sk, width: 64, height: 20, borderRadius: 999 }} />
          </div>
          <span style={{ ...sk, width: "70%", height: 13 }} />
          <div style={{ height: 1, background: "var(--border)" }} />
          <span style={{ ...sk, width: "85%", height: 12 }} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ ...sk, width: 64, height: 22, borderRadius: 6 }} />
            <span style={{ ...sk, width: 54, height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function GridCard({ s, onClick }) {
  const [hovered, setHovered] = useState(false);
  const domain = s.domain;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", flexDirection: "column", gap: 13, padding: "17px 17px 15px",
        background: "var(--surface)", border: `1px solid ${hovered ? "var(--border-strong)" : "var(--border)"}`,
        borderRadius: 8, cursor: "pointer",
        transition: "transform .15s, box-shadow .15s, border-color .15s",
        boxShadow: hovered ? "var(--shadow-lg)" : "var(--shadow)",
        transform: hovered ? "translateY(-2px)" : "none",
      }}
    >
      {/* Name + status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{
          fontSize: 15, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.005em",
          flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "'Inter', sans-serif",
        }}>
          {s.name}
        </span>
        <StatusPill status={s.status === "healthy" ? "healthy" : s.status} />
      </div>

      {/* Domain */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 18, minWidth: 0 }}>
        {domain ? (
          <a
            href={domain.startsWith("http") ? domain : `https://${domain}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%",
              fontSize: 13, color: "var(--accent-text)", textDecoration: "none", fontWeight: 500,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{domain}</span>
            <ExternalLink size={12} style={{ flexShrink: 0 }} />
          </a>
        ) : (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Internal service</span>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "var(--border)" }} />

      {/* Repo / branch / runtime / last deploy */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: "var(--text-muted)",
        }}>
          <GitBranch size={13} style={{ flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <RepoText repo={s.repo} name={s.name} isPrivate={s.repoPrivate} />
          </span>
          <span style={{ color: "var(--border-strong)" }}>·</span>
          <span style={{ color: "var(--text)" }}>{s.branch || "main"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <RuntimeChip runtime={s.runtime} status={s.status} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {s.lastDeployedAt ? timeAgo(s.lastDeployedAt) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ListTable({ services, onRowClick }) {
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
    <div style={{
      minWidth: 720,
      border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
      background: "var(--surface)", boxShadow: "var(--shadow)",
    }}>
      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "1.6fr 1fr 1.5fr 0.9fr 0.9fr 0.8fr",
        gap: 12, padding: "11px 18px",
        background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
        fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase",
        color: "var(--text-muted)",
      }}>
        <span>Service</span>
        <span>Status</span>
        <span>Domain</span>
        <span>Runtime</span>
        <span>Region</span>
        <span style={{ textAlign: "right" }}>Last deploy</span>
      </div>

      {/* Rows */}
      {services.map((s) => (
        <ListRow key={s.uuid} s={s} onClick={() => onRowClick(s.uuid)} />
      ))}
    </div>
    </div>
  );
}

function ListRow({ s, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: "1.6fr 1fr 1.5fr 0.9fr 0.9fr 0.8fr",
        gap: 12, padding: "13px 18px",
        borderBottom: "1px solid var(--border)",
        alignItems: "center", cursor: "pointer",
        background: hovered ? "var(--surface-2)" : "transparent",
        transition: "background .12s",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{
          fontSize: 13.5, fontWeight: 600, color: "var(--text)", fontFamily: "'Inter', sans-serif",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {s.name}
        </span>
        <span style={{
          fontFamily: "'Geist Mono', monospace", fontSize: 11, color: "var(--text-muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          <RepoText repo={s.repo} name={s.name} isPrivate={s.repoPrivate} /> · {s.branch || "main"}
        </span>
      </div>
      <div style={{ minWidth: 0 }}><StatusPill status={s.status} /></div>
      <div style={{
        fontSize: 13, color: "var(--accent-text)", minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {s.domain || "—"}
      </div>
      <div title={`Status: ${s.status || "unknown"}`} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12.5, color: "var(--text)" }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
          background: statusLight(s.status),
        }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.runtime || "—"}</span>
      </div>
      <div style={{
        fontSize: 12.5, color: "var(--text-muted)", minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {s.region || "—"}
      </div>
      <div style={{ textAlign: "right", fontSize: 12.5, color: "var(--text-muted)" }}>
        {s.lastDeployedAt ? timeAgo(s.lastDeployedAt) : "—"}
      </div>
    </div>
  );
}

function EmptyDashed() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", padding: "64px 24px",
      border: "1px dashed var(--border-strong)", borderRadius: 8,
      background: "var(--surface)",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 8, background: "var(--accent-soft)",
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18,
      }}>
        <Layers size={26} style={{ color: "var(--accent-text)" }} strokeWidth={1.7} />
      </div>
      <h3 style={{
        margin: "0 0 6px", fontFamily: "'Inter', sans-serif", fontSize: 18,
        fontWeight: 600, color: "var(--text)",
      }}>
        No services yet
      </h3>
      <p style={{
        margin: "0 0 20px", fontSize: 13.5, color: "var(--text-muted)",
        maxWidth: 340, lineHeight: 1.55,
      }}>
        Deploy your first app from a GitHub repository. It takes about two minutes.
      </p>
      <Link to="/new">
        <Button variant="primary">
          <Plus size={16} /> Deploy your first app
        </Button>
      </Link>
    </div>
  );
}

// Nice labels for known statuses; anything else is Title-cased from its raw value.
const STATUS_LABELS = {
  running: "Running", healthy: "Healthy", building: "Building", deploying: "Deploying",
  stopped: "Stopped", exited: "Exited", unhealthy: "Unhealthy", failed: "Failed",
  error: "Error", unknown: "Unknown",
};
const labelFor = (v) => STATUS_LABELS[v] || (v ? v[0].toUpperCase() + v.slice(1) : v);

export default function Dashboard() {
  const [services, setServices] = useState(null); // null = loading
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState("grid"); // "grid" | "list"
  const nav = useNavigate();

  useEffect(() => {
    api.services().then(setServices).catch(() => setServices([]));
  }, []);

  const filtered = useMemo(() => {
    if (!services) return [];
    const q = query.trim().toLowerCase();
    return services.filter((s) => {
      const matchQ = !q ||
        s.name?.toLowerCase().includes(q) ||
        s.repo?.toLowerCase().includes(q) ||
        s.domain?.toLowerCase().includes(q) ||
        s.branch?.toLowerCase().includes(q);
      const matchStatus = !statusFilter || s.status === statusFilter;
      return matchQ && matchStatus;
    });
  }, [services, query, statusFilter]);

  // Filter options DERIVED from the data, so every real status (exited, unknown, …)
  // is always selectable — a hardcoded list silently dropped whatever it forgot.
  const statusOptions = useMemo(() => {
    const present = [...new Set((services || []).map((s) => s.status).filter(Boolean))].sort();
    return [{ value: "", label: "All statuses" }, ...present.map((v) => ({ value: v, label: labelFor(v) }))];
  }, [services]);

  const subtitle = useMemo(() => {
    if (!services) return "";
    const running = services.filter((s) => s.status === "running" || s.status === "healthy").length;
    return `${services.length} service${services.length !== 1 ? "s" : ""} · ${running} running`;
  }, [services]);

  const iconBtnStyle = (active) => ({
    width: 30, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 6, border: "none", cursor: "pointer",
    background: active ? "var(--surface-2)" : "transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
    transition: "background .12s",
  });

  return (
    <div className="page">
      {/* ── Header ── */}
      <PageHeader
        title="Services"
        subtitle={subtitle}
        actions={
          <Link to="/new">
            <Button variant="primary">
              <Plus size={16} /> New Service
            </Button>
          </Link>
        }
      />

      {/* ── Live build queue (Render-style; silent when nothing's deploying) ── */}
      <BuildQueue />

      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 14, marginBottom: 18, flexWrap: "wrap",
      }}>
        {/* Left: search + status filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Search */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <Search
              size={15}
              style={{ position: "absolute", left: 11, pointerEvents: "none", color: "var(--text-muted)" }}
            />
            <input
              className="input"
              placeholder="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 230, paddingLeft: 33 }}
            />
          </div>

          {/* Status select */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <select
              className="select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ appearance: "none", WebkitAppearance: "none", paddingRight: 30 }}
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {/* chevron */}
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: "absolute", right: 10, pointerEvents: "none" }}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>

        {/* Right: grid/list toggle */}
        <div style={{
          display: "flex", gap: 2, padding: 3,
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--surface)",
        }}>
          <button
            title="Grid"
            onClick={() => setView("grid")}
            style={iconBtnStyle(view === "grid")}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            title="List"
            onClick={() => setView("list")}
            style={iconBtnStyle(view === "list")}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* ── Loading ── */}
      {services === null && <SkeletonGrid />}

      {/* ── Empty (no services at all) ── */}
      {services !== null && services.length === 0 && <EmptyDashed />}

      {/* ── Search/filter empty ── */}
      {services !== null && services.length > 0 && filtered.length === 0 && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "48px 24px", textAlign: "center",
          border: "1px dashed var(--border-strong)", borderRadius: 8,
          background: "var(--surface)",
        }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: "0 0 6px" }}>
            No matching services
          </p>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: 0 }}>
            Try a different name, repo, or status filter.
          </p>
        </div>
      )}

      {/* ── Grid view ── */}
      {services !== null && filtered.length > 0 && view === "grid" && (
        <div className="services-grid">
          {filtered.map((s) => (
            <GridCard key={s.uuid} s={s} onClick={() => nav(`/services/${s.uuid}`)} />
          ))}
        </div>
      )}

      {/* ── List view ── */}
      {services !== null && filtered.length > 0 && view === "list" && (
        <ListTable services={filtered} onRowClick={(uuid) => nav(`/services/${uuid}`)} />
      )}
    </div>
  );
}
