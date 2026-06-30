// ponytail: pure client-side state — persistence/attachment not wired to any backend yet.
// The Variable Groups model (named groups, scope, attach-to-services) differs from the old
// flat shared-vars API; wire up when backend supports it.

import { useEffect, useRef, useState } from "react";
import {
  Braces, Check, ChevronDown, ChevronRight,
  Eye, EyeOff, Lock, Plus, Trash2, X,
} from "lucide-react";
import { Button, Field, Input, PageHeader } from "../components/ui.jsx";

// ── seed data (from design handoff renderVals) ────────────────────────────────
const ALL_SERVICES = [
  "api-gateway", "web-storefront", "checkout-svc",
  "image-proxy", "analytics-api", "worker-billing",
  "notify-svc", "docs-site",
];

const SEED_GROUPS = [
  {
    id: "shared-prod",
    scope: "Global",
    vars: [
      { key: "SENTRY_DSN",      value: "https://3f8a@o91.ingest.sentry.io/42", secret: false },
      { key: "LOG_LEVEL",       value: "info",                                  secret: false },
      { key: "OTEL_EXPORTER",   value: "http://otel.internal:4317",             secret: false },
    ],
  },
  {
    id: "stripe-keys",
    scope: "Project: mflh",
    vars: [
      { key: "STRIPE_SECRET_KEY",      value: "sk_live_51Kj2aBxQp7Lm0Tz", secret: true },
      { key: "STRIPE_WEBHOOK_SECRET",  value: "whsec_9f3e8c1a2b4d",       secret: true },
    ],
  },
  {
    id: "postgres-mflh",
    scope: "Project: mflh",
    vars: [
      { key: "DATABASE_URL", value: "postgres://app:Xz9f2@db-mflh-pg.internal:5432/app", secret: true },
      { key: "PGSSLMODE",    value: "require",                                             secret: false },
    ],
  },
  {
    id: "redis-shared",
    scope: "Global",
    vars: [
      { key: "REDIS_URL", value: "redis://:a83Kd@cache-mflh.internal:6379", secret: true },
    ],
  },
];

const SEED_ASSIGNED = {
  "shared-prod":  ["api-gateway", "web-storefront", "worker-billing"],
  "stripe-keys":  ["api-gateway", "checkout-svc"],
  "postgres-mflh": ["api-gateway", "worker-billing"],
  "redis-shared": ["api-gateway", "web-storefront"],
};

const SCOPES = [
  "Global — all projects",
  "Project: mflh",
  "Project: data-platform",
  "Project: internal-tools",
];

// ── helpers ───────────────────────────────────────────────────────────────────
function ScopePill({ scope }) {
  const isGlobal = scope === "Global" || scope === "Global — all projects";
  return (
    <span
      className={`pill ${isGlobal ? "pill-neutral" : "pill-accent"}`}
      style={{ fontSize: 11 }}
    >
      {scope}
    </span>
  );
}

function mask(val) {
  return "•".repeat(Math.min(val.length, 24));
}

// ── create card ───────────────────────────────────────────────────────────────
function CreateCard({ onCancel, onCreate }) {
  const [name, setName]   = useState("");
  const [scope, setScope] = useState(SCOPES[0]);
  const [rows, setRows]   = useState([
    { key: "", value: "", secret: false },
    { key: "", value: "", secret: false },
  ]);

  function setRow(i, patch) {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }

  function addRow() {
    setRows(r => [...r, { key: "", value: "", secret: false }]);
  }

  function submit() {
    if (!name.trim()) return;
    const vars = rows.filter(r => r.key.trim());
    onCreate({
      id: name.trim(),
      scope: scope.startsWith("Global") ? "Global" : scope,
      vars: vars.length ? vars : [],
    });
  }

  return (
    <div style={{
      border: "1px solid var(--accent)",
      borderRadius: 13,
      background: "var(--surface)",
      boxShadow: "var(--shadow)",
      padding: "20px 22px",
      marginBottom: 18,
    }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
        New variable group
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div>
          <label className="label">Group name</label>
          <input
            className="input mono"
            placeholder="e.g. payments-secrets"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Scope</label>
          <div style={{ position: "relative" }}>
            <select
              className="input"
              style={{ appearance: "none", WebkitAppearance: "none", paddingRight: 30, cursor: "pointer" }}
              value={scope}
              onChange={e => setScope(e.target.value)}
            >
              {SCOPES.map(s => <option key={s}>{s}</option>)}
            </select>
            <ChevronDown
              size={14}
              style={{
                position: "absolute", right: 11, top: "50%",
                transform: "translateY(-50%)", pointerEvents: "none",
                color: "var(--text-muted)",
              }}
            />
          </div>
        </div>
      </div>

      <label className="label">Variables</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 92px", gap: 10, alignItems: "center" }}>
            <input
              className="input mono"
              placeholder="KEY"
              value={row.key}
              onChange={e => setRow(i, { key: e.target.value })}
            />
            <input
              className="input mono"
              placeholder="value"
              value={row.value}
              onChange={e => setRow(i, { value: e.target.value })}
              type={row.secret ? "password" : "text"}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                style={{ accentColor: "var(--accent)" }}
                checked={row.secret}
                onChange={e => setRow(i, { secret: e.target.checked })}
              />
              Secret
            </label>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={addRow}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 10px", borderRadius: 8,
            border: "1px dashed var(--border-strong)",
            background: "transparent", color: "var(--text-muted)",
            fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <Plus size={13} /> Add variable
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Create group</button>
        </div>
      </div>
    </div>
  );
}

// ── group card ────────────────────────────────────────────────────────────────
function GroupCard({ group, reveal, assigned, assignOpen, onToggleExpand, onToggleAssign, onOpenAssign }) {
  const expanded      = !!group.expanded;
  const assignedSvcs  = assigned[group.id] || [];
  const dropdownRef   = useRef(null);

  // close dropdown on outside click
  useEffect(() => {
    if (!assignOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onOpenAssign(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [assignOpen, onOpenAssign]);

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 13,
      background: "var(--surface)",
      boxShadow: "var(--shadow)",
      overflow: "visible",
    }}>
      {/* header row */}
      <div
        role="button"
        onClick={onToggleExpand}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 14, padding: "15px 18px", cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <ChevronRight
            size={16}
            style={{
              color: "var(--text-muted)",
              transition: "transform .15s",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              flexShrink: 0,
            }}
          />
          {/* {} tile */}
          <span style={{
            width: 30, height: 30, borderRadius: 8,
            background: "var(--accent-soft)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Braces size={16} style={{ color: "var(--accent-text)" }} />
          </span>

          <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            {group.id}
          </span>

          <ScopePill scope={group.scope} />

          <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {group.vars.length} variable{group.vars.length !== 1 ? "s" : ""}
          </span>

          {group.vars.some(v => v.secret) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
              <Lock size={12} /> secrets
            </span>
          )}
        </div>

        <span style={{ fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          Attached to {assignedSvcs.length} service{assignedSvcs.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* expanded body */}
      {expanded && (
        <div style={{ padding: "0 18px 18px" }}>
          {/* var table */}
          <div style={{
            border: "1px solid var(--border)", borderRadius: 10,
            overflow: "hidden", marginBottom: 16,
          }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1.5fr 80px", gap: 12,
              padding: "8px 14px",
              background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
              fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em",
              textTransform: "uppercase", color: "var(--text-muted)",
            }}>
              <span>Key</span><span>Value</span><span />
            </div>

            {group.vars.map((v, i) => (
              <div
                key={v.key || i}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 1.5fr 80px", gap: 12,
                  padding: "9px 14px",
                  borderBottom: i < group.vars.length - 1 ? "1px solid var(--border)" : "none",
                  alignItems: "center",
                }}
              >
                <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
                  {v.key}
                </span>
                <span className="mono" style={{
                  fontSize: 12, color: "var(--text-muted)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {v.secret && !reveal ? mask(v.value) : v.value}
                </span>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {v.secret && (
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      color: "var(--warn-text)",
                      background: "var(--warn-soft)",
                      padding: "2px 7px", borderRadius: 999,
                    }}>
                      secret
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* attached services */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{
                fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 9,
              }}>
                Attached to services
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center", position: "relative" }}>
                {/* service chips */}
                {assignedSvcs.map(svc => (
                  <span
                    key={svc}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "4px 6px 4px 10px", borderRadius: 999,
                      background: "var(--surface-2)", border: "1px solid var(--border)",
                      fontSize: 12, fontWeight: 500, color: "var(--text)",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", flexShrink: 0 }} />
                    {svc}
                    <button
                      onClick={e => { e.stopPropagation(); onToggleAssign(group.id, svc); }}
                      title={`Remove ${svc}`}
                      style={{
                        width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                        border: "none", background: "transparent", color: "var(--text-muted)",
                        cursor: "pointer", borderRadius: "50%", padding: 0,
                      }}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}

                {/* assign dropdown */}
                <div style={{ position: "relative" }} ref={dropdownRef}>
                  <button
                    onClick={e => { e.stopPropagation(); onOpenAssign(assignOpen ? null : group.id); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "5px 11px", borderRadius: 999,
                      border: "1px dashed var(--border-strong)",
                      background: "transparent", color: "var(--accent-text)",
                      fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <Plus size={13} /> Assign to service
                  </button>

                  {assignOpen && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, marginTop: 6,
                      width: 230,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 11, boxShadow: "var(--shadow-lg)",
                      padding: 6, zIndex: 30,
                      maxHeight: 240, overflowY: "auto",
                    }}>
                      {ALL_SERVICES.map(svc => {
                        const checked = assignedSvcs.includes(svc);
                        return (
                          <div
                            key={svc}
                            role="button"
                            onClick={e => { e.stopPropagation(); onToggleAssign(group.id, svc); }}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: 8, padding: "7px 9px", borderRadius: 7,
                              cursor: "pointer", fontSize: 12.5, color: "var(--text)",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <span className="mono">{svc}</span>
                            {checked && <Check size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function SharedVars() {
  const [reveal,     setReveal]     = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [groups,     setGroups]     = useState(SEED_GROUPS);
  const [expanded,   setExpanded]   = useState({ "shared-prod": true });
  const [assigned,   setAssigned]   = useState(SEED_ASSIGNED);
  const [assignOpen, setAssignOpen] = useState(null); // group id or null

  function toggleAssign(gid, svc) {
    setAssigned(prev => {
      const cur  = prev[gid] || [];
      const next = cur.includes(svc) ? cur.filter(x => x !== svc) : [...cur, svc];
      return { ...prev, [gid]: next };
    });
  }

  function toggleExpand(gid) {
    setExpanded(prev => ({ ...prev, [gid]: !prev[gid] }));
    setAssignOpen(null);
  }

  function handleCreate(newGroup) {
    setGroups(prev => [...prev, newGroup]);
    setExpanded(prev => ({ ...prev, [newGroup.id]: false }));
    setAssigned(prev => ({ ...prev, [newGroup.id]: [] }));
    setCreating(false);
  }

  return (
    <div style={{ padding: "0 0 44px", maxWidth: 1000 }}>
      <PageHeader
        title="Variable Groups"
        subtitle="Reusable sets of environment variables you can attach to any service."
        actions={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setReveal(r => !r)}
            >
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              {reveal ? "Hide values" : "Reveal values"}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setCreating(c => !c)}
            >
              <Plus size={16} /> New Group
            </button>
          </>
        }
      />

      {creating && (
        <CreateCard
          onCancel={() => setCreating(false)}
          onCreate={handleCreate}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {groups.map(g => (
          <GroupCard
            key={g.id}
            group={{ ...g, expanded: !!expanded[g.id] }}
            reveal={reveal}
            assigned={assigned}
            assignOpen={assignOpen === g.id}
            onToggleExpand={() => toggleExpand(g.id)}
            onToggleAssign={toggleAssign}
            onOpenAssign={setAssignOpen}
          />
        ))}
      </div>
    </div>
  );
}
