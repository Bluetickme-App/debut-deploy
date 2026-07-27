// Variable Groups — named, reusable env sets attached to services.
// Backed by /api/var-groups: the group is stored panel-side (values encrypted at
// rest) and its keys are pushed into each attached application's own env, so an
// attach/detach/edit here is a real change on the service. Attached services pick
// the new values up on their next deploy (Docker env is fixed at container start).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Braces, Check, ChevronDown, ChevronRight, Loader2,
  Eye, EyeOff, Lock, Pencil, Plus, Trash2, X,
} from "lucide-react";
import { PageHeader, Spinner } from "../components/ui.jsx";
import { api } from "../lib/api.js";

// ── helpers ───────────────────────────────────────────────────────────────────
function ScopePill({ scope }) {
  const isGlobal = !scope || scope === "Global" || scope.startsWith("Global");
  return (
    <span className={`pill ${isGlobal ? "pill-neutral" : "pill-accent"}`} style={{ fontSize: 11 }}>
      {scope || "Global"}
    </span>
  );
}

function mask(val) {
  return "•".repeat(Math.min(String(val || "").length || 8, 24));
}

// Parse a pasted .env blob into {key,value,is_secret} rows. Skips blanks + # comments,
// splits on the first "=", strips surrounding quotes, and guesses secret from the
// key name (KEY/TOKEN/SECRET/PASSWORD/DSN/PRIVATE) so pasted creds default hidden.
function parseDotEnv(text) {
  const SECRETY = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|DSN|PRIVATE|CREDENTIAL)/i;
  const out = [];
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/, "");
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue; // not a valid env key
    out.push({ key, value, is_secret: SECRETY.test(key) });
  }
  return out;
}

const dashedBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "6px 10px", borderRadius: 6,
  border: "1px dashed var(--border-strong)",
  background: "transparent", color: "var(--text-muted)",
  fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
};

const iconBtn = {
  width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)",
  borderRadius: 6, cursor: "pointer", padding: 0,
};

// ── paste-.env panel (shared by create + edit) ────────────────────────────────
function PastePanel({ onCancel, onImport }) {
  const [text, setText] = useState("");
  const parsed = parseDotEnv(text);
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="label">Paste .env</label>
      <textarea
        className="input mono"
        style={{ width: "100%", minHeight: 96, resize: "vertical" }}
        placeholder={"KEY=value\nAPI_TOKEN=abc123\n# comments and blank lines are ignored"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-secondary" onClick={() => onImport(parsed)} disabled={!parsed.length}>
          Import {parsed.length || ""} variable{parsed.length === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

// ── create card ───────────────────────────────────────────────────────────────
function CreateCard({ scopes, onCancel, onCreate }) {
  const [name, setName]   = useState("");
  const [scope, setScope] = useState(scopes[0]);
  const [rows, setRows]   = useState([
    { key: "", value: "", is_secret: false },
    { key: "", value: "", is_secret: false },
  ]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function setRow(i, patch) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  // Merge parsed .env into the rows: drop the empty placeholder rows, then append
  // (dedup by key — a pasted key overwrites an existing same-named row).
  function importEnv(parsed) {
    if (!parsed.length) return;
    setRows((prev) => {
      const byKey = new Map(prev.filter((r) => r.key.trim()).map((r) => [r.key, r]));
      for (const p of parsed) byKey.set(p.key, p);
      return [...byKey.values()];
    });
    setPasteOpen(false);
  }

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        scope: scope.startsWith("Global") ? "Global" : scope,
        vars: rows.filter((r) => r.key.trim()),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      border: "1px solid var(--accent)", borderRadius: 8,
      background: "var(--surface)", boxShadow: "var(--shadow)",
      padding: "20px 22px", marginBottom: 18,
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
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Scope</label>
          <div style={{ position: "relative" }}>
            <select
              className="input"
              style={{ appearance: "none", WebkitAppearance: "none", paddingRight: 30, cursor: "pointer" }}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              {scopes.map((s) => <option key={s}>{s}</option>)}
            </select>
            <ChevronDown
              size={14}
              style={{
                position: "absolute", right: 11, top: "50%",
                transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-muted)",
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
              onChange={(e) => setRow(i, { key: e.target.value })}
            />
            <input
              className="input mono"
              placeholder="value"
              value={row.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
              type={row.is_secret ? "password" : "text"}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                style={{ accentColor: "var(--accent)" }}
                checked={row.is_secret}
                onChange={(e) => setRow(i, { is_secret: e.target.checked })}
              />
              Secret
            </label>
          </div>
        ))}
      </div>

      {pasteOpen && <PastePanel onCancel={() => setPasteOpen(false)} onImport={importEnv} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setRows((r) => [...r, { key: "", value: "", is_secret: false }])} style={dashedBtn}>
            <Plus size={13} /> Add variable
          </button>
          <button onClick={() => setPasteOpen((o) => !o)} style={dashedBtn}>
            <Braces size={13} /> Import .env
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Create group
          </button>
        </div>
      </div>
    </div>
  );
}

// ── one editable variable row ─────────────────────────────────────────────────
function VarRow({ v, reveal, busy, onSave, onDelete, onNeedReveal }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v);

  function startEdit() {
    // A hidden secret's value isn't in memory — editing it blind would blank it.
    if (v.is_secret && !reveal) { onNeedReveal(); return; }
    setDraft(v);
    setEditing(true);
  }

  if (editing) {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1.5fr auto", gap: 10,
        padding: "9px 14px", borderBottom: "1px solid var(--border)", alignItems: "center",
      }}>
        <input
          className="input mono"
          value={draft.key}
          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
        />
        <input
          className="input mono"
          value={draft.value}
          placeholder="value"
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              style={{ accentColor: "var(--accent)" }}
              checked={!!draft.is_secret}
              onChange={(e) => setDraft({ ...draft, is_secret: e.target.checked })}
            />
            Secret
          </label>
          <button
            className="btn btn-primary"
            style={{ padding: "4px 10px", fontSize: 12 }}
            disabled={busy || !draft.key.trim()}
            onClick={async () => { await onSave(v.key, draft); setEditing(false); }}
          >
            Save
          </button>
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1.5fr auto", gap: 12,
      padding: "9px 14px", borderBottom: "1px solid var(--border)", alignItems: "center",
    }}>
      <span className="mono" style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{v.key}</span>
      <span className="mono" style={{
        fontSize: 12, color: "var(--text-muted)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {v.is_secret && !reveal ? mask(v.value || "••••••••") : v.value}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
        {v.is_secret && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: "var(--warn-text)",
            background: "var(--warn-soft)", padding: "2px 7px", borderRadius: 999,
          }}>
            secret
          </span>
        )}
        <button style={iconBtn} title="Edit" onClick={startEdit} disabled={busy}>
          <Pencil size={12} />
        </button>
        <button
          style={{ ...iconBtn, color: "var(--danger-text, #c0392b)" }}
          title="Delete variable"
          disabled={busy}
          onClick={() => { if (confirm(`Delete ${v.key} from this group?`)) onDelete(v.key); }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── group card ────────────────────────────────────────────────────────────────
function GroupCard({ group, services, reveal, expanded, onToggleExpand, onReveal, onError, onChanged }) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [adding, setAdding]   = useState(false);
  const [newVar, setNewVar]   = useState({ key: "", value: "", is_secret: false });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const dropdownRef = useRef(null);

  const nameOf = (uuid) => services.find((s) => s.uuid === uuid)?.name || uuid;

  // close assign dropdown on outside click
  useEffect(() => {
    if (!assignOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setAssignOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [assignOpen]);

  // Every mutation goes through here: surfaces the error, reports partial Coolify
  // push failures, and refetches so the card always shows server truth.
  async function run(fn) {
    setBusy(true);
    onError(null);
    try {
      const res = await fn();
      if (res?.failures?.length) onError(`Applied, but some services rejected the change: ${res.failures.join("; ")}`);
      await onChanged();
      return res;
    } catch (e) {
      onError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const saveVar = (originalKey, draft) => run(async () => {
    if (draft.key.trim() !== originalKey) await api.renameVarGroupVar(group.id, originalKey, draft.key.trim());
    return api.setVarGroupVars(group.id, [{ key: draft.key.trim(), value: draft.value, is_secret: !!draft.is_secret }]);
  });

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 8,
      background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "visible",
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
              color: "var(--text-muted)", transition: "transform .15s",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0,
            }}
          />
          <span style={{
            width: 30, height: 30, borderRadius: 6, background: "var(--accent-soft)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Braces size={16} style={{ color: "var(--accent-text)" }} />
          </span>

          {renaming ? (
            <input
              className="input mono"
              style={{ width: 220 }}
              autoFocus
              value={nameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Escape") { setRenaming(false); setNameDraft(group.name); }
                if (e.key === "Enter" && nameDraft.trim()) {
                  await run(() => api.updateVarGroup(group.id, { name: nameDraft.trim() }));
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <span
              className="mono"
              style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}
              title="Double-click to rename"
              onDoubleClick={(e) => { e.stopPropagation(); setNameDraft(group.name); setRenaming(true); }}
            >
              {group.name}
            </span>
          )}

          <ScopePill scope={group.scope} />

          <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {group.vars.length} variable{group.vars.length !== 1 ? "s" : ""}
          </span>

          {group.vars.some((v) => v.is_secret) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
              <Lock size={12} /> secrets
            </span>
          )}
        </div>

        <span style={{ fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          Attached to {group.services.length} service{group.services.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* expanded body */}
      {expanded && (
        <div style={{ padding: "0 18px 18px" }}>
          {/* var table */}
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: 12 }}>
            <div style={{ minWidth: 420, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1.5fr auto", gap: 12,
                padding: "8px 14px", background: "var(--surface-2)",
                borderBottom: "1px solid var(--border)",
                fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em",
                textTransform: "uppercase", color: "var(--text-muted)",
              }}>
                <span>Key</span><span>Value</span><span />
              </div>

              {group.vars.map((v) => (
                <VarRow
                  key={v.key}
                  v={v}
                  reveal={reveal}
                  busy={busy}
                  onNeedReveal={onReveal}
                  onSave={saveVar}
                  onDelete={(key) => run(() => api.deleteVarGroupVar(group.id, key))}
                />
              ))}

              {adding && (
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1.5fr auto", gap: 10,
                  padding: "9px 14px", alignItems: "center", background: "var(--surface-2)",
                }}>
                  <input
                    className="input mono"
                    placeholder="KEY"
                    autoFocus
                    value={newVar.key}
                    onChange={(e) => setNewVar({ ...newVar, key: e.target.value })}
                  />
                  <input
                    className="input mono"
                    placeholder="value"
                    value={newVar.value}
                    onChange={(e) => setNewVar({ ...newVar, value: e.target.value })}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        style={{ accentColor: "var(--accent)" }}
                        checked={newVar.is_secret}
                        onChange={(e) => setNewVar({ ...newVar, is_secret: e.target.checked })}
                      />
                      Secret
                    </label>
                    <button
                      className="btn btn-primary"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      disabled={busy || !newVar.key.trim()}
                      onClick={async () => {
                        const ok = await run(() => api.setVarGroupVars(group.id, [{ ...newVar, key: newVar.key.trim() }]));
                        if (ok) { setNewVar({ key: "", value: "", is_secret: false }); setAdding(false); }
                      }}
                    >
                      Add
                    </button>
                    <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => setAdding(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!group.vars.length && !adding && (
                <div style={{ padding: "14px", fontSize: 12.5, color: "var(--text-muted)" }}>
                  No variables yet — add one below.
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button style={dashedBtn} onClick={() => setAdding(true)} disabled={busy}>
              <Plus size={13} /> Add variable
            </button>
            <button style={dashedBtn} onClick={() => setPasteOpen((o) => !o)} disabled={busy}>
              <Braces size={13} /> Import .env
            </button>
          </div>

          {pasteOpen && (
            <PastePanel
              onCancel={() => setPasteOpen(false)}
              onImport={async (parsed) => {
                await run(() => api.setVarGroupVars(group.id, parsed));
                setPasteOpen(false);
              }}
            />
          )}

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
                {group.services.map((uuid) => (
                  <span
                    key={uuid}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "4px 6px 4px 10px", borderRadius: 999,
                      background: "var(--surface-2)", border: "1px solid var(--border)",
                      fontSize: 12, fontWeight: 500, color: "var(--text)",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", flexShrink: 0 }} />
                    {nameOf(uuid)}
                    <button
                      onClick={(e) => { e.stopPropagation(); run(() => api.detachVarGroup(group.id, uuid)); }}
                      title={`Detach ${nameOf(uuid)} (removes these keys from the service)`}
                      disabled={busy}
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
                    onClick={(e) => { e.stopPropagation(); setAssignOpen((o) => !o); }}
                    disabled={busy}
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
                      position: "absolute", top: "100%", left: 0, marginTop: 6, width: 250,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "var(--shadow-lg)",
                      padding: 6, zIndex: 30, maxHeight: 260, overflowY: "auto",
                    }}>
                      {!services.length && (
                        <div style={{ padding: "8px 9px", fontSize: 12.5, color: "var(--text-muted)" }}>
                          No services available.
                        </div>
                      )}
                      {services.map((svc) => {
                        const checked = group.services.includes(svc.uuid);
                        return (
                          <div
                            key={svc.uuid}
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              run(() => (checked
                                ? api.detachVarGroup(group.id, svc.uuid)
                                : api.attachVarGroup(group.id, svc.uuid)));
                            }}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: 8, padding: "7px 9px", borderRadius: 6,
                              cursor: "pointer", fontSize: 12.5, color: "var(--text)",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {svc.name}
                            </span>
                            {checked && <Check size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 9 }}>
                Attached services pick up changes on their next deploy.
              </div>
            </div>

            <button
              className="btn btn-ghost"
              style={{ color: "var(--danger-text, #c0392b)" }}
              disabled={busy}
              onClick={() => {
                const n = group.services.length;
                const warn = n
                  ? `Delete "${group.name}"? Its ${group.vars.length} variable(s) will also be removed from ${n} attached service(s).`
                  : `Delete "${group.name}"?`;
                if (confirm(warn)) run(() => api.deleteVarGroup(group.id));
              }}
            >
              <Trash2 size={14} /> Delete group
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function SharedVars() {
  const [groups,   setGroups]   = useState([]);
  const [services, setServices] = useState([]);
  const [scopes,   setScopes]   = useState(["Global — all projects"]);
  const [reveal,   setReveal]   = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [error,    setError]    = useState(null);

  const load = useCallback(async (withValues) => {
    const list = await api.varGroups(withValues);
    setGroups(list);
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, svcs, projects] = await Promise.all([
          api.varGroups(false),
          api.services().catch(() => []),
          api.projects().catch(() => []),
        ]);
        if (!alive) return;
        setGroups(list);
        setServices(svcs);
        setScopes(["Global — all projects", ...projects.map((p) => `Project: ${p.name}`)]);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function toggleReveal() {
    const next = !reveal;
    try {
      await load(next);
      setReveal(next);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCreate(body) {
    try {
      setError(null);
      const created = await api.createVarGroup(body);
      await load(reveal);
      setExpanded((prev) => ({ ...prev, [created.id]: true }));
      setCreating(false);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Variable Groups"
        subtitle="Reusable sets of environment variables you can attach to any service."
        actions={
          <>
            <button className="btn btn-secondary" onClick={toggleReveal}>
              {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              {reveal ? "Hide values" : "Reveal values"}
            </button>
            <button className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
              <Plus size={16} /> New Group
            </button>
          </>
        }
      />

      {error && (
        <div style={{
          border: "1px solid var(--danger, #e74c3c)", background: "var(--warn-soft)",
          color: "var(--text)", borderRadius: 8, padding: "10px 14px",
          marginBottom: 14, fontSize: 13, display: "flex", justifyContent: "space-between", gap: 12,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {creating && (
        <CreateCard scopes={scopes} onCancel={() => setCreating(false)} onCreate={handleCreate} />
      )}

      {loading ? (
        <Spinner />
      ) : !groups.length && !creating ? (
        <div style={{
          border: "1px dashed var(--border-strong)", borderRadius: 8,
          padding: "34px 20px", textAlign: "center", color: "var(--text-muted)",
        }}>
          <Braces size={22} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
            No variable groups yet
          </div>
          <div style={{ fontSize: 12.5 }}>
            Create one to share a set of env vars (API keys, DB URLs) across services.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              services={services}
              reveal={reveal}
              expanded={!!expanded[g.id]}
              onToggleExpand={() => setExpanded((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
              onReveal={toggleReveal}
              onError={setError}
              onChanged={() => load(reveal)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
