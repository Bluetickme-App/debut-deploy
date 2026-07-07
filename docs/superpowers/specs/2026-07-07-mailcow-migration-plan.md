# Mail engine migration: Stalwart → mailcow

**Date:** 2026-07-07
**Status:** approved (decisions locked) — execution pending two unblocks (below)
**Supersedes:** the Stalwart engine choice in the 2026-07-05 business-email-hosting spec
(the *product* design — mailbox hosting, SES relay, billing — still stands; only the
engine changes).

## Why

Stalwart splits multi-tenant isolation + per-tenant quotas behind a paid **Enterprise**
licence (the email spec flagged this as Fatal for a paid multi-customer product). The
requirement is **fully free / no premium dependency**, so we move to **mailcow**
(GPL-3.0, batteries-included: Postfix, Dovecot, Rspamd, SOGo webmail, ClamAV, MariaDB,
Redis, Nginx, ACME).

## Locked decisions

- **Engine:** mailcow (dockerized).
- **Box:** **reuse the current mail box** `46.224.111.182` (`debut-mail-1`, Hetzner id
  `148193641`) — keeps the warmed mail IP + rDNS; MX already points `mail.debutdepoly.com`
  → this IP, so DNS barely changes. **Resize cpx22 (4 GB) → cpx32 (8 GB)** first (mailcow
  wants ~6 GB+).
- **Existing mail data:** **recreate accounts fresh** — no imapsync (mailboxes are new,
  no history worth migrating).
- **Rollback safety:** Stalwart keeps serving until mailcow is verified; only then cut
  over + decommission. No mail lost.

## Current live state (from the Stalwart work, safe to leave)

`debutdepoly.com` is now the primary domain; `admin@debutdepoly.com` exists; the panel's
Coolify `STALWART_ADMIN` env was updated (not redeployed). Domains in play:
`debutdepoly.com`, `trustedcarfinance.com`, `debutwebconsultants.co.uk`
(+ `trustedcarcredit.com`, to be dropped). Recreate these (minus trustedcarcredit.com,
unless wanted) in mailcow. Mailboxes to recreate: `paul@debutwebconsultants.co.uk`,
`pf@trustedcarfinance.com`, plus any new ones.

## Two unblocks before execution

1. **Parallel session must pause mail/DNS edits.** Another session has been building the
   Stalwart-based `server/mail.js` + Email panel + Domain Connect DNS on `main`. Phase 2
   (rewrite to mailcow) **will collide** with it — it must stop touching those files first.
2. **Shell access to the box.** Installing mailcow is a shell operation and this
   environment has no non-interactive SSH (no `sshpass`, password auth). Pick one:
   - **(a) Operator-run:** I hand you a complete copy-paste install script; you run it via
     the Hetzner console / your SSH. Simplest, you stay in control.
   - **(b) Automated rebuild:** I rebuild the box via the Hetzner API with cloud-init that
     installs Docker + mailcow + injects an SSH key. Fully automated but **destructive**
     (wipes the box — fine, since we're not migrating data) and runs blind until first login.

## Phases

### Phase 0 — Provision mailcow
- Resize `debut-mail-1` → cpx32 (Hetzner API; reboot).
- Install: `git clone https://github.com/mailcow/mailcow-dockerized`, `./generate_config.sh`
  with `MAILCOW_HOSTNAME=mail.debutdepoly.com`, `docker compose pull && up -d`.
- TLS: mailcow's built-in ACME issues Let's Encrypt for `mail.debutdepoly.com` +
  `autodiscover/autoconfig` (needs those A/CNAMEs live → the IP, which they already are).
- ponytail: on 8 GB, optionally `SKIP_CLAMD=y` / `SKIP_SOLR=y` if RAM is tight; re-enable later.

### Phase 1 — Domains + mailboxes (mailcow API)
- Create an API key in mailcow (Admin → Configuration → API), store as `MAILCOW_API_URL`
  + `MAILCOW_API_KEY` in the panel env (Coolify), replacing `STALWART_URL`/`STALWART_ADMIN`.
- Add domains + mailboxes via mailcow's REST API (`/api/v1/add/domain`,
  `/api/v1/add/mailbox`), recreating the accounts fresh.

### Phase 2 — Rewrite the panel integration (BLOCKED on unblock #1)
- Rewrite `server/mail.js`: Stalwart JMAP → **mailcow REST API**
  (`/api/v1/{add,delete,get,edit}/{domain,mailbox,alias}`, `X-API-Key` header). Same
  exported functions (`listDomains`, `createDomain`, `deleteDomain`, `listMailboxes`,
  `createMailbox`, `deleteMailbox`, `dnsRecords`) so `index.js` routes + the Email page
  are largely unchanged. DKIM record now comes from mailcow's `/api/v1/get/dkim/{domain}`.
- Update env var names; keep `dnsRecords()` (MX/SPF/DMARC/autoconfig) — still valid.

### Phase 3 — Cut over + decommission
- MX already → `mail.debutdepoly.com` → same IP, so inbound flows to mailcow once it's up
  and Stalwart is stopped. Publish mailcow's DKIM per domain (replaces any Stalwart DKIM).
- Verify send/receive/webmail (SOGo at `mail.debutdepoly.com/SOGo` or the mailcow UI).
- Stop/remove Stalwart. Update the email spec's engine section.

## Testing / verification

- After Phase 1: send + receive a test message to each recreated mailbox; check webmail login.
- After Phase 2: panel add-domain / add-mailbox / delete-mailbox / delete-domain all work
  against mailcow (the delete bug is moot on the new engine).
- Deliverability smoke test (mail-tester.com) before calling it done.

## Notes

- The billing matrix work (£2.99/mailbox) is engine-agnostic — unaffected.
- Per-customer billing build waits until the engine is stable on mailcow.
- Reusing the IP means no reputation reset; keep rDNS `= mail.debutdepoly.com`.
