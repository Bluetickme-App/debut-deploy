/* Desktop regression check — the mobile fixes leaned on !important overrides
 * against the design's inline styles, which is exactly the kind of thing that
 * leaks upward. Asserts the desktop composition is still intact at 1280/1512. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8080';
const PAGES = process.argv[3] === '--all' ? [
  'index.html', 'faq.html',
  'render-alternative.html', 'railway-alternative.html', 'heroku-alternative.html', 'flyio-alternative.html',
  'managed-postgres.html', 'nodejs-hosting.html', 'python-hosting.html', 'docker-hosting.html', 'european-paas.html',
  'about.html', 'contact.html', 'security.html', 'legal.html',
  'terms.html', 'privacy.html', 'dpa.html', 'acceptable-use.html', 'sla.html', 'webmail.html'
] : ['index.html', 'faq.html', 'render-alternative.html', 'managed-postgres.html', 'privacy.html', 'dpa.html'];
const WIDTHS = [1280, 1512];

const browser = await chromium.launch({ executablePath: process.env.DD_CHROME || undefined });
let fails = 0;

for (const width of WIDTHS) {
  for (const page of PAGES) {
    const ctx = await browser.newContext({ viewport: { width, height: 950 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/${page}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(120);

    const r = await p.evaluate(() => {
      const de = document.documentElement;
      const vis = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0;
      };
      const nav = document.querySelector('[data-nav]');
      const toggle = document.querySelector('[data-nav-toggle]');
      const cta = document.querySelector('[data-head-cta]');
      const plans = document.querySelector('[data-grid="plans"]');
      const twoCol = document.querySelector('[data-dd-calculator] [data-2col]');
      const toc = document.querySelector('[data-toc]');
      const cols = (el) => el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : null;
      return {
        overflow: Math.max(0, de.scrollWidth - de.clientWidth),
        navVisible: vis(nav),
        toggleVisible: vis(toggle),
        ctaVisible: vis(cta),
        planCols: cols(plans),
        calcCols: cols(twoCol),
        tocVisible: toc ? vis(toc) : null,
        headerH: Math.round((document.querySelector('[data-head]') || {}).getBoundingClientRect?.().height || 0)
      };
    });

    const bad = [];
    if (r.overflow > 0) bad.push(`overflow +${r.overflow}px`);
    if (!r.navVisible) bad.push('desktop nav MISSING');
    if (r.toggleVisible) bad.push('hamburger VISIBLE on desktop');
    if (!r.ctaVisible) bad.push('header CTA missing');
    if (page === 'index.html' && r.planCols !== 5) bad.push(`pricing grid ${r.planCols} cols (want 5)`);
    if (r.calcCols !== null && r.calcCols !== 2) bad.push(`calculator ${r.calcCols} cols (want 2)`);
    if (page === 'faq.html' && !r.tocVisible) bad.push('FAQ sticky TOC missing');
    if (r.headerH && (r.headerH < 60 || r.headerH > 80)) bad.push(`header height ${r.headerH}px`);

    if (bad.length) { fails++; console.log(`FAIL ${page} @${width}  ${bad.join(' · ')}`); }
    else console.log(`ok   ${page} @${width}  nav:y toggle:hidden plans:${r.planCols ?? '-'} calc:${r.calcCols ?? '-'} header:${r.headerH}px`);
    await ctx.close();
  }
}
await browser.close();
console.log(fails ? `\n${fails} DESKTOP REGRESSIONS` : '\ndesktop intact — no regressions');
process.exit(fails ? 1 : 0);
