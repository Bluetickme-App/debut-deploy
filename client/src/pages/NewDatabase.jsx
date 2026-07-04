import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database } from "lucide-react";
import {
  Button, Card, Field, Input, PageHeader, Select, Spinner,
} from "../components/ui.jsx";
import ServerPicker from "../components/ServerPicker.jsx";
import { api } from "../lib/api.js";

const PG_VERSIONS = ["", "17", "16", "15", "14", "13"]; // "" = Coolify default (latest)

const DB_TYPES = [
  { value: "postgresql", label: "PostgreSQL",      desc: "Reliable relational DB, great default" },
  { value: "redis",      label: "Redis / Valkey",  desc: "In-memory cache & pub/sub" },
  { value: "mysql",      label: "MySQL",           desc: "Widely-compatible relational DB" },
  { value: "mariadb",    label: "MariaDB",         desc: "MySQL-compatible, fully open-source" },
  { value: "mongodb",    label: "MongoDB",         desc: "Flexible document store" },
];

export default function NewDatabase() {
  const navigate              = useNavigate();
  const [type, setType]       = useState("postgresql");
  const [name, setName]       = useState("");
  const [projectUuid, setProjectUuid] = useState("");
  const [version, setVersion] = useState("");
  const [region, setRegion]   = useState("");
  const [projects, setProjects] = useState([]);
  const [regions, setRegions]   = useState([]);
  const [servers, setServers]   = useState([]);
  const [serverUuid, setServerUuid] = useState("");
  const [submitting, setSub]  = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.projects().then((p) => setProjects(Array.isArray(p) ? p : [])).catch(() => setProjects([]));
    api.hetznerLocations().then((l) => { const arr = Array.isArray(l) ? l : []; setRegions(arr); if (arr[0]) setRegion(arr[0].name); }).catch(() => setRegions([]));
    api.servers().then((s) => setServers(Array.isArray(s) ? s : [])).catch(() => setServers([]));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSub(true);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name: name.trim(), projectUuid: projectUuid || undefined, version: version || undefined, serverUuid: serverUuid || undefined }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({}));
        throw new Error(msg || `HTTP ${res.status}`);
      }
      navigate("/databases");
    } catch (err) {
      setError(err.message);
      setSub(false);
    }
  }

  const selected = DB_TYPES.find(t => t.value === type);

  return (
    <div className="page">
      <PageHeader
        title="New Database"
        subtitle="Provision a managed database on Coolify."
      />

      <Card>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Database type">
              <Select value={type} onChange={e => setType(e.target.value)}>
                {DB_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
              {selected?.desc && (
                <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>{selected.desc}</p>
              )}
            </Field>

            <Field label="Database name">
              <Input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="my-db"
              />
            </Field>

            <Field label="Project (optional)">
              <Select value={projectUuid} onChange={e => setProjectUuid(e.target.value)}>
                <option value="">No project (ungrouped)</option>
                {projects.map(p => <option key={p.uuid} value={p.uuid}>{p.name}</option>)}
              </Select>
              <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>Add this database to a project.</p>
            </Field>

            <Field label="Region">
              <Select value={region} onChange={e => setRegion(e.target.value)}>
                {regions.length === 0 && <option value="">Falkenstein (EU Central)</option>}
                {regions.map(r => <option key={r.name} value={r.name}>{r.city || r.name}{r.country ? ` (${r.country})` : ""}</option>)}
              </Select>
              <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>Databases run on the shared host; services in the same region share a private network.</p>
            </Field>

            <ServerPicker servers={servers} value={serverUuid} onChange={setServerUuid} />

            {type === "postgresql" && (
              <Field label="PostgreSQL version">
                <Select value={version} onChange={e => setVersion(e.target.value)}>
                  {PG_VERSIONS.map(v => <option key={v || "default"} value={v}>{v ? `PostgreSQL ${v}` : "Latest (default)"}</option>)}
                </Select>
              </Field>
            )}
          </div>

          {error && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background: "color-mix(in srgb, var(--err) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--err) 25%, transparent)",
                color: "var(--err)",
              }}
            >
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" disabled={!name.trim() || submitting}>
            {submitting
              ? <><Spinner /> Creating…</>
              : <><Database className="h-4 w-4" /> Create database</>}
          </Button>
        </form>
      </Card>
    </div>
  );
}
