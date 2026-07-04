// Lightweight click-guard modal for important-but-reversible actions (Save a
// schedule, Stop a database). For irreversible deletes use ConfirmDelete (the
// type-to-confirm gate) instead. Renders nothing unless `open`.
export default function ConfirmDialog({
  open, title, message, confirmLabel = "Confirm", danger = false, busy = false, onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(420px, 94vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, color: "var(--text)" }}>{title}</h3>
        {message && <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" }}>{message}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
