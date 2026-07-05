# Business email hosting — Phase 1 (mailbox hosting)

**Date:** 2026-07-05
**Status:** approved (design) — pending implementation plan
**Depends on:** org/RBAC + billing spine (orgs, wallet, subscriptions, per-resource
metering), the SSH host-exec path (`hostexec.js`), the DNS verify helper (`dns.js`),
and Hetzner provisioning (`hetzner.js`, `provision.js`).

**Peer-reviewed** by an email-infrastructure/deliverability review (2026-07-05); this
design incorporates its Fatal/High corrections. See "Review corrections baked in".

## Problem

Business email (Google Workspace / Microsoft 365) is expensive per seat. We want to
offer **mailbox hosting** — real inboxes on a customer's own domain (send + receive +
store), managed and billed through the existing panel — to undercut them.

Email is the one infra product where the naive build is a trap: you never write
SMTP/IMAP; the software is 10% and **deliverability + abuse + data-safety are 90%**.
This design is deliberately conservative about those 90%.

## Decisions (locked)

- **Product:** mailbox hosting (seats), not a transactional relay.
- **Engine:** **Stalwart, Enterprise edition** — single Rust binary (SMTP/IMAP/JMAP),
  built-in spam + per-domain DKIM, HTTP admin API (`/api/principal`: a *Domain*
  principal = a hosted domain, an *Individual* principal = a mailbox). **Enterprise is
  required** — multi-tenant isolation + per-tenant quotas are Enterprise-only (~€2/
  mailbox/yr); Community gives one flat, unisolated namespace, unacceptable for a paid
  multi-customer product.
- **Outbound:** **SES-only relay** (hybrid warm-then-cutover, but Phase 1 is relay-only).
- **Webmail:** **Roundcube**, bundled, in v1.
- **Hosting:** a **dedicated** Hetzner box, separate from the app-hosting fleet, for
  reputation isolation; own IP + rDNS/PTR.

## Review corrections baked in

1. **Stalwart Enterprise, not Community** — the isolation model the product needs is
   Enterprise-gated. Folded into COGS.
2. **SES-only** — Postmark is disqualified (its AUP is transactional-only and forbids
   hosting arbitrary end-user mail).
3. **DKIM ownership during relay is SES's, not Stalwart's** — relaying through SES,
   SPF aligns to Amazon not the customer, so DKIM is the only path to DMARC pass. Use
   **SES Easy DKIM per customer domain** (publish SES's CNAMEs) + a **per-domain custom
   MAIL FROM** subdomain for SPF alignment. Exactly one DKIM regime is active at a time;
   Stalwart does **not** also sign during the relay phase.
4. **Hetzner blocks outbound port 25 by default** (unblock ~1 month + first invoice,
   case-by-case). Inbound 25 is open (receiving works); 587 to SES is fine. Therefore
   **self-hosted direct-send is impossible on day 1** — Phase 1 is relay-only, and the
   direct-send cutover switch is **cut from Phase 1**. Request the port-25 unblock + set
   PTR on **day 1** so the option is ready when warmup later makes sense.
5. **Not deferrable** (were mistakenly parked): SES bounce/complaint → auto-suspend
   mailbox; per-account outbound rate limits; mail-store backups.

## Architecture

```
customer domain ──(DNS: MX, SES DKIM CNAMEs, MAIL FROM, DMARC, autoconfig)──┐
                                                                            ▼
inbound mail ─► :25 dedicated mail box ─► Stalwart (store/spam/quota)
user (webmail) ─► Roundcube ─► Stalwart IMAP
user (client)  ─► autoconfig ─► Stalwart IMAP/SMTP-submission :587/:465
outbound submission ─► Stalwart ─► relay :587 ─► Amazon SES ─► recipient
SES SNS (bounce/complaint) ─► panel webhook ─► suspend mailbox + alert
panel ─► Stalwart admin API (/api/principal) ─► create/suspend domains + mailboxes
panel ─► SES API ─► per-domain Easy DKIM + MAIL FROM identities
```

Runs on a **dedicated** Hetzner box (e.g. CX22, 2–4 GB; Stalwart is light) with its
own clean IP + FCrDNS. Stalwart + Roundcube as containers. Never co-located with the
app-hosting fleet (reputation isolation both directions).

## Components

- **`server/mail.js`** — Stalwart admin-API client: create/list/suspend/delete Domain
  and Individual principals; set quotas; create aliases/catch-all; fetch a mailbox's
  connection/autoconfig facts. Mirrors how `coolify.js` wraps Coolify.
- **`server/ses.js`** — SES control: create per-domain **Easy DKIM** + **custom MAIL
  FROM** identities, fetch the DNS records to publish, and consume bounce/complaint
  notifications. (Outbound send itself is Stalwart→SES SMTP relay, not this module.)
- **DB tables** (new migration): `mail_domains` (org_id, domain, dkim CNAMEs, mail_from
  subdomain, verified_at, status), `mailboxes` (domain_id, address, quota_mb, plan,
  status), `mail_aliases` (domain_id, alias, target|catch_all). Small; follows the
  existing migration pattern.
- **Roundcube** — one shared webmail container at `webmail.<brand>`, IMAP-pointed at
  Stalwart; users log in with full email + mailbox password.
- **Panel "Email" section** — reuse org/RBAC guards: add domain → verify → manage seats,
  aliases, catch-all, quotas, password reset.

## Provisioning & onboarding flow

1. Buy N seats → panel creates the **Domain** principal + N **Individual** principals via
   Stalwart, and creates the SES **Easy DKIM** + **MAIL FROM** identities for the domain.
2. Panel shows the **phase-aware DNS record set** to add: `MX → mail.<brand>`, the SES
   **DKIM** CNAMEs, the **MAIL FROM** MX/SPF for the subdomain, a top-level **SPF**
   (`include` the MAIL FROM), **DMARC** (`p=quarantine` to start), and **autoconfig/
   autodiscover** (see below).
3. `dns.js` verifies by lookup (extended to check the specific record types, not just an
   A record). On pass → mail flows, webmail works.

**Phase-aware records (High/H2):** the record set for the **relay** phase (SES DKIM +
MAIL FROM) differs from the eventual **direct-send** set (Stalwart DKIM, own SPF). The
panel labels the current phase and stores which set a domain was verified against, so a
future cutover re-issues records instead of silently breaking a customer's setup.

**Autoconfig (M1):** records live on the *customer's* domain — `autoconfig.<domain>`
(Thunderbird), `autodiscover.<domain>` (Outlook), and `_imaps._tcp` / `_submission._tcp`
SRV. Panel surfaces these as CNAMEs to a **shared autoconfig endpoint** the mail box
serves (Stalwart can emit the config XML). One shared endpoint, per-domain CNAME.

## Sending (relay) + abuse kill-switch

- Stalwart outbound → **SES SMTP relay on :587** (creds in env). SES does per-domain
  DKIM signing; DMARC passes via DKIM alignment (+ SPF alignment from the MAIL FROM
  subdomain).
- **SES config sets + a dedicated IP pool** so bounce/complaint events are attributable
  per customer and one bad sender doesn't sink shared reputation.
- **Abuse kill-switch (H3/H5, in v1):** an SES **SNS webhook** (`POST /api/mail/ses-
  events`, signature-verified) consumes bounce/complaint events → on a per-mailbox
  threshold, **auto-suspend the mailbox** (Stalwart principal disabled) + alert the
  operator. Plus **per-account outbound rate limits** in Stalwart. Non-optional: one
  compromised account can get the whole SES account throttled.

## Data safety (H9/H10, in v1)

- **Backups:** automated backup of the Stalwart mail store to off-box object storage,
  with a **tested restore**. Losing customer mail is business-ending — this ships in v1.
- **Quotas:** per-mailbox storage quota enforced in Stalwart; over-quota rejects cleanly
  (no silent loss). Per-tenant quota via Enterprise tenants.

## Billing

A **mailbox = a new billable resource kind**, per-seat monthly plan, metered through the
existing wallet/subscription spine (add seat = metered resource; remove = meter stops).
**COGS folds in the Stalwart Enterprise per-mailbox license + SES per-email** — still
comfortably under Google/MS per-seat, but not free; the pricing page math must reflect it.

## Security / compliance

- **TLS:** enforce STARTTLS/implicit TLS on submission; publish **MTA-STS + TLS-RPT** for
  hosted domains (cheap wins). DANE/TLSA deferred (needs customer-domain DNSSEC).
- **Auth:** Stalwart fail2ban-style throttling on IMAP/SMTP-AUTH; MFA on webmail if
  available. Mailbox passwords live in Stalwart's directory; panel drives set/reset.
- **GDPR (H8):** hosting mailboxes makes us a **data processor of message content** —
  heavier than the app product. Needs a customer DPA, an updated **subprocessor list**
  (Hetzner + AWS SES + Stalwart), an EU data-residency statement, and an abuse-desk +
  `abuse@`/`postmaster@` process. Route the legal pages through `legal-reviewer` before GA.

## Testing

`node --test`, extending the existing suite; external services stubbed.
- `mail.js`: Stalwart API client — create/suspend/delete domain + mailbox, alias/catch-all,
  quota set (mocked HTTP).
- `ses.js`: DKIM/MAIL FROM identity creation → the DNS records emitted; SNS event parse →
  suspend decision at threshold; SNS signature verification.
- DNS record generation: MX/SPF/DKIM/DMARC/MAIL-FROM/autoconfig strings, per phase.
- Billing: seat → resource-kind mapping meters/unmeters correctly.
- Stalwart + SES themselves are integration-tested manually on the box.

## Phase 1 non-goals (later phases)

Direct-send cutover (blocked on Hetzner port-25 + warmup); IP warmup automation;
blocklist/DMARC-report dashboards; spam-training UI; calendars/contacts UI (Stalwart
speaks CalDAV/CardDAV, no UI yet); Gmail/M365 mailbox import; **secondary MX** (known
risk — single MX; sending MTAs retry, so short outages don't lose mail, but a long
outage bounces inbound; mitigate with monitoring + fast restore, add spool-and-forward
secondary MX in Phase 2).

## Risks

- **Deliverability is an ongoing labour/cost line**, not one-off — even relayed, monitor
  bounces/complaints.
- **Shared SES reputation** — all customers share the SES account's standing; the
  kill-switch + config-set/IP-pool isolation are the mitigations, not optional.
- **GDPR processor role** — real legal weight; blocks GA until the legal pass is done.

## Build order

1. `mail.js` + Stalwart on the dedicated box (domains/mailboxes/aliases/quota) + DB tables.
2. `ses.js` — per-domain DKIM + MAIL FROM; Stalwart→SES relay; the SNS kill-switch.
3. DNS onboarding (phase-aware) + autoconfig endpoint + `dns.js` record verification.
4. Roundcube webmail.
5. Panel "Email" section + billing resource kind.
6. Backups + quota enforcement + rate limits (data-safety/abuse — ship with v1, not after).
