# www/ build notes

The public site is generated from the Claude Design project
`1e4e9d23-0273-4252-86e4-565fe845fce4` ("Debut de Poly homepage design").

## Source → output

| Design file                             | Output                                                     |
|-----------------------------------------|------------------------------------------------------------|
| `DebutDeploy Homepage.dc.html`          | `index.html`                                               |
| `DebutDeploy Comparison Pages.dc.html`  | `render-alternative.html` + 3 siblings                     |
| `DebutDeploy Landing Pages.dc.html`     | `managed-postgres.html` + 4 siblings                       |
| `DebutDeploy FAQ.dc.html`               | `faq.html`                                                 |

The comparison and landing designs each render 4–5 variants from one tabbed
component. Here every variant is its own crawlable URL and the tabs are links
between them.

## Files

```
_chrome.mjs          header, footer, <head> links, scripts — ONE source for every page
build-pages.mjs      the 10 generated pages + sitemap.xml + robots.txt
reskin-legacy.mjs    puts the 10 hand-written legal/company pages on the same chrome
index.html           hand-maintained; NOT written by any script
assets/dd.css        reset, palette, hover states, breakpoints (from the design)
assets/site.css      prose/document styles for the legal pages (loaded after dd.css)
assets/dd-site.js    nav, currency toggle, accordions, step tabs, showcase carousel
assets/dd-calculator.js  the bill comparison — one implementation, every page
```

Rebuild:

```bash
node www/build-pages.mjs     # regenerate the 10 marketing pages + sitemap
node www/reskin-legacy.mjs   # re-apply chrome to the legal pages (idempotent)
```

All copy for the generated pages lives in `build-pages.mjs`, so a price change
is edited once and regenerated. `reskin-legacy.mjs` only ever touches the
`<head>` links, `<header>` and `<footer>` — legal wording is never rewritten by
a script.

## Conversions applied

- `sc-for` / `sc-if` / `{{ }}` → static HTML. Content is in the markup, not built
  by JS, so pages work without JavaScript and are crawlable.
- `style-hover="…"` → the `.h-*` classes in `assets/dd.css`.
- `<image-slot>` → real screenshots in `assets/img/`, with a `.shot` placeholder
  and a `data-monogram` fallback where artwork is still missing.
- Domains corrected to the live ones: `debutdeploy.com` → `debutdepoly.com`.
- `docs.debutdeploy.com` has no site behind it, so documentation links point at
  `/faq.html` rather than 404ing.

## The bill comparison

`assets/dd-calculator.js` renders the whole section into `<div data-dd-calculator>`.
It is mounted on the 11 design pages (home, 4 comparison, 5 landing, FAQ). The
legal documents load the script but have no mount — a savings calculator inside
a Privacy Policy is noise.

Pricing comes from the same tier table the pricing section quotes, so the
calculator cannot drift from the published plans.

## Known gaps

- **Regions.** Every page states compute runs in Germany *and Finland*
  (`fra1` + `hel1`). The live fleet reports Falkenstein only. Confirm before
  relying on the Helsinki claim.
- **Metrics band** on the homepage shows scaled figures, not direct telemetry.
  Its caption was reworded accordingly.
