# One-Click DNS via Domain Connect — Design

**Status:** approved for planning · **Date:** 2026-07-07

**Goal:** Let a domain owner apply the DNS records DebutDeploy needs — for
business email hosting *and* for custom app domains — by logging into their own
DNS provider and clicking "Approve," instead of hand-copying records. Falls back
to the existing copy-paste table wherever one-click isn't available.

**Architecture:** A provider-agnostic Domain Connect *sync-flow* engine in the
Express server. A single canonical record generator per use case feeds both the
one-click template parameters and the manual fallback table, so they can never
drift. The browser only opens a URL and reflects status; all record logic lives
server-side.

**Tech stack:** Node/Express (ESM), better-sqlite3, React+Vite. Domain Connect
sync flow (open standard; GoDaddy, IONOS, Cloudflare, Squarespace, ~20 providers).
No new runtime dependency required (Node `dns/promises` + `fetch` + `crypto`).

## Decisions (from brainstorming)

1. **Mechanism:** Domain Connect **sync flow** (signed redirect → provider applies
   → redirect back). No OAuth, no stored customer credentials. Manual copy-paste
   is the universal fallback.
2. **Scope:** one shared engine + **two** record sets: `mail` and `hosting`
   (custom app domain).
3. **Audience:** engine is **org-aware / customer-facing** in its data model and
   routes, but in v1 the buttons live behind today's pages (operator-reachable).
   Turning on self-serve later is an exposure change, not a rewrite.
4. **Deferred (explicitly out of v1 scope):**
   - Raw GoDaddy API bridge (customer pastes API key). Covered functionally by the
     manual fallback; revisit only if template onboarding lead-time proves painful.
   - Domain Connect **async/OAuth** flow (ongoing zone management).
   - Registrar reselling / buying new domains through the platform.

## Global Constraints

- ESM everywhere (`import`, not `require`); matches repo convention.
- Never store customer DNS-provider credentials (sync flow avoids this by design).
- The manual fallback must work with zero external dependencies and must be
  reachable on every failure path — one-click never *blocks* setup.
- Mail record content is the canonical set already emitted by
  `server/mail.js dnsRecords(domain)`; the app record content is the A-record
  target already defined by `server/dns.js expectedIp`. Do not fork these values.

## Components

### C1. Canonical record generators (single source of truth)
- Keep `mail.js dnsRecords(domain)` as the canonical **mail** record set
  (MX `@`→`10 mail.debutdepoly.com`; TXT SPF; TXT `_dmarc`; CNAME
  `autoconfig`/`autodiscover`→`mail.debutdepoly.com`).
- Add `dns.js appRecords(domain)` returning the canonical **hosting** record set
  (A `@`→`expectedIp`; CNAME `www`→`@`), mirroring what `lifecycle.setDomain`
  applies for apex+www today. Assumes `expectedIp` (derived from
  `COOLIFY_BASE_URL`) is a bare IP — true for the current deployment; if it ever
  becomes a hostname the apex record must switch A→CNAME (guard in `appRecords`).
- Both return the same normalized shape `{ type, name, value, note }` already used
  by the Email UI table.

### C2. Domain Connect engine — `server/domainconnect.js`
- `discover(domain)` — resolve `_domainconnect.<domain>` TXT to find the provider's
  Domain Connect API host; GET `https://<host>/v2/<domain>/settings`; return
  `{ supported, providerId, urlSyncUX, urlAPI }` or `{ supported:false }` on any
  miss (NXDOMAIN, no template, network error). Never throws for "unsupported."
- `buildApplyUrl({ domain, kind, params, redirectUri, state })` — pure function
  that assembles the sync-flow apply URL:
  `<urlSyncUX>/v2/domainTemplates/providers/<PROVIDER_ID>/services/<kind>/apply?
  domain=<domain>&<params>&redirect_uri=<redirectUri>&state=<state>` plus `sig`+`key`
  when signing is enabled (see C5). `kind` ∈ `mail` | `hosting`.
- `paramsFor(kind, domain)` — maps the C1 record set to the flat template variables
  the template expects (`hosting` → `{ ip: expectedIp }`; `mail` → `{}`, records are
  fixed in the template). Pure, unit-tested.

### C3. Domain Connect templates (JSON, onboarded with providers)
- `templates/debutdeploy.com.mail.json` — MX/SPF/DMARC/autoconfig/autodiscover,
  fixed to `mail.debutdepoly.com`.
- `templates/debutdeploy.com.hosting.json` — A `@`→`%ip%`, CNAME `www`→`@`.
- `providerId` = `debutdeploy.com`; `serviceId` = `mail` | `hosting`.
- These are committed to the repo and submitted to providers (see Onboarding).

### C4. Data model — one SQLite table
`domain_dns_setup(id INTEGER PK, org_id TEXT, domain TEXT, kind TEXT,
provider TEXT, status TEXT, applied_at TEXT, verified_at TEXT,
UNIQUE(org_id, domain, kind))`.
`status` values:

- `pending` — one-click available and launched; awaiting the user's approval.
- `manual` — provider unsupported (or signing off); user is copy-pasting records.
- `applied` — provider redirected back confirming the template was written.
- `verified` — records confirmed live by DNS resolution (C7).
- `failed` — user declined or the provider returned an error.

Purpose: render status without re-running discovery on every page load. No secrets
stored.

### C5. Signing (sync-flow integrity)
- Generate one Ed25519/RSA keypair at setup; private key in server env
  (`DOMAINCONNECT_PRIVATE_KEY`), public key published per the provider's signing
  scheme and registered during onboarding.
- `buildApplyUrl` signs the query string when `DOMAINCONNECT_SIGNING=on`; when off
  (before onboarding), it omits `sig`/`key` and providers that require signing
  simply report unsupported → manual fallback. Feature still ships.

### C6. Routes (Express, org-aware)
- `GET /api/dns/discover?domain=&kind=` → `{ supported, provider, applyUrl?, records }`.
  `records` (C1 fallback set) is **always** returned.
- `GET /api/dns/callback` → Domain Connect redirect target; validates `state`,
  upserts `domain_dns_setup` (`applied`), triggers async verify, 302s back to the
  originating panel page.
- `GET /api/dns/status?domain=&kind=` → `{ status, provider, verified }`.
- v1: mounted behind existing auth (operator-reachable). Handlers resolve `org_id`
  from the authenticated context so self-serve exposure later needs no handler
  change.

### C7. Verification (reuse `dns.js`)
- `hosting`: existing `verifyDomain(fqdn)` (A resolves to `expectedIp`).
- `mail`: add `verifyMail(domain)` — MX resolves to `mail.debutdepoly.com`.
- Callback and the status route use these to move `applied` → `verified`.

### C8. UI — one shared component
- `client/src/components/DnsSetup.jsx` (`<DnsSetup domain kind />`): a
  "Set up DNS automatically" button + status badge + collapsible manual-records
  table (moves the existing copy table out of `Email.jsx` for reuse).
- Used in `Email.jsx` (mail domain card) and the service custom-domain manager.
- Click → `GET /api/dns/discover`; if `applyUrl`, open it (new tab); else expand the
  manual table. Poll `GET /api/dns/status` after return.

## Data flow

1. User clicks **Set up DNS automatically** for a domain + kind.
2. `discover()` → supported ⇒ `applyUrl` (signed); unsupported ⇒ manual records,
   row `status=manual`.
3. User approves in their registrar → provider writes records → redirect to
   `/api/dns/callback`.
4. Callback: `status=applied`, fire verify.
5. Verify success ⇒ `status=verified`; UI shows "Configured automatically via
   `<provider>` ✓". Timeout ⇒ amber "waiting to verify" + re-check button. Manual
   table always available.

## Error handling

| Failure | Behavior |
|---|---|
| `_domainconnect` NXDOMAIN / no template / settings fetch error | `supported:false` → manual fallback, `status=manual` |
| Provider requires signing, signing off | reported unsupported → manual fallback |
| User declines / provider error redirect | `status=failed`, show manual table + retry |
| Verify times out | `status=applied` (amber), re-check button; not an error |
| Unknown `kind` / invalid `domain` | 400 before any provider call |

## Onboarding dependency (expectation-setting)

One-click lights up per-provider only once our two templates are onboarded with
that provider (GoDaddy via template submission/email; some providers ingest from
the public Domain Connect Templates repo). Until then, that provider's customers
get the manual fallback automatically. The feature is fully functional on day one
via fallback; one-click switches on per provider as onboarding completes. The plan
includes an explicit onboarding task (submit templates, register signing key).

## Testing

- **Unit (pure):** `buildApplyUrl` against a fixture template+params → exact URL;
  `paramsFor('hosting', d)` → `{ ip: expectedIp }`; record-set → template-param
  mapping.
- **Unit (mocked I/O):** `discover()` against a mocked `_domainconnect` TXT +
  settings response (supported and unsupported cases).
- **Path:** unsupported provider ⇒ `/api/dns/discover` returns `records`,
  `supported:false`.
- **Integration (manual/live):** once a template is onboarded, run the real
  approve flow against a test domain at GoDaddy; assert `verifyMail` /
  `verifyDomain` pass.

## Out of scope (v1)

Raw GoDaddy API key bridge; Domain Connect async/OAuth flow; registrar reselling;
turning on end-customer self-serve exposure (engine is built for it, but the
buttons stay behind current pages until the mail/domain UI is made org-facing).
