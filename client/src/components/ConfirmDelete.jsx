import { useState } from "react";
import { Button, Input } from "./ui.jsx";

// Type-to-confirm delete gate (GitHub/Render style). The destructive button stays
// disabled until the user types `SUDO DELETE <name>` exactly (case-insensitive),
// so a stray click can't wipe a service/database. `onConfirm` may be async.
export default function ConfirmDelete({ name, kind = "service", onConfirm, onCancel }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const phrase = `SUDO DELETE ${name}`;
  const ok = text.trim().toLowerCase() === phrase.toLowerCase();

  async function go() {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e?.message || "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(470px, 94vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Delete {kind} “{name}”?</h3>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)", marginTop: 8 }}>
          This permanently removes the {kind} and cannot be undone. To confirm, type{" "}
          <code style={{ color: "var(--err-text)", fontWeight: 600 }}>{phrase}</code> below.
        </p>
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          placeholder={phrase}
          style={{ width: "100%", marginTop: 14, fontFamily: "monospace" }}
        />
        {err && <p style={{ fontSize: 12.5, color: "var(--err-text)", marginTop: 10 }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" disabled={!ok || busy} onClick={go}>
            {busy ? "Deleting…" : `Delete ${kind}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
