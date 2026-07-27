/* Objective responsive audit for the DebutDeploy public site.
 *
 *   node responsive-audit.mjs [baseUrl] [--json out.json]
 *
 * Per page x breakpoint it measures things that are true or false, not matters
 * of taste:
 *   - horizontal overflow of the document (the classic mobile killer)
 *   - which specific elements stick out past the viewport
 *   - interactive targets under 44x44 (WCAG 2.5.8 / Apple HIG)
 *   - body text under 12px
 *   - images wider than their container
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

// playwright lives in the npx cache, not this project — ESM import ignores
// NODE_PATH, so resolve it through require instead.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8080';
const jsonIdx = process.argv.indexOf('--json');
const JSON_OUT = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null;
const only = process.argv.includes('--pages')
  ? process.argv[process.argv.indexOf('--pages') + 1].split(',')
  : null;

const PAGES = only || [
  'index.html', 'faq.html',
  'render-alternative.html', 'railway-alternative.html', 'heroku-alternative.html', 'flyio-alternative.html',
  'managed-postgres.html', 'nodejs-hosting.html', 'python-hosting.html', 'docker-hosting.html', 'european-paas.html',
  'about.html', 'contact.html', 'security.html', 'legal.html',
  'terms.html', 'privacy.html', 'dpa.html', 'acceptable-use.html', 'sla.html', 'webmail.html'
];

const VIEWPORTS = [
  { name: 'iphone-se',  width: 320, height: 568, mobile: true },
  { name: 'iphone-12',  width: 390, height: 844, mobile: true },
  { name: 'pixel-7',    width: 412, height: 915, mobile: true },
  { name: 'ipad-mini',  width: 768, height: 1024, mobile: true },
  { name: 'ipad-pro',   width: 1024, height: 1366, mobile: true }
];

const probe = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const out = {
    scrollWidth: de.scrollWidth,
    clientWidth: vw,
    overflow: Math.max(0, de.scrollWidth - vw),
    offenders: [],
    smallTargets: [],
    tinyText: [],
    overflowImages: []
  };

  const label = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const txt = (el.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' ');
    return el.tagName.toLowerCase() + id + cls + (txt ? ` "${txt}"` : '');
  };

  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;

    // sticks out to the right of the viewport
    if (r.right > vw + 1 && r.width > 4) {
      const scrollParent = el.closest('[style*="overflow-x: auto"], [style*="overflow-x:auto"], .rail, [data-rail]');
      if (!scrollParent) out.offenders.push({ el: label(el), right: Math.round(r.right), width: Math.round(r.width) });
    }

    // interactive targets
    const tag = el.tagName.toLowerCase();
    const interactive = tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' || el.getAttribute('role') === 'tab';
    if (interactive && r.width > 0 && r.height > 0) {
      const inline = tag === 'a' && cs.display === 'inline' && el.closest('p, li, caption, td');
      if (!inline && (r.height < 44 || r.width < 24)) {
        out.smallTargets.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }

    // tiny text on body copy
    const fs = parseFloat(cs.fontSize);
    if (fs && fs < 12 && el.children.length === 0 && (el.textContent || '').trim().length > 12) {
      out.tinyText.push({ el: label(el), px: +fs.toFixed(1) });
    }

    if (tag === 'img') {
      const p = el.parentElement && el.parentElement.getBoundingClientRect();
      if (p && r.width > p.width + 1) out.overflowImages.push({ el: label(el), w: Math.round(r.width), parent: Math.round(p.width) });
    }
  }

  const dedupe = (arr, k) => {
    const seen = new Set();
    return arr.filter(x => { const key = x[k]; if (seen.has(key)) return false; seen.add(key); return true; });
  };
  out.offenders = dedupe(out.offenders, 'el').slice(0, 12);
  out.smallTargets = dedupe(out.smallTargets, 'el').slice(0, 12);
  out.tinyText = dedupe(out.tinyText, 'el').slice(0, 10);
  out.overflowImages = dedupe(out.overflowImages, 'el').slice(0, 6);
  return out;
};

// This playwright build wants a chromium revision that isn't downloaded; point
// it at the newest one that is, instead of pulling another ~150MB.
const browser = await chromium.launch({
  executablePath: process.env.DD_CHROME || undefined
});
const results = [];
let totalIssues = 0;

for (const page of PAGES) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.mobile,
      hasTouch: vp.mobile
    });
    const p = await ctx.newPage();
    try {
      await p.goto(`${BASE}/${page}`, { waitUntil: 'networkidle', timeout: 30000 });
      await p.waitForTimeout(150);
      const r = await p.evaluate(probe);
      const issues = r.overflow > 0 || r.offenders.length || r.smallTargets.length || r.tinyText.length || r.overflowImages.length;
      if (issues) totalIssues++;
      results.push({ page, vp: vp.name, width: vp.width, ...r });
    } catch (e) {
      results.push({ page, vp: vp.name, width: vp.width, error: e.message.split('\n')[0] });
    }
    await ctx.close();
  }
}
await browser.close();

// ---- report ----
let overflowPages = 0;
for (const r of results) {
  const bits = [];
  if (r.error) bits.push('ERROR ' + r.error);
  if (r.overflow > 0) { bits.push(`OVERFLOW +${r.overflow}px`); overflowPages++; }
  if (r.offenders?.length) bits.push(`${r.offenders.length} offender(s)`);
  if (r.smallTargets?.length) bits.push(`${r.smallTargets.length} small target(s)`);
  if (r.tinyText?.length) bits.push(`${r.tinyText.length} tiny text`);
  if (r.overflowImages?.length) bits.push(`${r.overflowImages.length} img overflow`);
  if (!bits.length) continue;
  console.log(`\n${r.page} @ ${r.vp} (${r.width}px)  ${bits.join(' · ')}`);
  for (const o of r.offenders || []) console.log(`    → ${o.el}  right=${o.right} w=${o.width}`);
  for (const t of r.smallTargets || []) console.log(`    ▢ ${t.el}  ${t.w}x${t.h}`);
  for (const t of r.tinyText || []) console.log(`    a ${t.el}  ${t.px}px`);
  for (const i of r.overflowImages || []) console.log(`    ▣ ${i.el}  ${i.w} > parent ${i.parent}`);
}

console.log(`\n=== ${results.length} page/viewport combos · ${totalIssues} with findings · ${overflowPages} with horizontal overflow ===`);
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(results, null, 2)); console.log('json → ' + JSON_OUT); }
