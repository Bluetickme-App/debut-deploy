# Business email hosting — Phase 1 (mailbox hosting)

**Date:** 2026-07-05
**Status:** approved for **private-beta** build (design) — **NOT GA-ready**; pending
implementation plan. GA gated on the launch checklist at the end of this doc.
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

## Mail-domain lifecycle (state machine — activation gate)

A domain is provisioned through an explicit state machine; **sending is disabled until
verification passes** (a mailbox can exist and receive, but cannot send, until its domain
is `active`):

```text
draft → stalwart_domain_created → ses_identity_created → dns_pending
      → dns_verified → active
(any) → failed (visible reason + operator alert)   |   active → suspended → deleted
```

Per-domain state stored on `mail_domains`: `domain, org_id, relay_phase,
ses_identity_arn, dkim_records_json, mail_from_domain, mail_from_mx, mail_from_spf,
mx_verified_at, dkim_verified_at, mail_from_verified_at, dmarc_seen_at,
autoconfig_verified_at, status, failure_reason`.

`active` requires: MX resolves to the mail host **and** SES DKIM CNAMEs verified **and**
custom MAIL FROM MX/SPF verified **and** DMARC present **and** autoconfig records present
(or explicitly skipped by the operator). Anything short of that stays pre-`active` and
outbound is refused.

## Sending (relay) + abuse kill-switch

- Stalwart outbound → **SES SMTP relay on :587** (creds in env). SES does per-domain
  DKIM signing; DMARC passes via DKIM alignment (+ SPF alignment from the MAIL FROM
  subdomain).
- **SES config sets + a dedicated IP pool** so bounce/complaint events are attributable
  per customer and one bad sender doesn't sink shared reputation.
- **Abuse kill-switch (H3/H5, in v1):** an SES **SNS webhook** (`POST /api/mail/ses-
  events`, signature-verified, **idempotent** on the SES message id) consumes bounce/
  complaint events → over threshold, **auto-suspend the mailbox** (Stalwart principal
  disabled) + operator alert, audited and linked to mailbox/domain/org. Non-optional:
  one compromised account can get the whole SES account throttled.
- **Outbound rate limits (enforced before first send), concrete starting defaults:**

  ```text
  new mailbox:            25 outbound/day
  verified low-risk:     100 outbound/day
  per-domain daily cap:  (sum of its mailboxes, tunable)
  new-domain probation:  7–14 days at the low limits
  complaint rate:        immediate review/suspend above 0.1%
  hard-bounce rate:      review/suspend above 5–10%
  temporary deferrals:   retried, not counted as failures
  operator override:     manual raise/lower + manual suspend/unsuspend
  ```

  Numbers are tunable, but v1 ships **with concrete conservative defaults**, not TODOs.
  A suspension records a machine reason + a customer-visible message.

## Data safety (H9/H10, in v1)

- **Backup & restore contract (v1 acceptance criteria, not aspiration):**

  ```text
  frequency:      daily minimum
  target:         off-box object storage, encrypted
  retention:      e.g. 30 days
  restore scopes: per-mailbox, per-domain, and full-server — all required
  restore test:   scheduled + logged (a real restore, not just "backup ran")
  RPO/RTO:        documented before GA (max acceptable loss / restore time)
  ```

  Losing customer mail is business-ending — without a **tested** restore this does not ship.
- **Quotas:** per-mailbox storage quota enforced in Stalwart; over-quota rejects cleanly
  with a customer-visible error (no silent loss). Per-tenant quota via Enterprise tenants.

## Operator observability (mail ops dashboard)

An operator-only mail health view in the panel — you cannot run unattended mail blind:
mail-server status, **queue depth**, failed deliveries, **SES sending quota + bounce/
complaint rate**, suspended mailboxes, domains pending DNS verification, domains failing
DKIM/SPF/DMARC, backup status, and last restore-test result.

## Billing & pricing

A **mailbox = a new billable resource kind**, sold **per seat / month**, metered through
the existing wallet/subscription spine (add seat = metered resource; delete = meter stops;
**suspend for abuse does *not* stop billing** — matches the test in Testing). Aliases and
catch-all are **not** paid mailboxes.

### Market research — custom-domain email, per mailbox/month (verified 2026-07-06; re-check, pricing drifts)

| Provider | Effective £/mailbox/mo | Storage | Notes |
|---|---|---|---|
| Migadu Micro | ~pennies — flat **$19/yr** per account, unlimited mailboxes | 5 GB *account total* | **20 sent/day** cap; self-serve only |
| MXroute Small | ~pennies — flat **$59/yr**, unlimited mailboxes/domains | 10 GB total | 400/hr; self-serve, no managed onboarding |
| Purelymail | ~£0.70 — **$10/yr** per mailbox (3 GB), usage-priced | usage-based | pay-for-infrastructure |
| Namecheap Private Email | ~£0.79 | 5 GB | per-mailbox |
| Zoho Mail Lite | ~£0.90 — **$1**/user/mo | 5–10 GB | free tier: 5 users, 1 domain |
| **Google Workspace Starter** | **£5.90** | 30 GB | premium anchor |
| **Microsoft 365 Business Basic** | **£5.40** | 100 GB | premium anchor |

Two markets: **premium** (Google/MS, £5–6, the "expensive" the product undercuts) and a
**cheap floor** (Zoho/Namecheap per-mailbox ~£0.80–0.90; Migadu/MXroute flat-rate ~pennies
but with tiny send caps + self-serve + no managed onboarding). We do **not** chase the
flat-rate floor — differentiation is *managed DNS onboarding, panel + hosting integration,
webmail, SES-backed sending with real limits, GBP billing + support*.

### COGS per mailbox / month (GBP, modest scale)

```text
Stalwart Enterprise licence   ~£0.14   (€2/mailbox/yr)
SES outbound (~900 mail/mo)   ~£0.08   ($0.10 per 1,000; inbound is free — our Stalwart)
Compute (CX box ÷ 200–500 mbx) ~£0.02
Storage + off-box backup      ~£0.10–0.30  (2–5 GB @ Hetzner + backup, 30-day retention) ← the swing cost
────────────────────────────  ───────
marginal COGS                 ~£0.35–0.55 / mailbox / mo
```

### Recommended retail (GBP / mailbox / mo)

| Tier | Price | Storage | Send limit | Margin @ COGS ~£0.50 |
|---|---|---|---|---|
| **Lite** | £1.50 | 5 GB | standard | ~£1.00 (≈66%) |
| **Standard** | £3.00 | 30 GB | standard | ~£2.50 (≈80%) |

Lite matches the cheap per-mailbox floor (Zoho/Namecheap) on price with better sending +
onboarding; Standard is **~half** of Google/MS with comparable storage. Both keep healthy
margin. (Pricing is a lever, not locked — these are the defaults the pricing page starts
from.) ponytail: two tiers to start; add a Pro/large-quota tier only if demand shows it.

### Integration with the billing spine

- New **`MAIL_PLANS`** in `plans.js` (alongside `COMPUTE_PLANS`/`DB_PLANS`): `{ id,
  name, priceMo (GBP), storageGb, sendPerDay }`. `metering.js` already turns `priceMo`
  into a pence/hour rate — a mailbox meters exactly like compute (`planRatePencePerHour`),
  no new billing maths.
- Mailbox rows carry `plan_id`; the wallet/subscription flow, arrears, and suspension
  sweep all apply unchanged.
- **Margin visibility:** the mail ops dashboard shows COGS (licence + SES + storage) vs
  billed revenue so the per-tier margin above is monitored, not assumed.

Sources: [Google Workspace pricing](https://workspace.google.com/pricing) ·
[Microsoft 365 Business](https://www.microsoft.com/en-gb/microsoft-365/business/compare-all-microsoft-365-business-products) ·
[Migadu pricing](https://www.migadu.com/pricing/) · [MXroute](https://mxroute.com/) ·
[Purelymail](https://purelymail.com/) · [Zoho Mail pricing](https://www.zoho.com/mail/zohomail-pricing.html)

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
- **Activation gate:** a mailbox can be created but outbound stays disabled until the
  domain reaches `active`.
- **SNS idempotency:** the same bounce/complaint delivered twice suspends once, no dup audit.
- **Complaint threshold / bounce threshold:** crossing → suspend/review + operator alert.
- **Rate limits:** a mailbox at its daily cap is refused further sends cleanly.
- **Backup→restore:** test mailbox receives mail → backup → delete/corrupt → restore succeeds.
- **Billing sync:** add mailbox = +seat; **delete** stops billing; suspend does *not*
  necessarily stop billing; alias/catch-all is **not** a paid mailbox unless configured so.
- **Quota:** over-quota rejects cleanly with a customer-visible error, no silent loss.
- Stalwart + SES themselves are integration-tested manually on the box.

## Phase 1 non-goals (later phases)

Direct-send cutover (blocked on Hetzner port-25 + warmup); IP warmup automation;
blocklist/DMARC-report dashboards; spam-training UI; calendars/contacts UI (Stalwart
speaks CalDAV/CardDAV, no UI yet); Gmail/M365 mailbox import; **secondary MX** (known
risk — single MX; sending MTAs retry, so short outages don't lose mail, but a long
outage bounces inbound). **Single MX is acceptable for private beta only, with a clear
beta SLA.** GA requires Phase 2: secondary MX + spool-and-forward + queue monitoring +
inbound-delay alerts + a documented outage procedure.

## Risks

- **Deliverability is an ongoing labour/cost line**, not one-off — even relayed, monitor
  bounces/complaints.
- **Shared SES reputation** — all customers share the SES account's standing; the
  kill-switch + config-set/IP-pool isolation are the mitigations, not optional.
- **GDPR processor role** — real legal weight; blocks GA until the legal pass is done.

## Build order

Data-safety and abuse controls are **built alongside the core, not bolted on last** —
the review's key sequencing correction.

1. `mail.js` + Stalwart on the dedicated box (domains/mailboxes/aliases/**quota enforced**)
   + DB tables + the domain **state machine** + **backups with a tested restore**.
2. `ses.js` — per-domain DKIM + MAIL FROM; Stalwart→SES relay; the **SNS kill-switch +
   outbound rate limits** (abuse controls ship with sending, not after it).
3. DNS onboarding (phase-aware) + autoconfig endpoint + `dns.js` record verification +
   the **activation gate** (no send until `active`).
4. Roundcube webmail.
5. Panel "Email" section + billing resource kind + the **mail ops dashboard**.

## Positioning (private beta)

Sell it as **business email inboxes on your own domain** — webmail + IMAP/SMTP clients,
managed DNS onboarding, aliases/catch-all, lower per-seat cost. Do **not** market it yet
as a full Workspace/M365 replacement: no shared calendar/contacts UI, no enterprise-
compliance posture, no bulk outbound marketing, no instant Gmail/M365 migration, no
Google-grade uptime claim. Those are later phases.

## GA launch checklist (all mandatory before customer GA)

```text
[ ] SES production access approved + sending limits adequate
[ ] SES bounce/complaint + suppression handling live; operator alerting live
[ ] domain lifecycle state machine + activation gate enforced
[ ] outbound rate limits enforced (with the conservative defaults)
[ ] SNS bounce/complaint kill-switch live + idempotent
[ ] encrypted off-box backups + a tested restore (RPO/RTO documented)
[ ] mail ops dashboard live
[ ] legal: DPA + subprocessor list (Hetzner/AWS SES/Stalwart) + data-residency (legal-reviewer)
[ ] beta SLA published if still single-MX (else Phase-2 secondary MX shipped)
```

Private beta may start once steps 1–5 + the state machine + backups + rate limits are in.
