# Custom Domain Wizard — Design

**Date:** 2026-07-03
**Status:** Approved (lean build)

## Goal
Replace the panel's inline "Add custom domain" form with a Render-style stepped
wizard, plus an in-app docs page. Fix the backend so binding a domain no longer
wipes the free subdomain and actually serves (redeploys so Traefik issues certs).

## User decisions
- Wizard **and** in-app docs page, both in this repo (`app.debutdepoly.com`).
- Entering one domain sets up **both** root + `www` (Render-style).
- `setDomain` must **merge** (keep the free `.debutdepoly.com` subdomain + existing) and **auto-redeploy**.

## Parts

### 1. Backend — `server/lifecycle.js` `setDomain(uuid, fqdn)`
Root-cause fix (today it replaces the domain list and never redeploys → 503):
1. `domainVariants(input)` → normalize, strip `www.`, return `[https://apex, https://www.apex]`.
2. Read current domains via raw `cf(/applications/{uuid})` `.fqdn` (comma-separated).
3. Merge + dedupe (Set), `PATCH { domains }`.
4. `POST /deploy?uuid=…` so Traefik builds routers + requests Let's Encrypt certs.
Demo mode returns the merged list without calling Coolify.

### 2. Client — `client/src/components/AddDomainModal.jsx` (new)
Modal (same shell as `ConfirmDelete`), props: `serviceId, subdomain, platformIp, onClose, onBound`.
- **Step 1 Choose domain name** — input → `POST /services/{id}/domain {fqdn}` → step 2.
- **Step 2 Add DNS records** — two rows with copy buttons:
  - `www → CNAME → {subdomain}`
  - `@   → CNAME/ALIAS → {subdomain}` + A-fallback `{platformIp}`
  - 24h-propagation note, "Read the docs →" (`/docs/custom-domains`), **Verify**.
  - Verify calls `/domain/verify?fqdn=` for apex **and** www; shows per-host ✓/✗.

### 3. Client — `client/src/pages/DocsCustomDomains.jsx` (new) + route `/docs/custom-domains`
In-app article: what a custom domain is → add in panel → configure DNS (A/CNAME
table, apex vs www, `167.233.206.184` target) → propagation & TLS.

### 4. `ServiceDetail.jsx`
Custom Domains section: replace inline form + interim `DomainSteps`/`DnsResult`
usage with an "Add Custom Domain" button opening the modal. Keep the subdomain toggle.

### 5. Test
`server/lifecycle.js` self-check (`node lifecycle.js` demo path or a tiny assert):
`domainVariants` derives apex+www, `www.x`→same apex, merge dedupes.

## Out of scope
- Listing/removing bound domains in the UI (YAGNI for now).
- Docs page on the separate `www.debutdepoly.com` marketing repo.
