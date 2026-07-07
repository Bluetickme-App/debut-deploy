import { Loader2 } from "lucide-react";

// ── Status config ──────────────────────────────────────────────────────────
const STATUS_MAP = {
  running:     { pill: "pill-ok",    pulse: false, label: "Running" },
  healthy:     { pill: "pill-ok",    pulse: false, label: "Healthy" },
  success:     { pill: "pill-ok",    pulse: false, label: "Live" },
  building:    { pill: "pill-warn",  pulse: true,  label: "Building" },
  deploying:   { pill: "pill-warn",  pulse: true,  label: "Deploying" },
  in_progress: { pill: "pill-warn",  pulse: true,  label: "Building" },
  degraded:    { pill: "pill-warn",  pulse: false, label: "Degraded" },
  stopped:     { pill: "pill-muted", pulse: false, label: "Stopped" },
  unknown:     { pill: "pill-muted", pulse: false, label: "Unknown" },
  failed:      { pill: "pill-err",   pulse: false, label: "Failed" },
  error:       { pill: "pill-err",   pulse: false, label: "Error" },
};

// dot bg colors keyed to pill variant
const DOT_COLOR = {
  "pill-ok":    "bg-[var(--ok)]",
  "pill-warn":  "bg-[var(--warn)]",
  "pill-err":   "bg-[var(--err)]",
  "pill-muted": "bg-[var(--text-muted)]",
};

// ── New design-system components ───────────────────────────────────────────

export function Card({ children, className = "" }) {
  return (
    <div className={`card ${className}`}>{children}</div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em", color: "var(--text)" }}>
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Button({ children, variant = "default", className = "", ...props }) {
  const variantClass = {
    default:  "btn btn-ghost bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]",
    primary:  "btn btn-primary",
    secondary:"btn btn-secondary",
    ghost:    "btn btn-ghost",
    danger:   "btn btn-danger",
  }[variant] ?? "btn btn-ghost";

  return (
    <button className={`${variantClass} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function StatusPill({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.unknown;
  const dotColor = DOT_COLOR[s.pill];
  return (
    <span className={`pill ${s.pill}`}>
      <span className={`pulse-dot ${dotColor} ${s.pulse ? "is-pulsing" : ""}`}
            style={{ color: s.pulse ? "var(--warn)" : undefined }} />
      {s.label}
    </span>
  );
}

// ponytail: StatusBadge kept for backward compat — delegates to StatusPill
export function StatusBadge({ status }) {
  return <StatusPill status={status} />;
}

export function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function Input({ className = "", ...props }) {
  return <input className={`input ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }) {
  return (
    <select className={`select ${className}`} {...props}>
      {children}
    </select>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <p className="text-lg font-semibold" style={{ fontFamily: "'Inter', sans-serif", letterSpacing: "-0.01em", color: "var(--text)" }}>
        {title}
      </p>
      {description && <p className="text-sm max-w-xs" style={{ color: "var(--text-muted)" }}>{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Mono({ children, className = "" }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

export function Spinner({ className = "" }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
}

// ── Unchanged legacy helpers ───────────────────────────────────────────────

export function timeAgo(iso) {
  if (!iso) return "—";
  // Coolify stores timestamps as UTC WITHOUT a zone ("2026-07-06 15:47:47"); the
  // browser would parse that as local time, skewing every "x ago" by the tz offset
  // (why a 1-min-old deploy read "1h ago"). Treat a zone-less stamp as UTC.
  const str = String(iso);
  const d = /(Z|[+-]\d\d:?\d\d)$/.test(str) ? new Date(str) : new Date(str.replace(" ", "T") + "Z");
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RuntimeIcon({ runtime }) {
  const map = { Node: "⬢", Docker: "🐳", node: "⬢", docker: "🐳" };
  return <span style={{ color: "var(--text-muted)" }}>{map[runtime] || "▦"}</span>;
}
