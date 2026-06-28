import { Loader2 } from "lucide-react";

const STATUS = {
  running: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Live" },
  healthy: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Live" },
  deploying: { dot: "bg-sky-400 animate-pulse", text: "text-sky-300", label: "Deploying" },
  in_progress: { dot: "bg-sky-400 animate-pulse", text: "text-sky-300", label: "Building" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", label: "Degraded" },
  stopped: { dot: "bg-zinc-500", text: "text-zinc-400", label: "Suspended" },
  failed: { dot: "bg-rose-500", text: "text-rose-300", label: "Failed" },
  success: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Live" },
  unknown: { dot: "bg-zinc-500", text: "text-zinc-400", label: "Unknown" },
};

export function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className={s.text}>{s.label}</span>
    </span>
  );
}

export function Spinner({ className = "" }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
}

export function Card({ children, className = "" }) {
  return (
    <div className={`rounded-xl border border-white/8 bg-[#13161d] ${className}`}>{children}</div>
  );
}

export function Button({ children, variant = "default", className = "", ...props }) {
  const variants = {
    default: "bg-white/10 hover:bg-white/15 text-white",
    primary: "bg-indigo-500 hover:bg-indigo-400 text-white",
    ghost: "hover:bg-white/8 text-zinc-300",
    danger: "bg-rose-500/90 hover:bg-rose-500 text-white",
  };
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RuntimeIcon({ runtime }) {
  const map = { Node: "⬢", Docker: "🐳", node: "⬢", docker: "🐳" };
  return <span className="text-zinc-400">{map[runtime] || "▦"}</span>;
}
