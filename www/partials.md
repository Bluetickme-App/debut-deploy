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

`index.html` is hand-written. The other ten pages are emitted by
`build-pages.mjs` (`node www/build-pages.mjs`) — all their copy lives in that
one file, so a price change is edited once and regenerated.

## Conversions applied

- `sc-for` / `sc-if` / `{{ }}` → static HTML. Content is in the markup, not
  built by JS, so the pages work without JavaScript and are crawlable.
- `style-hover="…"` → the `.h-*` classes in `assets/dd.css`.
- `<image-slot>` → `.shot` placeholders. The screenshots were never uploaded to
  the design project, so there is nothing to port; drop real files in
  `assets/img/` and swap the placeholder for an `<img>`.
- Domains corrected to the live ones: `debutdeploy.com` → `debutdepoly.com`.
- `docs.debutdeploy.com` has no site behind it, so documentation links point at
  `/faq.html` instead of 404ing.

## Shared scripts

- `assets/dd-calculator.js` — the bill comparison. One implementation, mounted
  on every page via `<div data-dd-calculator></div>`.
- `assets/dd-site.js` — nav, currency toggle, accordions, tabs, carousel.
