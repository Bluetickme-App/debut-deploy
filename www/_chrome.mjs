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

/** <head> contents shared by every page. */
export function headLinks(extraCss = []) {
  return `<!--dd:head--><link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/assets/brand/debutdeploy-favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/debutdeploy-favicon-32.png">
<link rel="apple-touch-icon" href="/assets/brand/debutdeploy-app-icon.svg">
<link rel="stylesheet" href="/assets/dd.css">${extraCss.map(c => `\n<link rel="stylesheet" href="${c}">`).join('')}<!--/dd:head-->`;
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
  <div style="max-width: 1280px; margin: 0 auto; padding: 0 32px; height: 68px; display: flex; align-items: center; gap: 28px;">
    <a href="/" style="display: flex; align-items: center; gap: 7px; color: #0b0d12; flex: none;">
      <img src="/assets/brand/animated/debutdeploy-mark-pulse-animated.svg" alt="" width="40" height="40" style="display: block; flex: none; margin: -4px;">
      <span style="font-weight: 700; font-size: 17px; letter-spacing: -0.02em;">Debut<span style="color: #2563eb;">Deploy</span></span>
      <span class="mono" style="font-size: 12px; color: #9aa2ae;">/ ${esc(crumb)}</span>
    </a>
    <nav data-nav aria-label="Main" style="display: flex; align-items: center; gap: 4px; margin-left: 8px;">
      ${link('/#pricing', 'Pricing')}
      ${link('/render-alternative.html', 'Compare')}
      ${link('/managed-postgres.html', 'Platform')}
      ${link('/#migrate', 'Migrate')}
      ${link('/faq.html', 'FAQ')}
      ${link(STATUS, 'Status')}
    </nav>
    <div style="margin-left: auto; display: flex; align-items: center; gap: 8px; flex: none;">
      <a href="${APP}" class="h-primary" style="padding: 10px 16px; font-size: 14px; font-weight: 600; color: #fff; background: #2563eb; border-radius: 9px;">Deploy an app</a>
      <button type="button" data-nav-toggle aria-label="Open menu" aria-expanded="false" style="width: 44px; height: 44px; place-items: center; border: 1px solid #d8dde6; background: #fff; border-radius: 10px; cursor: pointer; font-size: 15px;">☰</button>
    </div>
  </div>
  <div data-mobile-nav style="display: none; border-top: 1px solid #e5e8ee; background: #fff; padding: 12px 24px 20px;">
    ${[['/', 'Home'], ['/#pricing', 'Pricing'], ['/render-alternative.html', 'Compare providers'],
       ['/managed-postgres.html', 'Platform pages'], ['/#migrate', 'Migrate'], ['/faq.html', 'FAQ'],
       [STATUS, 'Status'], ['/#calculator', 'Compare my bill']]
      .map(([h, l]) => `<a href="${h}" class="h-link" style="display: flex; align-items: center; min-height: 48px; font-size: 16px; font-weight: 600; color: #2b323c; border-bottom: 1px solid #f2f4f8;">${esc(l)}</a>`).join('\n    ')}
  </div>
</header><!--/dd:header-->`;
}

export function footer(note) {
  const link = (href, label) => `<a href="${href}" style="font-size: 13.5px; color: #4d5661;">${esc(label)}</a>`;
  return `<!--dd:footer-->
  <footer style="background: #fff; border-top: 1px solid #e5e8ee;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 48px 32px;">
      <div style="display: flex; flex-wrap: wrap; gap: 18px 32px; justify-content: space-between; align-items: center;">
        <div style="display: flex; flex-wrap: wrap; gap: 18px;">
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
