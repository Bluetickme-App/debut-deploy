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

  // Each pattern matches EITHER the original hand-written markup (first run)
  // OR this script's own previous output, marked with <!--dd:*--> comments, so
  // a chrome change can be re-applied to every page by re-running.
  const HEAD = /<!--dd:head-->[\s\S]*?<!--\/dd:head-->|<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">[\s\S]*?<link rel="stylesheet" href="\/assets\/site\.css">/;
  // The third alternative catches chrome written by an earlier version of this
  // script, before the markers existed.
  const HEADER = /<!--dd:header-->[\s\S]*?<!--\/dd:header-->|<header class="site-head">[\s\S]*?<\/header>|<header style="position: sticky[\s\S]*?<\/header>/;
  const FOOTER = /<!--dd:footer-->[\s\S]*?<!--\/dd:footer-->|<footer class="site-foot">[\s\S]*?<\/footer>|<footer style="background: #fff[\s\S]*?<\/footer>/;

  html = html.replace(HEAD, () => headLinks(['/assets/site.css']));
  html = html.replace(HEADER, () => header(crumb).trim());
  html = html.replace(FOOTER, () => footer('').trim());

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
