/* Mobile audit for the React control panel's public surface (the login screen).
 * Serves client/dist itself with SPA fallback, so no external server is needed.
 * Only the login route is reachable without credentials — that is what we test. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const DIST = process.argv[2] || 'c:/Dev/debut-deploy/client/dist';
const PORT = 8099;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml',
               '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let fp = join(DIST, p);
  if (!existsSync(fp) || !statSync(fp).isFile()) fp = join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
  res.end(readFileSync(fp));
});
await new Promise(r => server.listen(PORT, r));

const VIEWPORTS = [
  { name: 'iphone-se', width: 320, height: 568 },
  { name: 'iphone-12', width: 390, height: 844 },
  { name: 'pixel-7',   width: 412, height: 915 },
  { name: 'ipad-mini', width: 768, height: 1024 },
  { name: 'desktop',   width: 1280, height: 900 }
];

const browser = await chromium.launch({ executablePath: process.env.DD_CHROME || undefined });
let fails = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.width < 900, hasTouch: vp.width < 900, deviceScaleFactor: 2
  });
  const p = await ctx.newPage();
  // the API isn't running; stub the auth probe so the app settles on the login view
  await p.route('**/api/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }));
  await p.goto(`http://localhost:${PORT}/login`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const r = await p.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const out = { overflow: Math.max(0, de.scrollWidth - vw), offenders: [], smallTargets: [], brandPanel: null, mark: null };
    const label = el => {
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '';
      return el.tagName.toLowerCase() + cls + ' "' + (el.textContent || '').trim().slice(0, 28).replace(/\s+/g, ' ') + '"';
    };
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (b.width === 0 && b.height === 0)) continue;
      if (b.right > vw + 1 && b.width > 4) out.offenders.push(label(el) + ' right=' + Math.round(b.right));
      const t = el.tagName.toLowerCase();
      if ((t === 'button' || t === 'input' || t === 'a') && b.height > 0 && b.height < 44 && cs.display !== 'inline') {
        out.smallTargets.push(label(el) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      }
    }
    const bp = document.querySelector('.login-brand-panel, [class*="brand"]');
    if (bp) { const c = getComputedStyle(bp); out.brandPanel = c.display === 'none' ? 'hidden' : 'visible'; }
    const img = document.querySelector('img[src*="icon.svg"]');
    if (img) { const b = img.getBoundingClientRect(); out.mark = Math.round(b.width) + 'x' + Math.round(b.height); }
    out.offenders = [...new Set(out.offenders)].slice(0, 6);
    out.smallTargets = [...new Set(out.smallTargets)].slice(0, 6);
    return out;
  });

  const bad = [];
  if (r.overflow > 0) bad.push(`OVERFLOW +${r.overflow}px`);
  if (r.offenders.length) bad.push(`${r.offenders.length} offender(s)`);
  if (r.smallTargets.length) bad.push(`${r.smallTargets.length} small target(s)`);
  if (bad.length) fails++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} login @ ${vp.name} (${vp.width}px)  mark:${r.mark || '-'}  brandPanel:${r.brandPanel || '-'}  ${bad.join(' · ') || 'clean'}`);
  for (const o of r.offenders) console.log('      → ' + o);
  for (const t of r.smallTargets) console.log('      ▢ ' + t);
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails ? `\n${fails} viewport(s) with findings` : '\napp login screen clean at every viewport');
