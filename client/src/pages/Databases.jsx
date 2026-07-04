import { useEffect, useState } from "react";
import { Database, Server, Cpu, MemoryStick, HardDrive, Plus, Play, Square, Trash2, ChevronDown, ChevronUp, Archive } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import {
  Button, Card, EmptyState, Field, Input, Mono, PageHeader, Select, Spinner, StatusPill,
} from "../components/ui.jsx";
import { useAuth } from "../auth.jsx";

const DB_LABEL = {
  postgresql: "PostgreSQL",
  redis:      "Redis / Valkey",
  mysql:      "MySQL",
  mariadb:    "MariaDB",
  mongodb:    "MongoDB",
};

// ponytail: mask keeps first 12 chars + "…" to avoid leaking full internal URLs in the UI
function maskUrl(url) {
  if (!url) return "—";
  return url.length > 40 ? url.slice(0, 40) + "…" : url;
}

async function dbAction(uuid, action) {
  // Delete is DELETE /api/databases/:id (no action suffix); start/stop are POST
  // /api/databases/:id/<action>. Appending "/delete" hits no route → silent 404.
  const url = action === "delete" ? `/api/databases/${uuid}` : `/api/databases/${uuid}/${action}`;
  return fetch(url, {
    method: action === "delete" ? "DELETE" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
}

export default function Databases() {
  const [dbs, setDbs]       = useState(null);
  const [servers, setServers] = useState(null);
  const [busy, setBusy]     = useState({});
  const { user }            = useAuth();

  useEffect(() => {
    api.databases().then(setDbs).catch(() => setDbs([]));
    if (user?.role === "admin") {
      api.servers().then(setServers).catch(() => setServers([]));
    } else {
      setServers([]);
    }
  }, [user]);

  async function handleAction(uuid, action) {
    if (action === "delete" && !window.confirm("Delete this database? This cannot be undone.")) return;
    setBusy(b => ({ ...b, [uuid]: action }));
    try {
      const res = await dbAction(uuid, action);
      if (!res.ok) { alert(`Failed to ${action} database (${res.status})`); return; }
      api.databases().then(setDbs).catch(() => {});
    } finally {
      setBusy(b => { const n = { ...b }; delete n[uuid]; return n; });
    }
  }

  if (!dbs || servers === null) {
    return (
      <div className="flex h-64 items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
        <Spinner /> Loading…
      </div>
    );
  }

  const subtitle = [
    user?.role === "admin" ? `${servers.length} server${servers.length !== 1 ? "s" : ""}` : null,
    `${dbs.length} database${dbs.length !== 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="page">
      <PageHeader
        title="Infrastructure"
        subtitle={subtitle}
        actions={
          <Link to="/new-database">
            <Button variant="primary"><Plus className="h-4 w-4" /> New Database</Button>
          </Link>
        }
      />

      {/* Server cards — admin only */}
      {user?.role === "admin" && servers.length > 0 && (
        <div className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {servers.map(s => {
            const status = !s.reachable ? "stopped" : s.usable ? "running" : "degraded";
            return (
              <Card key={s.uuid}>
                <div className="flex items-center gap-3">
                  <Server className="h-5 w-5 shrink-0" style={{ color: "var(--text-muted)" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate" style={{ color: "var(--text)" }}>{s.name}</span>
                      {s.isHost && <span className="pill pill-muted text-[10px] uppercase tracking-wider">host</span>}
                      {s.serverType && <span className="pill pill-muted text-[10px] uppercase tracking-wider">{s.serverType}</span>}
                    </div>
                    <div className="mono text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                      {[s.ip, s.region].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <StatusPill status={status} />
                </div>

                {/* Real hardware capacity (Hetzner). "—" when unknown (e.g. localhost). */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Spec icon={Cpu}         label="CPU"  value={s.cores    != null ? `${s.cores} vCPU` : "—"} />
                  <Spec icon={MemoryStick} label="RAM"  value={s.memoryGb != null ? `${s.memoryGb} GB` : "—"} />
                  <Spec icon={HardDrive}   label="Disk" value={s.diskGb   != null ? `${s.diskGb} GB` : "—"} />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2.5 text-xs" style={{ borderColor: "var(--border)" }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    {s.resourceCount != null ? `${s.resourceCount} resource${s.resourceCount === 1 ? "" : "s"} deployed` : "—"}
                    {s.monthly ? ` · €${s.monthly}/mo` : ""}
                  </span>
                  {!s.reachable ? (
                    <span style={{ color: "var(--err-text)" }}>Unreachable — check or remove</span>
                  ) : !s.usable ? (
                    <span style={{ color: "var(--warn-text)" }}>Reachable, not validated (jq/docker)</span>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Databases section */}
      <p className="label mb-3">Databases</p>

      {dbs.length === 0 ? (
        <EmptyState
          title="No databases yet"
          description="Provision a PostgreSQL, MySQL, Redis, or MongoDB instance on your Coolify server."
          action={
            <Link to="/new-database">
              <Button variant="primary"><Plus className="h-4 w-4" /> New Database</Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {dbs.map(d => (
            <Card key={d.uuid} className="flex flex-col gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Icon */}
                <Database className="h-5 w-5 shrink-0" style={{ color: "var(--accent)" }} />

                {/* Name + type badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/databases/${d.uuid}`}
                      className="font-semibold transition-colors"
                      style={{ color: "var(--text)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-text)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text)")}
                    >
                      {d.name}
                    </Link>
                    <span className="pill pill-muted text-[10px] uppercase tracking-wider">
                      {DB_LABEL[d.type] || d.type}{d.version ? ` ${d.version}` : ""}
                    </span>
                  </div>
                  <Mono className="mt-0.5 block truncate" style={{ color: "var(--text-muted)" }}>
                    {maskUrl(d.internalUrl)}
                  </Mono>
                </div>

                {/* Size / connections */}
                {(d.sizeMb != null || d.connections != null) && (
                  <div className="text-right text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                    {d.sizeMb != null && <div>{(d.sizeMb / 1024).toFixed(1)} GB</div>}
                    {d.connections != null && <div>{d.connections} conns</div>}
                  </div>
                )}

                {/* Status */}
                <StatusPill status={d.status} />

                {/* Controls */}
                <div className="flex items-center gap-1 ml-1">
                  {busy[d.uuid] ? (
                    <Spinner />
                  ) : (
                    <>
                      {d.status === "stopped" ? (
                        <button
                          onClick={() => handleAction(d.uuid, "start")}
                          title="Start"
                          className="btn btn-ghost p-1.5"
                          style={{ color: "var(--ok)" }}
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction(d.uuid, "stop")}
                          title="Stop"
                          className="btn btn-ghost p-1.5"
                          style={{ color: "var(--warn)" }}
                        >
                          <Square className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(d.uuid, "delete")}
                        title="Delete"
                        className="btn btn-ghost p-1.5"
                        style={{ color: "var(--err)" }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Logical DBs */}
              {d.logicalDbs?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
                  {d.logicalDbs.map(name => (
                    <Mono
                      key={name}
                      className="rounded-md px-2 py-0.5"
                      style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
                    >
                      {name}
                    </Mono>
                  ))}
                </div>
              )}

              {/* Backups */}
              <BackupsPanel dbUuid={d.uuid} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ponytail: collapsed by default so the DB list stays scannable
function BackupsPanel({ dbUuid }) {
  const [open, setOpen]         = useState(false);
  const [config, setConfig]     = useState(null);
  const [frequency, setFreq]    = useState("0 2 * * *");
  const [saving, setSaving]     = useState(false);
  const [running, setRunning]   = useState(false);
  const [msg, setMsg]           = useState(null);

  useEffect(() => {
    if (!open) return;
    api.getBackupConfig(dbUuid)
      .then(c => { setConfig(c); if (c?.frequency) setFreq(c.frequency); })
      .catch(() => setConfig({}));
  }, [open, dbUuid]);

  async function save(e) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      await api.setBackupSchedule(dbUuid, { frequency });
      setMsg({ ok: true, text: "Schedule saved." });
      api.getBackupConfig(dbUuid).then(setConfig).catch(() => {});
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally { setSaving(false); }
  }

  async function runNow() {
    setRunning(true); setMsg(null);
    try {
      await api.triggerBackup(dbUuid);
      setMsg({ ok: true, text: "Backup started." });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally { setRunning(false); }
  }

  return (
    <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs font-medium w-full"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}
      >
        <Archive className="h-3.5 w-3.5" />
        Backups
        {config?.enabled && <span className="pill pill-ok ml-1" style={{ fontSize: "10px", padding: "1px 6px" }}>Scheduled</span>}
        {open ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {config === null ? (
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <Spinner /> Loading…
            </div>
          ) : (
            <form onSubmit={save} className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-48">
                <Field label="Cron schedule">
                  <Input
                    className="mono text-xs"
                    value={frequency}
                    onChange={e => setFreq(e.target.value)}
                    placeholder="0 2 * * *"
                  />
                </Field>
              </div>
              <Button type="submit" variant="default" disabled={saving || !frequency.trim()}>
                {saving ? <Spinner /> : null} Save schedule
              </Button>
              <Button type="button" variant="default" onClick={runNow} disabled={running}>
                {running ? <Spinner /> : <Play className="h-3.5 w-3.5" />} Back up now
              </Button>
            </form>
          )}
          {msg && (
            <p className="text-xs" style={{ color: msg.ok ? "var(--ok)" : "var(--err)" }}>{msg.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Coolify's REST exposes no live host CPU/RAM/disk %, so we show real capacity
// (from Hetzner) as a labelled chip rather than a fake usage gauge.
function Spec({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md border px-2.5 py-2" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
      <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold" style={{ color: "var(--text)" }}>{value}</div>
    </div>
  );
}
