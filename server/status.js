// Public, self-contained systems status page (like status.render.com). Server-
// rendered HTML with inline CSS and a <meta refresh> — no auth, no SPA, no client
// JS — so it renders even when the dashboard or auth layer is down. Data is
// assembled by the route (server/index.js) from live checks and passed in.
// ponytail: no incident history — there's no incident store yet. Add a JSON
// incident log + a section here when you want to post maintenance/outages.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// operational | degraded | outage | unknown → colour + label
const LOOK = {
  operational: { color: "#1eb854", label: "Operational" },
  degraded:    { color: "#f5a623", label: "Degraded" },
  outage:      { color: "#e5484d", label: "Major Outage" },
  unknown:     { color: "#8b8f98", label: "Unknown" },
};

const OVERALL = {
  operational: "All Systems Operational",
  degraded:    "Partial Degradation",
  outage:      "Major Service Outage",
  unknown:     "Status Unknown",
};

// data: { overall, components:[{name,status,note}], mode, checkedAt }
export function renderStatusHtml(d) {
  const rows = d.components.map((c) => {
    const look = LOOK[c.status] || LOOK.unknown;
    return `<div class="row">
      <div class="rl">
        <span class="name">${esc(c.name)}</span>
        ${c.note ? `<span class="note">${esc(c.note)}</span>` : ""}
      </div>
      <div class="rs" style="color:${look.color}">
        <span class="dot" style="background:${look.color}"></span>${look.label}
      </div>
    </div>`;
  }).join("");

  const ok = LOOK[d.overall] || LOOK.unknown;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>DebutDeploy Status — ${esc(OVERALL[d.overall] || OVERALL.unknown)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0a0c11; color: #e7e9ee;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh; padding: 48px 16px;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .logo { display: block; animation: dd-pulse 2.6s ease-in-out infinite; }
  @keyframes dd-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
  @media (prefers-reduced-motion: reduce) { .logo { animation: none; } }
  .brand b { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
  .brand b span { color: #6ea8ff; }
  .banner {
    border-radius: 10px; padding: 22px 24px; margin-bottom: 24px;
    background: ${ok.color}1a; border: 1px solid ${ok.color}55;
    display: flex; align-items: center; gap: 14px;
  }
  .banner .bd { width: 12px; height: 12px; border-radius: 50%; background: ${ok.color};
    box-shadow: 0 0 0 4px ${ok.color}33; flex-shrink: 0; }
  .banner h1 { margin: 0; font-size: 19px; font-weight: 650; color: ${ok.color}; }
  .card { border: 1px solid #1f232d; border-radius: 10px; overflow: hidden; background: #10131a; }
  .row { display: flex; align-items: center; justify-content: space-between;
    padding: 15px 18px; border-top: 1px solid #1f232d; gap: 12px; }
  .row:first-child { border-top: none; }
  .rl { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { font-weight: 550; }
  .note { font-size: 12.5px; color: #8b8f98; }
  .rs { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  footer { margin-top: 22px; text-align: center; color: #8b8f98; font-size: 12.5px; }
  footer a { color: #6ea8ff; text-decoration: none; }
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
  <div class="card">${rows}</div>
  <footer>
    Checked live ${esc(new Date(d.checkedAt).toUTCString())} · ${esc(d.mode)} mode · refreshes every 30s<br>
    <a href="/">← Back to dashboard</a>
  </footer>
</div></body></html>`;
}
