// Render-style settings section: left label/description column, right field/value.
// Used by ServiceDetail's sectioned settings layout. Each section gets an id so
// the sticky anchor nav can scrollIntoView to it.

export function SettingsSection({ id, title, description, right }) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-[13px] px-[22px] py-5"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-8">
        <div className="sm:w-[210px] sm:shrink-0">
          <h3
            className="text-[15px] font-semibold"
            style={{ fontFamily: "'Inter', sans-serif", color: "var(--text)" }}
          >
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {description}
            </p>
          )}
        </div>
        <div className="min-w-0 flex-1">{right}</div>
      </div>
    </section>
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
              className="rounded-[7px] px-3 py-[7px] text-left text-[13px] font-medium transition-colors"
              style={
                on
                  ? { background: "var(--accent-soft)", color: "var(--accent-text)" }
                  : { background: "transparent", color: "var(--text-muted)" }
              }
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
