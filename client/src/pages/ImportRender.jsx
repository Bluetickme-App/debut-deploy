import { useEffect, useState } from "react";
// ponytail: Set for selected ids; toggle via new Set copy so React sees a change.
import { Download, CheckCircle, XCircle, MinusCircle, ExternalLink, X } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Card, Field, Input, PageHeader, Spinner } from "../components/ui.jsx";

// Step status badge — maps Render migration step statuses to icons/colours
function StepBadge({ status }) {
  if (status === "ok") return <CheckCircle className="h-4 w-4 shrink-0" style={{ color: "var(--ok)" }} />;
  if (status === "error") return <XCircle className="h-4 w-4 shrink-0" style={{ color: "var(--err)" }} />;
  return <MinusCircle className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />;
}

export default function ImportRender() {
  // Step 1 — saved keys + one-off pasted key
  const [savedKeys, setSavedKeys] = useState([]); // [{ id, name, created_at }]
  const [selectedKeyId, setSelectedKeyId] = useState(""); // "" = use a new key
  const [apiKey, setApiKey] = useState(""); // one-off pasted key
  const [newKeyName, setNewKeyName] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState("");

  const [services, setServices] = useState(null); // null = not fetched yet
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");

  // Step 2 — service selection (multi) + infra target
  const [selectedIds, setSelectedIds] = useState(new Set()); // Set<renderServiceId>
  const [mode, setMode] = useState("shared");
  const [serverType, setServerType] = useState("");
  const [location, setLocation] = useState("");

  // Database migration mapping
  const [renderDbs, setRenderDbs] = useState([]); // Render Postgres (source)
  const [databases, setDatabases] = useState([]); // Coolify DBs (target, may be empty)
  const [migrateDb, setMigrateDb] = useState(false);
  const [srcDbId, setSrcDbId] = useState(""); // Render Postgres id
  const [dbUuid, setDbUuid] = useState(""); // Coolify DB uuid

  // Active credential: saved key selected → { savedKeyId }, else pasted → { apiKey }.
  const creds = selectedKeyId ? { savedKeyId: selectedKeyId } : { apiKey };
  const hasCreds = selectedKeyId ? true : apiKey.trim().length > 0;

  function loadKeys() {
    api.renderKeys()
      .then((k) => setSavedKeys(Array.isArray(k) ? k : []))
      .catch(() => setSavedKeys([]));
  }
  useEffect(loadKeys, []);

  async function saveKey() {
    if (!newKeyName.trim() || !apiKey.trim()) return;
    setSavingKey(true);
    setKeyError("");
    try {
      const saved = await api.saveRenderKey({ name: newKeyName.trim(), apiKey: apiKey.trim() });
      await api.renderKeys().then((k) => setSavedKeys(Array.isArray(k) ? k : []));
      setSelectedKeyId(saved.id);
      setApiKey("");
      setNewKeyName("");
    } catch (err) {
      setKeyError(err.message || "Failed to save key");
    } finally {
      setSavingKey(false);
    }
  }

  async function deleteKey(id) {
    try {
      await api.deleteRenderKey(id);
      if (selectedKeyId === id) setSelectedKeyId("");
      loadKeys();
    } catch (err) {
      setKeyError(err.message || "Failed to delete key");
    }
  }

  // Step 3 — migration results (per service)
  const [migrating, setMigrating] = useState(false);
  const [results, setResults] = useState(null); // [{ renderServiceId, ok, appUuid, steps }]
  const [migrateError, setMigrateError] = useState("");

  function toggleService(id) {
    setResults(null);
    setMigrateError("");
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function listServices(e) {
    e.preventDefault();
    if (!hasCreds) return;
    setListBusy(true);
    setListError("");
    setServices(null);
    setSelectedIds(new Set());
    setResults(null);
    try {
      const data = await api.renderServices(creds);
      setServices(Array.isArray(data) ? data : []);
      // Load Render source DBs + Coolify target DBs alongside; tolerate failure.
      api.renderDatabases(creds)
        .then((dbs) => setRenderDbs(Array.isArray(dbs) ? dbs : []))
        .catch(() => setRenderDbs([]));
      api.databases()
        .then((dbs) => setDatabases(Array.isArray(dbs) ? dbs : []))
        .catch(() => setDatabases([]));
    } catch (err) {
      setListError(err.message || "Failed to list services");
    } finally {
      setListBusy(false);
    }
  }

  async function migrate() {
    setMigrating(true);
    setMigrateError("");
    setResults(null);
    try {
      const dbTarget = migrateDb && srcDbId && dbUuid
        ? { mode: "existing", source: srcDbId, uuid: dbUuid }
        : { mode: "none" };
      const target = { mode, dbTarget };
      if (mode === "dedicated") {
        if (serverType.trim()) target.serverType = serverType.trim();
        if (location.trim()) target.location = location.trim();
      }
      const data = await api.importRenderProject({
        ...creds, // savedKeyId or apiKey — kept in state only, never in URL/query
        services: [...selectedIds],
        target,
      });
      setResults(Array.isArray(data?.results) ? data.results : []);
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

      {/* Step 1: API key (saved or one-off) */}
      <Card>
        <form onSubmit={listServices} className="space-y-4 p-4">
          <Field label="Render API key">
            <select
              value={selectedKeyId}
              onChange={(e) => setSelectedKeyId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
            >
              <option value="">Use a new key</option>
              {savedKeys.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </Field>

          {/* Saved key list with delete */}
          {savedKeys.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {savedKeys.map((k) => (
                <li
                  key={k.id}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
                >
                  {k.name}
                  <button
                    type="button"
                    onClick={() => deleteKey(k.id)}
                    title="Delete key"
                    className="inline-flex"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* New-key entry: name + key + save (also usable one-off) */}
          {!selectedKeyId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name (to save)">
                <Input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="My Render account"
                  autoComplete="off"
                />
              </Field>
              <Field label="API key">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="rnd_…"
                  autoComplete="off"
                />
              </Field>
            </div>
          )}

          {keyError && (
            <p className="text-sm" style={{ color: "var(--err)" }}>{keyError}</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!selectedKeyId && (
              <Button
                type="button"
                variant="secondary"
                onClick={saveKey}
                disabled={savingKey || !newKeyName.trim() || !apiKey.trim()}
              >
                {savingKey ? <><Spinner /> Saving…</> : "Save key"}
              </Button>
            )}
            <Button type="submit" disabled={listBusy || !hasCreds}>
              {listBusy ? <><Spinner /> Listing…</> : <><Download className="h-4 w-4" /> List services</>}
            </Button>
          </div>
        </form>
        {listError && (
          <p className="px-4 pb-4 text-sm" style={{ color: "var(--err)" }}>{listError}</p>
        )}
      </Card>

      {/* Step 2: service picker */}
      {services !== null && (
        <Card className="mt-6">
          <div className="px-4 pt-4 pb-2 font-medium text-sm" style={{ color: "var(--text-muted)" }}>
            {services.length === 0 ? "No services found on this account." : "Select services to migrate"}
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {services.map((svc) => {
              const checked = selectedIds.has(svc.id);
              return (
                <li
                  key={svc.id}
                  onClick={() => toggleService(svc.id)}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  style={{
                    background: checked ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined,
                    borderLeft: checked ? "3px solid var(--accent)" : "3px solid transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleService(svc.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" style={{ color: "var(--text)" }}>{svc.name}</div>
                    <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      {svc.repo}{svc.branch ? ` @ ${svc.branch}` : ""}{svc.type ? ` · ${svc.type}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Infra target (shown once at least one service is selected) */}
          {selectedIds.size > 0 && (
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

              <Field label="Migrate a database?">
                <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--text)" }}>
                  <input
                    type="checkbox"
                    checked={migrateDb}
                    onChange={(e) => setMigrateDb(e.target.checked)}
                  />
                  Migrate a database
                </label>

                {migrateDb && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Source (Render)</div>
                      <select
                        value={srcDbId}
                        onChange={(e) => setSrcDbId(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                      >
                        <option value="">Select…</option>
                        {renderDbs.map((db) => (
                          <option key={db.id} value={db.id}>
                            {db.name}{db.plan ? ` (${db.plan})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Target (Coolify)</div>
                      <select
                        value={dbUuid}
                        onChange={(e) => setDbUuid(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                      >
                        <option value="">Select…</option>
                        {[...databases]
                          // ponytail: prefer postgres when a type field exists; others still listed after.
                          .sort((a, b) => (b.type === "postgresql" || b.type === "postgres" ? 1 : 0) - (a.type === "postgresql" || a.type === "postgres" ? 1 : 0))
                          .map((db) => (
                            <option key={db.uuid} value={db.uuid}>
                              {db.name}{db.type ? ` (${db.type})` : ""}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                )}
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  Restores via pg_dump into the selected Coolify Postgres.
                </p>
              </Field>

              {migrateError && (
                <div
                  className="rounded-lg px-4 py-3 text-sm"
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

      {/* Step 3: per-service migration results */}
      {results && results.map((r) => {
        const svc = (services ?? []).find((s) => s.id === r.renderServiceId);
        return (
          <Card key={r.renderServiceId} className="mt-6">
            <div className="px-4 pt-4 pb-2 font-medium text-sm" style={{ color: "var(--text-muted)" }}>
              {svc?.name || r.renderServiceId} — {r.ok ? "complete" : "failed"}
            </div>
            <ul className="divide-y px-4" style={{ borderColor: "var(--border)" }}>
              {(r.steps ?? []).map((s, i) => (
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
            {r.ok && r.url && (
              <div className="px-4 pb-4 pt-2">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: "var(--accent)" }}
                >
                  <ExternalLink className="h-4 w-4" /> {r.url}
                </a>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
