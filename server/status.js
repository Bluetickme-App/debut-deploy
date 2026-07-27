// Public, self-contained systems status page (in the shape of status.render.com).
// Server-rendered HTML with inline CSS and a <meta refresh> — no auth, no SPA, no client
// JS — so it renders even when the dashboard or auth layer is down.
//
// PUBLIC-FACING RULES (please keep):
//   * Never name the stack. No vendor names, no product names of anything we run on.
//     Components are described by the CAPABILITY a customer notices when it breaks.
//   * Never publish counts of servers, hosts, containers or customers. "3/4 reachable"
//     tells a stranger how big the estate is and which part of it is currently weak.
//   * Never publish a customer's service name. Incident titles are derived from the
//     situation TYPE only — `target` and `detail` carry customer identifiers and must
//     not reach this file.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// operational | degraded | outage | unknown → colour + label
const LOOK = {
  operational: { color: "#1eb854", label: "Operational" },
  degraded:    { color: "#f5a623", label: "Degraded Performance" },
  outage:      { color: "#e5484d", label: "Major Outage" },
  unknown:     { color: "#8b8f98", label: "Unknown" },
};

const OVERALL = {
  operational: "All Systems Operational",
  degraded:    "Partial Degradation",
  outage:      "Major Service Outage",
  unknown:     "Status Unknown",
};

const RANK = { operational: 0, unknown: 1, degraded: 2, outage: 3 };
export const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

// Which public component an internal situation type rolls up into. An unmapped type
// is deliberately dropped rather than shown raw — a new internal alert type must not
// leak its wording onto a public page just because someone forgot to map it.
export const COMPONENT_FOR_TYPE = {
  "host.disk": "Hosting Infrastructure",
  "host.mem": "Hosting Infrastructure",
  "deploy.zombie": "Builds & Deployments",
  "deploy.pileup": "Builds & Deployments",
  "service.unhealthy": "Application Runtime",
};

// Public incident wording per internal type. Generic on purpose: enough for a customer
// to know what was affected, nothing about which box or whose app.
export const INCIDENT_TITLE = {
  "host.disk": "Elevated storage utilisation",
  "host.mem": "Elevated memory utilisation",
  "deploy.zombie": "Delays in the deployment pipeline",
  "deploy.pileup": "Deployments queuing longer than usual",
  "service.unhealthy": "Degraded application health checks",
};

const DAY_MS = 86_400_000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Per-component daily status for the last `days` days, from the situation log.
 * A day is `outage` if a crit situation was open at any point in it, `degraded` for a
 * warn, else `operational`. Days before we have any record stay `unknown` rather than
 * claiming green uptime we cannot evidence.
 *
 * @param {Array<{type,severity,opened_at,resolved_at}>} situations
 * @returns {{ history: Record<string, Array<{date,status}>>, incidents: Array }}
 */
export function buildHistory(situations, { days = 90, nowMs = Date.now(), componentNames = [] } = {}) {
  const startMs = nowMs - (days - 1) * DAY_MS;
  const dates = [];
  for (let i = 0; i < days; i++) dates.push(dayKey(startMs + i * DAY_MS));

  const history = {};
  for (const name of componentNames) history[name] = dates.map((date) => ({ date, status: "operational" }));

  const incidents = [];
  for (const s of situations || []) {
    const component = COMPONENT_FOR_TYPE[s.type];
    const title = INCIDENT_TITLE[s.type];
    if (!component || !title || !history[component]) continue; // unmapped → never rendered

    const openedMs = Date.parse(s.opened_at);
    if (!Number.isFinite(openedMs)) continue;
    const endMs = s.resolved_at ? Date.parse(s.resolved_at) : nowMs;
    const status = s.severity === "crit" ? "outage" : "degraded";

    // Mark every day the situation spanned.
    for (let t = Math.max(openedMs, startMs); t <= Math.min(endMs, nowMs); t += DAY_MS) {
      const idx = dates.indexOf(dayKey(t));
      if (idx >= 0) history[component][idx].status = worst(history[component][idx].status, status);
    }
    // ...including the end day, which the loop above can step past on a short incident.
    const endIdx = dates.indexOf(dayKey(Math.min(endMs, nowMs)));
    if (endIdx >= 0) history[component][endIdx].status = worst(history[component][endIdx].status, status);

    if (openedMs >= startMs) {
      incidents.push({
        date: dayKey(openedMs),
        openedAt: s.opened_at,
        resolvedAt: s.resolved_at || null,
        title,
        component,
        severity: s.severity === "crit" ? "outage" : "degraded",
      });
    }
  }

  incidents.sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
  return { history, incidents };
}

export const uptimePct = (days) => {
  const rated = (days || []).filter((d) => d.status !== "unknown");
  if (!rated.length) return null;
  const bad = rated.reduce((n, d) => n + (d.status === "outage" ? 1 : d.status === "degraded" ? 0.5 : 0), 0);
  return Math.round(((rated.length - bad) / rated.length) * 1000) / 10;
};

const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// data: { overall, components:[{name,status,note,history,uptime}], incidents, checkedAt }
export function renderStatusHtml(d) {
  const rows = (d.components || []).map((c) => {
    const look = LOOK[c.status] || LOOK.unknown;
    const bars = (c.history || []).map((h) => {
      const l = LOOK[h.status] || LOOK.unknown;
      return `<i class="b" style="background:${l.color}" title="${esc(fmtDay(h.date))} — ${esc(l.label)}"></i>`;
    }).join("");
    return `<div class="row">
      <div class="rh">
        <div class="rl">
          <span class="name">${esc(c.name)}</span>
          ${c.note ? `<span class="note">${esc(c.note)}</span>` : ""}
        </div>
        <div class="rs" style="color:${look.color}">
          <span class="dot" style="background:${look.color}"></span>${look.label}
        </div>
      </div>
      ${bars ? `<div class="bars">${bars}</div>
      <div class="scale"><span>90 days ago</span><span>${c.uptime == null ? "" : `${c.uptime}% uptime`}</span><span>Today</span></div>` : ""}
    </div>`;
  }).join("");

  const incidents = (d.incidents || []).length
    ? d.incidents.slice(0, 20).map((i) => {
        const look = LOOK[i.severity] || LOOK.unknown;
        return `<div class="inc">
          <div class="incd">${esc(fmtDay(i.date))}</div>
          <div class="incb">
            <span class="inct" style="color:${look.color}">${esc(i.title)}</span>
            <span class="incm">${esc(i.component)} · ${i.resolvedAt ? "Resolved" : "Monitoring"}</span>
          </div>
        </div>`;
      }).join("")
    : `<p class="empty">No incidents reported in the last 90 days.</p>`;

  const ok = LOOK[d.overall] || LOOK.unknown;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<meta name="description" content="Live service status for the DebutDeploy platform.">
<title>DebutDeploy Status — ${esc(OVERALL[d.overall] || OVERALL.unknown)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0a0c11; color: #e7e9ee;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh; padding: 48px 16px;
  }
  .wrap { max-width: 760px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .logo { display: block; animation: dd-pulse 2.6s ease-in-out infinite; }
  @keyframes dd-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
  @media (prefers-reduced-motion: reduce) { .logo { animation: none; } }
  .brand b { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
  .brand b span { color: #6ea8ff; }
  .banner {
    border-radius: 10px; padding: 22px 24px; margin-bottom: 28px;
    background: ${ok.color}1a; border: 1px solid ${ok.color}55;
    display: flex; align-items: center; gap: 14px;
  }
  .banner .bd { width: 12px; height: 12px; border-radius: 50%; background: ${ok.color};
    box-shadow: 0 0 0 4px ${ok.color}33; flex-shrink: 0; }
  .banner h1 { margin: 0; font-size: 19px; font-weight: 650; color: ${ok.color}; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #8b8f98;
    margin: 32px 0 12px; font-weight: 600; }
  .card { border: 1px solid #1f232d; border-radius: 10px; overflow: hidden; background: #10131a; }
  .row { padding: 16px 18px; border-top: 1px solid #1f232d; }
  .row:first-child { border-top: none; }
  .rh { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .rl { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { font-weight: 550; }
  .note { font-size: 12.5px; color: #8b8f98; }
  .rs { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .bars { display: flex; gap: 2px; margin-top: 12px; }
  .b { flex: 1 1 0; height: 26px; border-radius: 2px; opacity: .85; min-width: 2px; }
  .b:hover { opacity: 1; }
  .scale { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11.5px; color: #8b8f98; }
  .inc { display: flex; gap: 16px; padding: 14px 18px; border-top: 1px solid #1f232d; }
  .inc:first-child { border-top: none; }
  .incd { min-width: 120px; font-size: 12.5px; color: #8b8f98; }
  .incb { display: flex; flex-direction: column; gap: 2px; }
  .inct { font-weight: 550; font-size: 14px; }
  .incm { font-size: 12.5px; color: #8b8f98; }
  .empty { margin: 0; padding: 18px; color: #8b8f98; font-size: 13.5px; }
  footer { margin-top: 28px; text-align: center; color: #8b8f98; font-size: 12.5px; }
  footer a { color: #6ea8ff; text-decoration: none; }
  @media (max-width: 520px) { .inc { flex-direction: column; gap: 4px; } .incd { min-width: 0; } }
</style></head>
<body><div class="wrap">
  <div class="brand">
    <svg class="logo" viewBox="0 0 512 512" width="30" height="30" aria-hidden="true">
      <defs><linearGradient id="ddg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6274f5"/><stop offset="1" stop-color="#4460ee"/></linearGradient></defs>
      <polygon points="256,20 460,138 460,374 256,492 52,374 52,138" fill="url(#ddg)"/>
      <path fill="#fff" fill-rule="evenodd" d="M180 150 H288 C356 150 402 196 402 256 C402 316 356 362 288 362 H180 Z M238 202 H286 C320 202 344 223 344 256 C344 289 320 310 286 310 H238 Z"/>
      <g stroke="#fff" stroke-width="12" fill="none" stroke-linejoin="round" stroke-linecap="round"><path d="M180 196 H132 V160"/><path d="M180 256 H108"/><path d="M180 316 H132 V352"/><path d="M300 150 V100 H340"/><path d="M402 220 H436 V185"/><path d="M402 292 H424"/><path d="M250 362 V420 H206"/></g>
      <g fill="#fff"><circle cx="132" cy="148" r="13"/><circle cx="96" cy="256" r="13"/><circle cx="132" cy="364" r="13"/><circle cx="352" cy="100" r="13"/><circle cx="436" cy="173" r="13"/><circle cx="437" cy="292" r="13"/><circle cx="194" cy="420" r="13"/></g>
    </svg>
    <b>Debut<span>Deploy</span></b>
  </div>

  <div class="banner"><span class="bd"></span><h1>${esc(OVERALL[d.overall] || OVERALL.unknown)}</h1></div>

  <h2>Current status</h2>
  <div class="card">${rows}</div>

  <h2>Past incidents</h2>
  <div class="card">${incidents}</div>

  <footer>
    Updated ${esc(new Date(d.checkedAt).toUTCString())} · refreshes automatically<br>
    <a href="https://app.debutdepoly.com/">Go to the dashboard</a>
  </footer>
</div></body></html>`;
}
