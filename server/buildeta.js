// Progress estimate for an in-flight build. Coolify reports no percentage and can't:
// a build has no idea how many steps remain. So we derive one — elapsed / the median
// duration of that app's last successful builds (see getBuildDurationMedians).
//
// Returns null rather than guessing when there's no history: a first-ever build shows
// a plain elapsed timer, which is honest, instead of a bar that means nothing.
// Capped at 99% — a bar sitting at 100% while the build is visibly still running
// reads as "broken", where 99% reads as "slow but alive".
//
// Its own module (not coolify.js) purely so it stays importable without dragging in
// the sqlite-backed chain — a pure function should be testable without a database.
export function buildProgress(row, medians, nowMs = Date.now()) {
  if (!row || row.status !== "in_progress") return null;
  const median = medians?.[row.uuid];
  if (!(median > 0)) return null;
  const started = Date.parse(row.startedAt);
  if (!Number.isFinite(started)) return null;
  const elapsedSec = (nowMs - started) / 1000;
  if (elapsedSec < 0) return null; // clock skew — no bar beats a negative one
  return {
    pct: Math.min(99, Math.max(1, Math.round((elapsedSec / median) * 100))),
    etaSec: Math.max(0, Math.round(median - elapsedSec)),
    medianSec: median,
  };
}
