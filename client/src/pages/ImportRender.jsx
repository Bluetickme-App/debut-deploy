import { useState } from "react";
import { Download, CheckCircle, XCircle, MinusCircle, ExternalLink } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Card, Field, Input, PageHeader, Spinner } from "../components/ui.jsx";

// Step status badge — maps Render migration step statuses to icons/colours
function StepBadge({ status }) {
  if (status === "ok") return <CheckCircle className="h-4 w-4 shrink-0" style={{ color: "var(--ok)" }} />;
  if (status === "error") return <XCircle className="h-4 w-4 shrink-0" style={{ color: "var(--err)" }} />;
  return <MinusCircle className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />;
}

export default function ImportRender() {
  // Step 1 — API key + service list
  const [apiKey, setApiKey] = useState("");
  const [services, setServices] = useState(null); // null = not fetched yet
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");

  // Step 2 — service selection + infra target
  const [selected, setSelected] = useState(null); // service object
  const [mode, setMode] = useState("shared");
  const [serverType, setServerType] = useState("");
  const [location, setLocation] = useState("");

  // Step 3 — migration result
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState(null); // { ok, appUuid, url, steps }
  const [migrateError, setMigrateError] = useState("");

  async function listServices(e) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setListBusy(true);
    setListError("");
    setServices(null);
    setSelected(null);
    setResult(null);
    try {
      const data = await api.renderServices(apiKey);
      setServices(Array.isArray(data) ? data : []);
    } catch (err) {
      setListError(err.message || "Failed to list services");
    } finally {
      setListBusy(false);
    }
  }

  async function migrate() {
    setMigrating(true);
    setMigrateError("");
    setResult(null);
    try {
      const target = { mode };
      if (mode === "dedicated") {
        if (serverType.trim()) target.serverType = serverType.trim();
        if (location.trim()) target.location = location.trim();
      }
      const data = await api.importRender({
        renderServiceId: selected.id,
        target,
        apiKey, // ponytail: kept in state only, never in URL/query
      });
      setResult(data);
    } catch (err) {
      setMigrateError(err.message || "Migration failed");
    } finally {
      setMigrating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader
        title="Import from Render"
        subtitle="Migrate a Render service to Coolify on Hetzner."
      />

      {/* Step 1: API key */}
      <Card>
        <form onSubmit={listServices} className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Render API key" className="flex-1 min-w-[14rem]">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="rnd_…"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" disabled={listBusy || !apiKey.trim()}>
            {listBusy ? <><Spinner /> Listing…</> : <><Download className="h-4 w-4" /> List services</>}
          </Button>
        </form>
        {listError && (
          <p className="px-4 pb-4 text-sm" style={{ color: "var(--err)" }}>{listError}</p>
        )}
      </Card>

      {/* Step 2: service picker */}
      {services !== null && (
        <Card className="mt-6">
          <div className="px-4 pt-4 pb-2 font-medium text-sm" style={{ color: "var(--text-muted)" }}>
            {services.length === 0 ? "No services found on this account." : "Select a service to migrate"}
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {services.map((svc) => (
              <li
                key={svc.id}
                onClick={() => { setSelected(svc); setResult(null); setMigrateError(""); }}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                style={{
                  background: selected?.id === svc.id ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined,
                  borderLeft: selected?.id === svc.id ? "3px solid var(--accent)" : "3px solid transparent",
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" style={{ color: "var(--text)" }}>{svc.name}</div>
                  <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {svc.repo}{svc.branch ? ` @ ${svc.branch}` : ""}{svc.type ? ` · ${svc.type}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Infra target (shown once a service is selected) */}
          {selected && (
            <div className="px-4 py-4 space-y-4" style={{ borderTop: "1px solid var(--border)" }}>
              <Field label="Deployment target">
                <div className="flex gap-4 mt-1">
                  {["shared", "dedicated"].map((m) => (
                    <label key={m} className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--text)" }}>
                      <input
                        type="radio"
                        name="mode"
                        value={m}
                        checked={mode === m}
                        onChange={() => setMode(m)}
                      />
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </label>
                  ))}
                </div>
              </Field>

              {mode === "dedicated" && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Server type">
                    <Input
                      value={serverType}
                      onChange={(e) => setServerType(e.target.value)}
                      placeholder="cx22"
                    />
                  </Field>
                  <Field label="Location (optional)">
                    <Input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="nbg1"
                    />
                  </Field>
                </div>
              )}

              {migrateError && (
                <div
                  className="rounded-xl px-4 py-3 text-sm"
                  style={{
                    border: "1px solid color-mix(in srgb, var(--err) 25%, transparent)",
                    background: "color-mix(in srgb, var(--err) 8%, transparent)",
                    color: "var(--err)",
                  }}
                >
                  {migrateError}
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="primary" onClick={migrate} disabled={migrating}>
                  {migrating ? <><Spinner /> Migrating…</> : "Migrate"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Step 3: migration progress / result */}
      {result && (
        <Card className="mt-6">
          <div className="px-4 pt-4 pb-2 font-medium text-sm" style={{ color: "var(--text-muted)" }}>
            Migration {result.ok ? "complete" : "failed"}
          </div>
          <ul className="divide-y px-4" style={{ borderColor: "var(--border)" }}>
            {(result.steps ?? []).map((s, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <StepBadge status={s.status} />
                <span className="flex-1 text-sm" style={{ color: "var(--text)" }}>{s.step}</span>
                {s.detail && (
                  <span className="text-xs truncate max-w-xs" style={{ color: "var(--text-muted)" }}>
                    {typeof s.detail === "string" ? s.detail : Object.values(s.detail).join(" ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {result.ok && result.url && (
            <div className="px-4 pb-4 pt-2">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium"
                style={{ color: "var(--accent)" }}
              >
                <ExternalLink className="h-4 w-4" /> {result.url}
              </a>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
