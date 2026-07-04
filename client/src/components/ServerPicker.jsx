import { Field, Select } from "./ui.jsx";

// Target-server dropdown. Renders ONLY when there's a real choice — at least one
// reachable, validated, non-host server (a dedicated box). Otherwise nothing shows,
// so customers / single-host setups just fall through to the default shared host.
// The servers list is admin-only server-side, so this is naturally admin-gated.
export default function ServerPicker({ servers, value, onChange }) {
  const pickable = (servers || []).filter((s) => s.reachable && s.usable && !s.isHost);
  if (pickable.length === 0) return null;
  return (
    <Field label="Server">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Shared host (default)</option>
        {pickable.map((s) => (
          <option key={s.uuid} value={s.uuid}>
            {s.name}
            {s.serverType ? ` · ${s.serverType}` : ""}
            {s.cores != null ? ` · ${s.cores} vCPU / ${s.memoryGb} GB` : ""}
          </option>
        ))}
      </Select>
      <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        Deploy onto a dedicated server, or leave it on the shared host.
      </p>
    </Field>
  );
}
