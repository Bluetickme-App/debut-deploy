/* Re-skins the hand-written legal/company pages onto the new design.
 *
 *   node www/reskin-legacy.mjs
 *
 * Swaps ONLY the <head> asset links, the <header> and the <footer> for the
 * shared chrome in _chrome.mjs, and adds the shared scripts. Page bodies are
 * left byte-for-byte untouched — the legal wording is not this script's
 * business. Safe to re-run: it detects already-converted pages and skips them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headLinks, header, footer, SCRIPTS } from './_chrome.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  ['about.html', 'about'],
  ['contact.html', 'contact'],
  ['security.html', 'security'],
  ['legal.html', 'legal'],
  ['terms.html', 'legal'],
  ['privacy.html', 'legal'],
  ['dpa.html', 'legal'],
  ['acceptable-use.html', 'legal'],
  ['sla.html', 'legal'],
  ['webmail.html', 'mail']
];

let changed = 0;

for (const [file, crumb] of PAGES) {
  const path = join(DIR, file);
  let html = readFileSync(path, 'utf8');
  const before = html;

  // 1. head assets: preconnects + Geist → shared links, keeping site.css last
  html = html.replace(
    /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">[\s\S]*?<link rel="stylesheet" href="\/assets\/site\.css">/,
    headLinks(['/assets/site.css'])
  );

  // 2 & 3. chrome
  html = html.replace(/<header class="site-head">[\s\S]*?<\/header>/, () => header(crumb).trim());
  html = html.replace(/<footer class="site-foot">[\s\S]*?<\/footer>/, () => footer('').trim());

  // 4. shared scripts, once
  if (!html.includes('/assets/dd-site.js')) {
    html = html.replace(/<\/body>/, `${SCRIPTS}\n</body>`);
  }

  if (html !== before) {
    writeFileSync(path, html, 'utf8');
    console.log('reskinned www/' + file);
    changed++;
  } else {
    console.log('unchanged  www/' + file);
  }
}

console.log('\n' + changed + ' of ' + PAGES.length + ' pages updated.');
