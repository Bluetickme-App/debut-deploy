// Render-style settings section card + row. A section is a bordered card with a
// 15px/600 Inter title, then a stack of rows. Each row is a 2-col grid
// (label+desc on left, field on right) divided by 1px var(--border).
// Each section gets an id so the sticky anchor nav can scrollIntoView to it.

export function SettingsSection({ id, title, children }) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-lg px-[22px] py-[18px]"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
    >
      <h3
        className="mb-3 text-[15px] font-semibold"
        style={{ fontFamily: "'Inter', sans-serif", color: "var(--text)" }}
      >
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

// A single settings row: label + description on the left, field on the right.
// 2-col grid minmax(0,.9fr) minmax(0,1.35fr), rows divided by a top border.
export function SettingsRow({ label, desc, children }) {
  return (
    <div
      className="grid gap-x-6 gap-y-2 py-[14px] first:pt-0"
      style={{ gridTemplateColumns: "minmax(0,.9fr) minmax(0,1.35fr)", borderTop: "1px solid var(--border)" }}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>{label}</p>
        {desc && <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{desc}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Right-side sticky jump nav. Clicking scrolls to the section; active item is
// tracked by an IntersectionObserver in the parent.
export function AnchorNav({ items, active, onJump }) {
  return (
    <nav className="hidden lg:block">
      <div className="sticky top-6 flex flex-col gap-0.5">
        {items.map((it) => {
          const on = active === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onJump(it.id)}
              className="rounded-md px-3 py-[7px] text-left text-[12.5px] font-medium transition-colors"
              style={on
                ? { background: "var(--accent-soft)", color: "var(--accent-text)" }
                : { background: "transparent", color: "var(--text-muted)" }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
