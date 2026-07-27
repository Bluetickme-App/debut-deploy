/* Shared page chrome for the DebutDeploy public site.
 *
 * Imported by build-pages.mjs (generated marketing pages) and by
 * reskin-legacy.mjs (the hand-written legal/company pages), so every page on
 * the site carries the same header, footer and asset links from one source.
 */

export const APP = 'https://app.debutdepoly.com';
export const STATUS = 'https://status.debutdepoly.com';
export const SITE = 'https://www.debutdepoly.com';

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Responsive chrome rules.
 *
 * The element styling on this site is inline (that is how the design produced
 * it), so the header cannot be made to fit small screens from `dd.css` alone —
 * inline declarations win. These rules override the inline header styling at
 * phone and tablet widths only, keyed off the same `[data-*]` hooks `dd.css`
 * uses and layered on its 1140 / 900 / 760 breakpoints. Nothing here applies
 * above 1140px — the width the design already collapses the nav at — so the
 * desktop composition is untouched.
 *
 * index.html is hand-maintained and carries an identical copy of this block —
 * keep the two in step.
 */
export const CHROME_CSS = `<style>
@media (max-width: 1140px) {
  /* Brand and header CTA are real touch targets on every screen the nav collapses on. */
  [data-head-brand] { min-height: 44px; }
  [data-head-cta] { min-height: 44px; display: inline-grid; place-items: center; }
}
@media (max-width: 760px) {
  /* 32px of side padding is a quarter of a 320px screen — claw it back. */
  [data-head] { padding-left: 20px !important; padding-right: 20px !important; gap: 14px !important; }
  /* The "/ crumb" is desktop wayfinding; the page title already says where you are. */
  [data-head-crumb] { display: none !important; }
  [data-head-brand] { min-width: 0; }
  [data-head-actions] { gap: 8px !important; }
  [data-head-cta] { padding-left: 12px !important; padding-right: 12px !important; font-size: 13.5px !important; }
}
@media (max-width: 400px) {
  [data-head] { padding-left: 16px !important; padding-right: 16px !important; }
  /* Below ~400px the brand + CTA + toggle cannot coexist. The drawer carries
     the CTA (and the whole nav), so the toggle is what has to survive. */
  [data-head-cta] { display: none !important; }
}
[data-head-toggle] { flex: none; }
@media (max-width: 1140px) {
  /* Footer link rows are the last thing people tap on a touch screen. */
  [data-foot-links] { gap: 4px 18px !important; }
  [data-foot-links] a { display: inline-flex; align-items: center; min-height: 44px; }
}
</style>`;

/** <head> contents shared by every page. */
export function headLinks(extraCss = []) {
  return `<!--dd:head--><link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/assets/brand/debutdeploy-favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/debutdeploy-favicon-32.png">
<link rel="apple-touch-icon" href="/assets/brand/debutdeploy-app-icon.svg">
<link rel="stylesheet" href="/assets/dd.css">${extraCss.map(c => `\n<link rel="stylesheet" href="${c}">`).join('')}
${CHROME_CSS}<!--/dd:head-->`;
}

export function head(title, desc, slug, extraCss = []) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/${slug}">
${headLinks(extraCss)}
</head>
<body>`;
}

export function header(crumb) {
  const link = (href, label) =>
    `<a href="${href}" class="h-nav" style="padding: 8px 12px; border-radius: 8px; font-size: 14px; font-weight: 500; color: #4d5661;">${esc(label)}</a>`;
  return `<!--dd:header-->
<header style="position: sticky; top: 0; z-index: 60; background: rgba(255,255,255,0.9); backdrop-filter: blur(14px); border-bottom: 1px solid #e5e8ee;">
  <div data-head style="max-width: 1280px; margin: 0 auto; padding: 0 32px; height: 68px; display: flex; align-items: center; gap: 28px;">
    <a data-head-brand href="/" style="display: flex; align-items: center; gap: 7px; color: #0b0d12; flex: none;">
      <img src="/assets/brand/animated/debutdeploy-mark-pulse-animated.svg" alt="" width="40" height="40" style="display: block; flex: none; margin: -4px;">
      <span style="font-weight: 700; font-size: 17px; letter-spacing: -0.02em; white-space: nowrap;">Debut<span style="color: #2563eb;">Deploy</span></span>
      <span class="mono" data-head-crumb style="font-size: 12px; color: #9aa2ae;">/ ${esc(crumb)}</span>
    </a>
    <nav data-nav aria-label="Main" style="display: flex; align-items: center; gap: 4px; margin-left: 8px;">
      ${link('/#pricing', 'Pricing')}
      ${link('/render-alternative.html', 'Compare')}
      ${link('/managed-postgres.html', 'Platform')}
      ${link('/#migrate', 'Migrate')}
      ${link('/faq.html', 'FAQ')}
      ${link(STATUS, 'Status')}
    </nav>
    <div data-head-actions style="margin-left: auto; display: flex; align-items: center; gap: 8px; flex: none;">
      <a data-head-cta href="${APP}" class="h-primary" style="padding: 10px 16px; font-size: 14px; font-weight: 600; color: #fff; background: #2563eb; border-radius: 9px;">Deploy an app</a>
      <button type="button" data-nav-toggle data-head-toggle aria-label="Open menu" aria-expanded="false" style="width: 44px; height: 44px; place-items: center; border: 1px solid #d8dde6; background: #fff; border-radius: 10px; cursor: pointer; font-size: 15px;">☰</button>
    </div>
  </div>
  <div data-mobile-nav style="display: none; border-top: 1px solid #e5e8ee; background: #fff; padding: 12px 20px 20px; max-height: 70vh; overflow-y: auto;">
    ${[['/', 'Home'], ['/#pricing', 'Pricing'], ['/render-alternative.html', 'Compare providers'],
       ['/managed-postgres.html', 'Platform pages'], ['/#migrate', 'Migrate'], ['/faq.html', 'FAQ'],
       [STATUS, 'Status'], ['/#calculator', 'Compare my bill']]
      .map(([h, l]) => `<a href="${h}" class="h-link" style="display: flex; align-items: center; min-height: 48px; font-size: 16px; font-weight: 600; color: #2b323c; border-bottom: 1px solid #f2f4f8;">${esc(l)}</a>`).join('\n    ')}
    <a href="${APP}" class="h-primary" style="display: grid; place-items: center; min-height: 48px; margin-top: 14px; border-radius: 10px; font-size: 15px; font-weight: 600; color: #fff; background: #2563eb;">Deploy an app</a>
  </div>
</header><!--/dd:header-->`;
}

export function footer(note) {
  const link = (href, label) => `<a href="${href}" style="font-size: 13.5px; color: #4d5661;">${esc(label)}</a>`;
  return `<!--dd:footer-->
  <footer style="background: #fff; border-top: 1px solid #e5e8ee;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 48px 32px;">
      <div style="display: flex; flex-wrap: wrap; gap: 18px 32px; justify-content: space-between; align-items: center;">
        <div data-foot-links style="display: flex; flex-wrap: wrap; gap: 18px;">
          ${link('/', 'Home')} ${link('/#pricing', 'Pricing')} ${link('/render-alternative.html', 'Compare')}
          ${link('/managed-postgres.html', 'Platform')} ${link('/faq.html', 'FAQ')} ${link('/about.html', 'About')}
          ${link('/contact.html', 'Contact')} ${link('/security.html', 'Security')} ${link('/legal.html', 'Legal')}
          ${link('/webmail.html', 'Webmail')} ${link(STATUS, 'Status')}
        </div>
        <p class="mono" style="font-size: 11.5px; color: #8b939f;">© 2026 DebutDeploy · EU data residency · billed via Stripe</p>
      </div>
      ${note ? `<p class="mono" style="margin-top: 16px; font-size: 11.5px; color: #b3bac5; line-height: 1.8;">${esc(note)}</p>` : ''}
    </div>
  </footer><!--/dd:footer-->`;
}

export const SCRIPTS = `<script src="/assets/dd-site.js" defer></script>
<script src="/assets/dd-calculator.js" defer></script>`;

/** Footer + closing tags + scripts, for pages whose <main> this ends.
 *  (reskin-legacy.mjs uses footer() on its own — those pages close themselves.) */
export function pageClose(note) {
  return `${footer(note)}
</main>

${SCRIPTS}
</body>
</html>
`;
}
