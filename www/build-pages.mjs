/* Generates the DebutDeploy marketing pages from the Claude Design source.
 *
 *   node www/build-pages.mjs
 *
 * Emits, next to this file:
 *   render-alternative.html   railway-alternative.html
 *   heroku-alternative.html   flyio-alternative.html      (Comparison Pages.dc.html)
 *   managed-postgres.html     nodejs-hosting.html
 *   python-hosting.html       docker-hosting.html
 *   european-paas.html                                    (Landing Pages.dc.html)
 *   faq.html                                              (FAQ.dc.html)
 *
 * The design files render four/five variants from one tabbed component. Here each
 * variant is its own crawlable URL and the tabs become links between them.
 * index.html is hand-maintained and is NOT written by this script.
 *
 * All copy lives in this file, so a price change is edited once and regenerated.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, STATUS, SITE, esc, head, header, pageClose } from './_chrome.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------- responsive polish */

/* Small-screen corrections for the generated pages only. Everything lives
 * behind the breakpoints assets/dd.css already uses (1140 / 980 / 900 / 760),
 * so the desktop design at 1141px and above is byte-for-byte the design's.
 * dd.css is not ours to edit, hence a page-scoped block injected into <head>.
 *
 * Hooks:
 *   [data-fine]     — a mono micro-label the design sets at 10–11.5px. Floored
 *                     at 12px on phones and tablets; untouched on desktop.
 *   [data-tap]      — a standalone link that is only ~18–20px tall; grown to a
 *                     44px touch target without moving it on desktop.
 *   [data-toc-link] — the FAQ table-of-contents entries.
 */
const PAGE_CSS = `<style>
/* --- generated-page responsive corrections (see www/build-pages.mjs) --- */
@media (max-width: 1140px) {
  /* dd.css forces h2 { font-size: 26px !important } at <=900px for real
     headings. The FAQ group labels are eyebrow-sized <h2 class="mono">, so
     they were being blown up to 26px and pushing the column ~30px past the
     viewport. [data-fine] outranks the bare h2 rule and floors them instead. */
  [data-fine] { font-size: 12px !important; }
  [data-tap] { display: inline-flex !important; align-items: center; min-height: 44px; }
  [data-toc-link] { display: flex !important; align-items: center; min-height: 44px; font-size: 12.5px !important; padding: 10px 12px !important; }
  /* The plan table scrolls inside its own wrapper; make that obvious and keep
     the scroll off the document. */
  [data-table-scroll] { overflow-x: auto !important; max-width: 100%; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
}
@media (max-width: 760px) {
  /* Two small stat tiles side by side inside a 272px card leave ~76px each. */
  [data-save-tiles] { grid-template-columns: minmax(0, 1fr) !important; }
  /* 860px of table inside a 320px phone is a long drag; trim the floor so the
     same columns fit in roughly one and a half screens instead of three. */
  [data-plan-table] { min-width: 640px !important; }
}
</style>`;

const headCss = (...args) => head(...args).replace('</head>', `${PAGE_CSS}\n</head>`);

/* ------------------------------------------------------------------ chrome */

/* The bill comparison — identical markup hook on every page, so the one
   implementation in assets/dd-calculator.js drives all of them. */
function calculator() {
  return `
  <section id="calculator" style="border-bottom: 1px solid #e5e8ee; background: linear-gradient(180deg, #ffffff 0%, #f2f6ff 100%);">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 92px 32px;">
      <div data-dd-calculator></div>
    </div>
  </section>`;
}

/* Shared FAQ disclosure markup driven by dd-site.js */
function accordion(items, { openFirst = true, pad = '56px' } = {}) {
  return `<div data-accordion${openFirst ? ' data-open-first' : ''} style="margin-top: 28px; border-top: 1px solid #e5e8ee;">
${items.map(([q, a], i) => {
  const on = openFirst && i === 0;
  return `        <div data-q style="border-bottom: 1px solid #e5e8ee;">
          <button type="button" aria-expanded="${on}" style="width: 100%; text-align: left; background: none; border: 0; cursor: pointer; padding: 19px 4px; display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 44px;"><span style="font-size: 16px; font-weight: 600; letter-spacing: -0.012em;">${esc(q)}</span><span data-sign aria-hidden="true" style="font-size: 18px; color: #8b939f; flex: none;">${on ? '−' : '+'}</span></button>
          <p data-a style="${on ? '' : 'display: none; '}padding: 0 ${pad} 20px 4px; font-size: 15px; line-height: 1.65; color: #4d5661; text-wrap: pretty;">${esc(a)}</p>
        </div>`;
}).join('\n')}
      </div>`;
}

function tabs(items, activeKey) {
  return `<div role="tablist" aria-label="Choose a page" style="display: flex; flex-wrap: wrap; gap: 8px; padding: 5px; background: #eff2f7; border-radius: 12px; width: fit-content;">
        ${items.map(t => {
          const on = t.key === activeKey;
          return `<a role="tab" aria-selected="${on}" href="${t.slug}" style="padding: 10px 16px; min-height: 44px; display: grid; place-items: center; border-radius: 9px; font-size: 14px; font-weight: 600; background: ${on ? '#0b0d12' : 'transparent'}; color: ${on ? '#ffffff' : '#4d5661'};">${esc(t.label)}</a>`;
        }).join('\n        ')}
      </div>`;
}

const ctaBlock = (heading, body) => `
  <section style="background: #f7f9fc; border-bottom: 1px solid #e5e8ee;">
    <div data-wrap style="max-width: 1000px; margin: 0 auto; padding: 92px 32px; text-align: center;">
      <h2 style="font-size: 40px; line-height: 1.08; letter-spacing: -0.035em; font-weight: 800; text-wrap: balance;">${esc(heading)}</h2>
      <p style="margin-top: 18px; font-size: 17.5px; line-height: 1.6; color: #4d5661; max-width: 38em; margin-left: auto; margin-right: auto; text-wrap: pretty;">${esc(body)}</p>
      <div style="margin-top: 28px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
        <a data-cta href="${APP}" class="h-primary" style="padding: 15px 24px; min-height: 48px; display: grid; place-items: center; border-radius: 11px; background: #2563eb; color: #fff; font-size: 15.5px; font-weight: 600;">Deploy a test application</a>
        <a data-cta href="/contact.html" class="h-ghost" style="padding: 15px 24px; min-height: 48px; display: grid; place-items: center; border-radius: 11px; background: #fff; border: 1px solid #d8dde6; color: #0b0d12; font-size: 15.5px; font-weight: 600;">Speak to a migration engineer</a>
      </div>
      <p class="mono" style="margin-top: 18px; font-size: 12px; color: #8b939f;">Keep your existing service online while you evaluate DebutDeploy.</p>
    </div>
  </section>`;

/* ------------------------------------------------------- comparison pages */

const COMPARE = {
  render: {
    key: 'render', label: 'vs Render', name: 'Render', slug: '/render-alternative.html',
    title: 'DebutDeploy vs Render — same workflow, roughly half the bill',
    desc: "Plan-by-plan cost comparison against Render on equivalent CPU and memory, with sources and the date each figure was checked.",
    eyebrow: 'DebutDeploy vs Render',
    headline: "Render's developer experience. Roughly half the bill.",
    intro: 'Push-to-deploy from Git, managed Postgres, logs and rollbacks — the workflow you already know, on European hardware, with transfer included instead of metered and no per-seat workspace fee.',
    ourTotal: '$57', theirTotal: '~$104', ourBar: '55%', saveMonth: '$47', saveYear: '$564',
    workloadLabel: 'One production workload · 2 vCPU / 4 GB + small Postgres + ~100 GB traffic',
    workloadNote: 'Our figure: Pro Plus compute ($45) + DB Starter ($12). Render: Pro instance ($85) + Postgres Basic-1GB ($19), single seat on the free workspace tier.',
    verified: 'Verified 24 July 2026 · source render.com/pricing · USD, ex-VAT · shared vs dedicated CPU noted per row',
    shortVersion: [
      { label: 'Price', title: 'The same box, 40–51% cheaper', body: 'Every DebutDeploy plan is matched to a Render instance on CPU and memory. The gap widens as the box gets bigger.' },
      { label: 'Transfer', title: '20 TB included, not metered', body: 'Render includes 500 GB and bills $0.10/GB beyond it. A single busy month of media delivery is where surprise invoices come from.' },
      { label: 'Seats', title: 'No workspace or per-user fee', body: 'Render charges per user on Professional workspaces. Team members are included on every DebutDeploy plan.' }
    ],
    tableHeading: 'Plan for plan against Render',
    planRows: [
      { spec: '0.5 vCPU · 512 MB', ours: '$5', ourPlan: 'Hobby', theirs: '$7', theirPlan: 'Starter', delta: '29% less' },
      { spec: '0.5 vCPU · 1 GB', ours: '$9', ourPlan: 'Starter', theirs: '$10', theirPlan: 'Starter (1 GB)', delta: '10% less' },
      { spec: '1 vCPU · 2 GB', ours: '$15', ourPlan: 'Pro', theirs: '$25', theirPlan: 'Standard', delta: '40% less' },
      { spec: '2 vCPU · 4 GB', ours: '$45', ourPlan: 'Pro Plus · dedicated', theirs: '$85', theirPlan: 'Pro', delta: '47% less' },
      { spec: '4 vCPU · 8 GB', ours: '$85', ourPlan: 'Scale · dedicated', theirs: '$175', theirPlan: 'Pro Plus', delta: '51% less' }
    ],
    sourceNote: 'Prices in USD per month, ex-VAT, checked 24 July 2026 against render.com/pricing. Compute only — databases and transfer are listed separately below. DebutDeploy plans at 2 vCPU and above are dedicated CPU; Hobby, Starter and Pro are shared boxes, as are the equivalent Render Starter and Standard instances.',
    lineItems: [
      { label: 'Managed Postgres', ours: 'from $5 · DB Starter $12 (1 GB / 10 GB)', theirs: 'Render: from $19 for 1 GB' },
      { label: 'Outbound transfer', ours: '20 TB included on every plan', theirs: 'Render: 500 GB then $0.10/GB' },
      { label: 'Team seats', ours: 'included, unlimited members', theirs: 'Render: $19/user on Professional' },
      { label: 'Cold starts', ours: 'none — services never sleep', theirs: 'Render: free instances sleep' }
    ],
    sameHeading: 'What stays exactly the same',
    staysSame: [
      'Deploy from a GitHub repository on push to your chosen branch',
      'Framework auto-detection with editable build and start commands',
      'Managed Postgres with connection strings and automated backups',
      'Environment variables, deploy logs, health checks and rollbacks',
      'Automatic TLS on custom domains you keep control of',
      'Background workers and cron-style scheduled jobs'
    ],
    betterHeading: 'Where Render is still ahead',
    theyWin: [
      'US and Asia-Pacific regions — DebutDeploy is EU-only (Germany and Finland)',
      'Preview environments per pull request are live on Render; ours are planned, not available',
      'A larger public ecosystem of templates, blueprints and community answers',
      'Longer public operating history as a platform business'
    ],
    moveHeading: 'Moving from Render',
    faqHeading: 'Render migration questions',
    faqs: [
      ['Is this a Render clone?', 'The deployment workflow is deliberately familiar, because that is the part developers do not want to relearn. The infrastructure, regions and commercial model are ours: EU-only hardware, fixed monthly boxes, included transfer and no seat fees.'],
      ['Will my render.yaml work?', 'It is not read directly. Services, build commands, environment groups and workers map across one-to-one during an assisted migration, and we reproduce the configuration for you before anything is switched.'],
      ['What about Render Disks and persistent storage?', 'Persistent volumes are supported. Bring the volume size you need and we will size the equivalent disk; data is copied during the validated migration step.'],
      ['Do you match Render on regions?', 'No. We run Frankfurt and Helsinki only. If you need US or APAC compute, Render is the better fit and we will tell you so.'],
      ['How does the price gap hold as I grow?', 'It widens: 29% at the smallest box, 47% at 2 vCPU / 4 GB, 51% at 4 vCPU / 8 GB — before transfer and seats, where Render meters and we do not.'],
      ['Can I run both while I evaluate?', 'Yes, and we recommend it. Deploy the same repository here, compare behaviour and cost for a billing cycle, and only move DNS when you are satisfied.']
    ],
    ctaHeading: 'Run the same repo on both. Compare the invoice.',
    ctaBody: 'Deploy a test application on DebutDeploy while your Render service keeps serving traffic. No migration, no DNS change, no commitment.'
  },

  railway: {
    key: 'railway', label: 'vs Railway', name: 'Railway', slug: '/railway-alternative.html',
    title: 'DebutDeploy vs Railway — a fixed monthly box instead of a usage meter',
    desc: 'Cost comparison against Railway on equivalent always-on CPU and memory, with computed usage figures, sources and the date each was checked.',
    eyebrow: 'DebutDeploy vs Railway',
    headline: 'A fixed monthly box instead of a usage meter.',
    intro: 'Railway bills vCPU, memory and egress by consumption, so the invoice is only knowable after the fact. DebutDeploy sells you a defined box at a defined price — the same number every month, whatever your traffic does.',
    ourTotal: '$57', theirTotal: '~$115 *', ourBar: '50%', saveMonth: '~$58', saveYear: '~$696',
    workloadLabel: 'One production workload · 2 vCPU / 4 GB always-on + Postgres + ~100 GB traffic',
    workloadNote: 'Railway figure computed always-on from published usage rates plus one Pro seat and 100 GB egress, and marked indicative (*) — actual usage-based bills vary with load.',
    verified: 'Verified 24 July 2026 · source railway.com/pricing · USD, ex-VAT · usage-based figures are computed, not quoted',
    shortVersion: [
      { label: 'Predictability', title: 'A price you can budget', body: 'No vCPU-minute or GB-hour arithmetic. Choose CPU and memory, pay that amount monthly, and read the invoice before the month rather than after it.' },
      { label: 'Egress', title: '20 TB included vs per-GB billing', body: 'Railway charges for outbound transfer per gigabyte. On media-heavy or API-heavy apps this is frequently the largest single line.' },
      { label: 'Seats', title: 'Seats are free here', body: 'Railway bills per member on Pro. Every DebutDeploy plan includes unlimited team members.' }
    ],
    tableHeading: 'Fixed box versus metered usage',
    planRows: [
      { spec: '0.5 vCPU · 512 MB', ours: '$5', ourPlan: 'Hobby · fixed', theirs: '~$15 *', theirPlan: 'metered, always-on', delta: 'fixed vs metered' },
      { spec: '1 vCPU · 2 GB', ours: '$15', ourPlan: 'Pro · fixed', theirs: '~$40 *', theirPlan: 'metered, always-on', delta: 'fixed vs metered' },
      { spec: '2 vCPU · 4 GB', ours: '$45', ourPlan: 'Pro Plus · dedicated', theirs: '~$80 *', theirPlan: 'metered, always-on', delta: 'fixed vs metered' },
      { spec: '4 vCPU · 8 GB', ours: '$85', ourPlan: 'Scale · dedicated', theirs: '~$160 *', theirPlan: 'metered, always-on', delta: 'fixed vs metered' },
      { spec: 'Team seat', ours: '$0', ourPlan: 'included', theirs: '$20', theirPlan: 'per member, Pro', delta: '100% less' }
    ],
    sourceNote: 'Railway figures (*) are computed from published per-vCPU and per-GB usage rates for a service running continuously for one month, plus the applicable seat, and are indicative only — Railway does not publish a flat monthly price for a given box. Checked 24 July 2026 against railway.com/pricing. USD, ex-VAT.',
    lineItems: [
      { label: 'Billing model', ours: 'fixed monthly per service', theirs: 'Railway: usage-metered, post-billed' },
      { label: 'Outbound transfer', ours: '20 TB included', theirs: 'Railway: billed per GB' },
      { label: 'CPU', ours: 'dedicated at 2 vCPU and above', theirs: 'Railway: shared vCPU allocation' },
      { label: 'Managed Postgres', ours: 'fixed from $5/mo', theirs: 'Railway: metered CPU, RAM and disk' }
    ],
    sameHeading: 'What you keep',
    staysSame: [
      'Deploy from GitHub on push, with build logs you can read',
      'Dockerfile builds as well as automatic language detection',
      'Managed Postgres provisioned in a couple of clicks',
      'Background workers and scheduled jobs that stay resident',
      'Environment variables, private service networking and health checks',
      'Custom domains with certificates issued automatically'
    ],
    betterHeading: 'Where Railway is still ahead',
    theyWin: [
      'Scale-to-zero economics for genuinely idle side projects — a metered platform can be cheaper than any fixed box there',
      'A wider template marketplace and one-click service catalogue',
      'Multi-region deployment options beyond the EU',
      'Fine-grained autoscaling on burst traffic without changing plan'
    ],
    moveHeading: 'Moving from Railway',
    faqHeading: 'Railway migration questions',
    faqs: [
      ['Why is your comparison marked indicative?', 'Because Railway does not publish a flat price for "2 vCPU / 4 GB always-on". We compute it from their published usage rates for a month of continuous running and label it with an asterisk rather than presenting it as a quoted price.'],
      ['My Railway bill swings month to month. Will yours?', 'No. The compute line is the same every month. Only deliberate changes — adding a service, resizing a box, adding a database — change it.'],
      ['Does DebutDeploy scale to zero?', 'No, by design: services stay resident so there are no cold starts. If your workload is genuinely idle most of the month, a metered platform may cost less and we will say so.'],
      ['Can I move my Railway Postgres?', 'Yes. We agree a migration plan, restore a dump into managed Postgres here, validate connectivity and application behaviour, then cut over with a rollback route retained.'],
      ['What about private networking between services?', 'Service-to-service private networking is available in beta. If your architecture depends on it, tell us during the migration review and we will confirm your case.'],
      ['Do you charge for build minutes?', 'No. Builds and deployments are part of the plan; there is no per-build or per-minute charge.']
    ],
    ctaHeading: 'Trade the meter for a number you can plan around.',
    ctaBody: 'Deploy one service here for a billing cycle and compare it against the same workload on Railway. Your existing project stays untouched.'
  },

  heroku: {
    key: 'heroku', label: 'vs Heroku', name: 'Heroku', slug: '/heroku-alternative.html',
    title: 'DebutDeploy vs Heroku — the same workflow at a fraction of the dyno price',
    desc: 'Dyno-for-box cost comparison against Heroku matched on memory, with published sources and the date each figure was checked.',
    eyebrow: 'DebutDeploy vs Heroku',
    headline: 'The Heroku workflow, at a fraction of the dyno price.',
    intro: 'Git deploys, managed Postgres and no server administration — the model Heroku defined — on current European hardware, with memory that is not rationed at 512 MB and databases that are not priced as premium add-ons.',
    ourTotal: '$57', theirTotal: '~$259', ourBar: '22%', saveMonth: '~$202', saveYear: '~$2,424',
    workloadLabel: 'One production workload · ~2 vCPU / 4 GB + production Postgres + ~100 GB traffic',
    workloadNote: 'Heroku figure: Performance-M dyno ($250) plus Postgres Standard-0 ($50) is the nearest tier meeting the workload; Standard-2X ($50) offers only 1 GB RAM. Figures rounded from published list rates.',
    verified: 'Verified 24 July 2026 · source heroku.com/pricing · USD, ex-VAT · dyno tiers matched on memory',
    shortVersion: [
      { label: 'Price', title: 'Dyno pricing has not aged well', body: 'Heroku charges premium rates for modest memory. The same 4 GB of RAM costs a small fraction here.' },
      { label: 'Memory', title: 'No 512 MB ceiling', body: 'Standard dynos cap at 1 GB before a large jump to Performance tiers. Our plans step 512 MB → 1 → 2 → 4 → 8 GB at linear prices.' },
      { label: 'Database', title: 'Postgres is not an add-on tax', body: 'Managed Postgres starts at $5/mo with nightly backups included rather than being priced as a separate premium product.' }
    ],
    tableHeading: 'Dyno for box against Heroku',
    planRows: [
      { spec: '0.5 vCPU · 512 MB', ours: '$5', ourPlan: 'Hobby', theirs: '$7', theirPlan: 'Eco/Basic dyno', delta: '29% less' },
      { spec: '~1 vCPU · 1 GB', ours: '$9', ourPlan: 'Starter', theirs: '$50', theirPlan: 'Standard-2X', delta: '82% less' },
      { spec: '~2 vCPU · 2.5–4 GB', ours: '$45', ourPlan: 'Pro Plus · dedicated', theirs: '$250', theirPlan: 'Performance-M', delta: '82% less' },
      { spec: 'Production Postgres', ours: '$12', ourPlan: 'DB Starter · 10 GB', theirs: '$50', theirPlan: 'Standard-0', delta: '76% less' },
      { spec: 'Outbound transfer', ours: '$0', ourPlan: '20 TB included', theirs: 'n/a', theirPlan: 'no published egress fee', delta: 'comparable' }
    ],
    sourceNote: 'Prices in USD per month, ex-VAT, checked 24 July 2026 against heroku.com/pricing. Dyno tiers are matched on available memory rather than tier name; Heroku does not publish vCPU counts per dyno in the same terms, so CPU equivalence is approximate and stated as such.',
    lineItems: [
      { label: 'Managed Postgres', ours: 'from $5, nightly backups', theirs: 'Heroku: Standard-0 from $50' },
      { label: 'Sleeping services', ours: 'never sleep', theirs: 'Heroku: Eco dynos sleep' },
      { label: 'Region', ours: 'Germany and Finland (EU)', theirs: 'Heroku: US and EU regions' },
      { label: 'Add-on model', ours: 'no add-on marketplace markup', theirs: 'Heroku: paid add-ons per service' }
    ],
    sameHeading: 'What carries over',
    staysSame: [
      'Git-based deploys with a build step and release logs',
      'Managed Postgres with credentials injected as environment variables',
      'Config vars map directly to environment variables',
      'Worker processes for queues and background jobs',
      'Scheduled jobs replacing Heroku Scheduler',
      'Rollback to the previous release after a bad deploy'
    ],
    betterHeading: 'Where Heroku is still ahead',
    theyWin: [
      'A mature add-on marketplace with dozens of one-click managed services',
      'Long-standing enterprise procurement, compliance paperwork and support contracts',
      'Salesforce ecosystem integration if that is part of your stack',
      'Buildpack ecosystem breadth for unusual runtimes'
    ],
    moveHeading: 'Moving from Heroku',
    faqHeading: 'Heroku migration questions',
    faqs: [
      ['Do buildpacks work here?', 'Not directly. Most Heroku applications build cleanly from automatic language detection or a Dockerfile. Unusual buildpacks are the one case worth checking in a migration review first.'],
      ['What happens to my config vars?', 'They become environment variables, encrypted at rest and write-only after saving. We never ask you to send secrets by email.'],
      ['Can you move Heroku Postgres?', 'Yes — a pg_dump restore into managed Postgres, validated before any DNS change. Large databases get a scheduled short write-freeze window rather than a vague promise of zero downtime.'],
      ['Is there an equivalent of Heroku Scheduler?', 'Yes. Scheduled jobs run on a cron expression per service, with logs in the same place as your deploys.'],
      ['Do you support review apps?', 'Not yet — preview environments are planned and not available. If review apps are central to your workflow, that is a genuine gap today.'],
      ['We are on an enterprise Heroku contract. Can you match it?', 'Custom terms, larger boxes and specific SLA language are handled case by case. Speak to us rather than assuming the published plans are the ceiling.']
    ],
    ctaHeading: 'Deploy one dyno-equivalent and compare.',
    ctaBody: 'Bring one service across, run it beside your Heroku app for a cycle, and look at both invoices before you decide anything.'
  },

  flyio: {
    key: 'flyio', label: 'vs Fly.io', name: 'Fly.io', slug: '/flyio-alternative.html',
    title: 'DebutDeploy vs Fly.io — managed deployment instead of infrastructure homework',
    desc: 'Cost and operating-model comparison against Fly.io for always-on workloads, with computed figures, sources and the date each was checked.',
    eyebrow: 'DebutDeploy vs Fly.io',
    headline: 'Managed deployment instead of infrastructure homework.',
    intro: 'Fly.io gives you machines, a global network and a CLI to orchestrate them. DebutDeploy gives you a control panel that runs the service for you — one region, fixed pricing, and no fly.toml to maintain.',
    ourTotal: '$57', theirTotal: '~$105 *', ourBar: '54%', saveMonth: '~$48', saveYear: '~$576',
    workloadLabel: 'One production workload · 2 vCPU / 4 GB always-on + managed Postgres + ~100 GB traffic',
    workloadNote: 'Fly.io figure computed from published performance-2x machine rates running continuously, plus a managed Postgres equivalent and 100 GB egress at $0.02/GB. Marked indicative (*).',
    verified: 'Verified 24 July 2026 · source fly.io/docs/about/pricing · USD, ex-VAT · computed always-on',
    shortVersion: [
      { label: 'Operating model', title: 'A panel, not a CLI and a config file', body: 'No fly.toml, no machine lifecycle to reason about. Connect a repo, set variables, deploy — and read logs and health in one place.' },
      { label: 'Price', title: 'Around half, computed always-on', body: 'For a service that runs continuously, the fixed box is cheaper than metered machines plus volumes plus egress.' },
      { label: 'Databases', title: 'Managed, not self-operated', body: 'Postgres here is a managed service with nightly backups, rather than a Postgres app you are responsible for running.' }
    ],
    tableHeading: 'Machines versus a managed box',
    planRows: [
      { spec: '1 vCPU · 2 GB', ours: '$15', ourPlan: 'Pro · fixed', theirs: '~$32 *', theirPlan: 'shared-cpu machine, always-on', delta: 'fixed vs metered' },
      { spec: '2 vCPU · 4 GB', ours: '$45', ourPlan: 'Pro Plus · dedicated', theirs: '~$62 *', theirPlan: 'performance-2x, always-on', delta: 'fixed vs metered' },
      { spec: '4 vCPU · 8 GB', ours: '$85', ourPlan: 'Scale · dedicated', theirs: '~$124 *', theirPlan: 'performance-4x, always-on', delta: 'fixed vs metered' },
      { spec: 'Postgres', ours: '$12', ourPlan: 'DB Starter, managed', theirs: '~$30 *', theirPlan: 'machine + volume, self-run', delta: 'managed vs self-run' },
      { spec: '100 GB egress', ours: '$0', ourPlan: 'inside 20 TB', theirs: '~$2', theirPlan: '$0.02/GB', delta: 'included' }
    ],
    sourceNote: 'Fly.io figures (*) are computed from published machine and volume rates for continuous monthly running and are indicative; Fly.io bills by the second, so an app that idles or scales to zero will cost less than shown. Checked 24 July 2026 against fly.io/docs/about/pricing. USD, ex-VAT.',
    lineItems: [
      { label: 'Configuration', ours: 'panel-driven, no config file', theirs: 'Fly.io: fly.toml + flyctl' },
      { label: 'Postgres', ours: 'managed with nightly backups', theirs: 'Fly.io: you operate the cluster' },
      { label: 'Egress', ours: '20 TB included', theirs: 'Fly.io: $0.02/GB' },
      { label: 'Regions', ours: 'Germany and Finland', theirs: 'Fly.io: global edge regions' }
    ],
    sameHeading: 'What you keep',
    staysSame: [
      'Dockerfile-based deploys, exactly as you build them today',
      'Deploy from Git on push instead of running a CLI command',
      'Persistent volumes for services that need disk',
      'Private networking between your own services (beta)',
      'Health checks with automatic rollback on failure',
      'Logs and resource metrics without adding an external vendor'
    ],
    betterHeading: 'Where Fly.io is still ahead',
    theyWin: [
      'Global anycast deployment across many regions — we run two EU regions only',
      'Per-second billing and scale-to-zero for spiky or idle workloads',
      'Low-level machine control, GPU options and edge placement',
      'Multi-region Postgres read replicas for latency-sensitive reads'
    ],
    moveHeading: 'Moving from Fly.io',
    faqHeading: 'Fly.io migration questions',
    faqs: [
      ['Will my Dockerfile work unchanged?', 'Almost always, yes. We build the same image; what changes is that the platform manages placement, TLS, health and restarts rather than you describing them in fly.toml.'],
      ['Do you support multiple regions?', 'No. Two EU regions — Frankfurt and Helsinki. If you serve a genuinely global audience from the edge, Fly.io remains the better tool.'],
      ['What about my Fly Postgres cluster?', 'It becomes a managed Postgres instance here: we restore a dump, validate it, and take over backups. You stop being the DBA for it.'],
      ['Can I keep scale-to-zero behaviour?', 'No — services stay resident. That is the trade for having no cold starts, and it is why the fixed price is predictable.'],
      ['Is per-second billing available?', 'No. Billing is monthly per service. For always-on workloads that works out cheaper; for intermittent ones it may not.'],
      ['How do you handle volumes?', 'Persistent disks are supported and sized per service; data is copied and verified during the migration step before any traffic moves.']
    ],
    ctaHeading: 'Hand the machine management back.',
    ctaBody: 'Deploy the same image here and see whether a managed EU box covers what your Fly machines are doing today.'
  }
};

const COMPARE_ORDER = ['render', 'railway', 'heroku', 'flyio'];
const COMPARE_TABS = COMPARE_ORDER.map(k => ({ key: k, label: COMPARE[k].label, slug: COMPARE[k].slug }));

function comparePage(d) {
  const moveSteps = [
    ['01', 'Review', `We list your services, databases, variables, volumes, domains and workers on ${d.name} and flag anything that needs a decision.`],
    ['02', 'Reproduce', 'Equivalent DebutDeploy services are configured and built, and the output is compared against your current deployment.'],
    ['03', 'Validate', `Application behaviour, database connectivity and performance are tested while ${d.name} keeps serving live traffic.`],
    ['04', 'Switch', `DNS moves only once you sign off, with the ${d.name} service kept warm as a rollback route.`]
  ];

  return `${headCss(d.title, d.desc, d.slug.slice(1))}
${header('compare')}

<main style="display: block;">
  <section style="border-bottom: 1px solid #e5e8ee; background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 88px;">
      ${tabs(COMPARE_TABS, d.key)}
      <p data-fine class="mono" style="margin-top: 18px; font-size: 11.5px; color: #8b939f;">${esc(d.slug)}</p>

      <div data-hero style="margin-top: 34px; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 56px; align-items: start;">
        <div>
          <p data-fine class="mono" style="font-size: 11.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #2563eb; display: flex; align-items: center; gap: 12px;"><span aria-hidden="true" style="width: 22px; height: 2px; background: #2563eb; flex: none;"></span>${esc(d.eyebrow)}</p>
          <h1 style="margin-top: 20px; font-size: 54px; line-height: 1.05; letter-spacing: -0.035em; font-weight: 800; text-wrap: balance;">${esc(d.headline)}</h1>
          <p style="margin-top: 22px; font-size: 18px; line-height: 1.6; color: #4d5661; max-width: 34em; text-wrap: pretty;">${esc(d.intro)}</p>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px;">
            <a data-cta href="${APP}" class="h-primary" style="padding: 14px 22px; min-height: 48px; display: grid; place-items: center; font-size: 15px; font-weight: 600; color: #fff; background: #2563eb; border-radius: 11px; box-shadow: 0 6px 18px -8px rgba(37,99,235,0.7);">Deploy a test application</a>
            <a data-cta href="#calculator" class="h-ghost" style="padding: 14px 22px; min-height: 48px; display: grid; place-items: center; font-size: 15px; font-weight: 600; color: #0b0d12; background: #fff; border: 1px solid #d8dde6; border-radius: 11px;">Compare my current bill</a>
          </div>
          <p data-fine class="mono" style="margin-top: 24px; font-size: 11.5px; color: #8b939f; line-height: 1.8;">${esc(d.verified)}</p>
        </div>

        <div style="border: 1px solid #dfe4ec; border-radius: 16px; background: #fff; padding: 26px; box-shadow: 0 26px 54px -34px rgba(11,13,18,0.26);">
          <p data-fine class="mono" style="font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #8b939f;">${esc(d.workloadLabel)}</p>
          <div style="margin-top: 20px; display: grid; gap: 16px;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;"><span class="mono" style="font-size: 12.5px; font-weight: 600; color: #2563eb;">DebutDeploy</span><span style="font-size: 20px; font-weight: 800; letter-spacing: -0.03em; color: #15803d;">${esc(d.ourTotal)}</span></div>
              <div style="height: 10px; border-radius: 999px; background: #eceff4; margin-top: 8px; overflow: hidden;"><div style="height: 10px; border-radius: 999px; background: #2563eb; width: ${d.ourBar};"></div></div>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;"><span class="mono" style="font-size: 12.5px; font-weight: 600; color: #4d5661;">${esc(d.name)}</span><span style="font-size: 20px; font-weight: 800; letter-spacing: -0.03em; color: #dc2626;">${esc(d.theirTotal)}</span></div>
              <div style="height: 10px; border-radius: 999px; background: #eceff4; margin-top: 8px; overflow: hidden;"><div style="height: 10px; border-radius: 999px; background: #c3cad6; width: 100%;"></div></div>
            </div>
          </div>
          <div data-save-tiles style="margin-top: 22px; padding-top: 18px; border-top: 1px solid #eceff4; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div style="border: 1px solid #d3e0ff; background: #f5f8ff; border-radius: 11px; padding: 14px;">
              <p data-fine class="mono" style="font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: #6f8bd6;">You save / mo</p>
              <p style="font-size: 22px; font-weight: 800; letter-spacing: -0.03em; margin-top: 6px; color: #15803d;">${esc(d.saveMonth)}</p>
            </div>
            <div style="border: 1px solid #eceff4; background: #fbfcfe; border-radius: 11px; padding: 14px;">
              <p data-fine class="mono" style="font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: #9aa2ae;">Over 12 months</p>
              <p style="font-size: 22px; font-weight: 800; letter-spacing: -0.03em; margin-top: 6px; color: #0b0d12;">${esc(d.saveYear)}</p>
            </div>
          </div>
          <p style="margin-top: 16px; font-size: 12px; color: #8b939f; line-height: 1.6;">${esc(d.workloadNote)}</p>
        </div>
      </div>
    </div>
  </section>

  <section style="border-bottom: 1px solid #e5e8ee; background: #fff;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 88px 32px;">
      <h2 style="font-size: 36px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">The short version</h2>
      <div data-grid="3" style="margin-top: 32px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px;">
        ${d.shortVersion.map(sv => `<article style="border: 1px solid #e5e8ee; border-radius: 15px; padding: 24px; background: #fbfcfe;">
          <p data-fine class="mono" style="font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase; color: #8b939f;">${esc(sv.label)}</p>
          <h3 style="font-size: 19px; font-weight: 700; letter-spacing: -0.02em; margin-top: 12px;">${esc(sv.title)}</h3>
          <p style="margin-top: 9px; font-size: 14.5px; line-height: 1.6; color: #4d5661; text-wrap: pretty;">${esc(sv.body)}</p>
        </article>`).join('\n        ')}
      </div>
    </div>
  </section>

  <section style="border-bottom: 1px solid #e5e8ee; background: #f7f9fc;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 88px 32px;">
      <h2 style="font-size: 36px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">${esc(d.tableHeading)}</h2>
      <p style="margin-top: 14px; font-size: 16.5px; line-height: 1.6; color: #4d5661; max-width: 46em; text-wrap: pretty;">Plans are matched on CPU and memory, not on marketing tier names. Where a provider has no exact match, the nearest plan that meets the workload is used and the difference is stated.</p>
      <div style="margin-top: 28px; border: 1px solid #e5e8ee; border-radius: 16px; background: #fff; overflow: hidden;">
        <div data-table-scroll style="overflow-x: auto;">
          <table data-plan-table style="width: 100%; border-collapse: collapse; min-width: 860px;">
            <thead>
              <tr style="background: #fbfcfe; border-bottom: 1px solid #e5e8ee;">
                <th scope="col" data-fine class="mono" style="text-align: left; padding: 14px 22px; font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase; color: #8b939f; font-weight: 500;">Resources</th>
                <th scope="col" style="text-align: left; padding: 14px 16px; font-size: 13px; font-weight: 700; color: #2563eb;">DebutDeploy</th>
                <th scope="col" style="text-align: left; padding: 14px 16px; font-size: 13px; font-weight: 600; color: #4d5661;">${esc(d.name)}</th>
                <th scope="col" data-fine class="mono" style="text-align: left; padding: 14px 22px; font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase; color: #8b939f; font-weight: 500;">Difference</th>
              </tr>
            </thead>
            <tbody>
              ${d.planRows.map(r => `<tr style="border-bottom: 1px solid #f2f4f8;">
                <th scope="row" class="mono" style="text-align: left; padding: 15px 22px; font-size: 12.5px; font-weight: 500; color: #2b323c; white-space: nowrap;">${esc(r.spec)}</th>
                <td style="padding: 15px 16px; background: #f7f9ff;"><span style="font-size: 17px; font-weight: 700; color: #15803d;">${esc(r.ours)}</span> <span data-fine class="mono" style="font-size: 11px; color: #8b939f;">${esc(r.ourPlan)}</span></td>
                <td style="padding: 15px 16px;"><span style="font-size: 17px; font-weight: 700; color: #dc2626;">${esc(r.theirs)}</span> <span data-fine class="mono" style="font-size: 11px; color: #8b939f;">${esc(r.theirPlan)}</span></td>
                <td class="mono" style="padding: 15px 22px; font-size: 12px; color: #1b4ed1;">${esc(r.delta)}</td>
              </tr>`).join('\n              ')}
            </tbody>
          </table>
        </div>
        <div style="padding: 18px 22px; background: #fbfcfe; border-top: 1px solid #eceff4;">
          <p data-fine class="mono" style="font-size: 11.5px; color: #8b939f; line-height: 1.85;">${esc(d.sourceNote)}</p>
        </div>
      </div>

      <div data-grid="4" style="margin-top: 20px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px;">
        ${d.lineItems.map(li => `<div style="border: 1px solid #e5e8ee; border-radius: 13px; background: #fff; padding: 18px;">
          <p data-fine class="mono" style="font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase; color: #9aa2ae;">${esc(li.label)}</p>
          <p style="font-size: 14.5px; font-weight: 650; margin-top: 9px; color: #15803d;">${esc(li.ours)}</p>
          <p style="font-size: 13.5px; margin-top: 5px; color: #dc2626;">${esc(li.theirs)}</p>
        </div>`).join('\n        ')}
      </div>
    </div>
  </section>

  <section style="border-bottom: 1px solid #e5e8ee; background: #fff;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 88px 32px;">
      <div data-2col style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;">
        <div style="border: 1px solid #d3e0ff; background: #f7f9ff; border-radius: 16px; padding: 26px;">
          <h2 style="font-size: 24px; font-weight: 700; letter-spacing: -0.025em;">${esc(d.sameHeading)}</h2>
          <ul style="margin-top: 18px; display: grid; gap: 11px;">
            ${d.staysSame.map(x => `<li style="display: flex; gap: 10px; font-size: 14.5px; line-height: 1.55; color: #2b323c;"><span aria-hidden="true" style="color: #2563eb;">✓</span><span>${esc(x)}</span></li>`).join('\n            ')}
          </ul>
        </div>
        <div style="border: 1px solid #e5e8ee; background: #fbfcfe; border-radius: 16px; padding: 26px;">
          <h2 style="font-size: 24px; font-weight: 700; letter-spacing: -0.025em;">${esc(d.betterHeading)}</h2>
          <p style="margin-top: 10px; font-size: 14px; color: #6c7480; line-height: 1.6;">Stated plainly, because you will find out anyway during a trial.</p>
          <ul style="margin-top: 18px; display: grid; gap: 11px;">
            ${d.theyWin.map(x => `<li style="display: flex; gap: 10px; font-size: 14.5px; line-height: 1.55; color: #2b323c;"><span aria-hidden="true" style="color: #d97706;">→</span><span>${esc(x)}</span></li>`).join('\n            ')}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section style="border-bottom: 1px solid #e5e8ee; background: #f7f9fc;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 88px 32px;">
      <h2 style="font-size: 36px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">${esc(d.moveHeading)}</h2>
      <div data-grid="4" style="margin-top: 32px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px;">
        ${moveSteps.map(([num, title, body]) => `<article style="border: 1px solid #e5e8ee; border-radius: 14px; padding: 20px; background: #fff;">
          <span data-fine class="mono" style="font-size: 11px; font-weight: 600; color: #2563eb;">${num}</span>
          <h3 style="font-size: 17px; font-weight: 700; letter-spacing: -0.018em; margin-top: 11px;">${esc(title)}</h3>
          <p style="margin-top: 8px; font-size: 13.5px; line-height: 1.6; color: #4d5661; text-wrap: pretty;">${esc(body)}</p>
        </article>`).join('\n        ')}
      </div>
      <div style="margin-top: 20px; display: flex; flex-wrap: wrap; gap: 12px;">
        <a data-cta href="/contact.html" class="h-primary" style="padding: 13px 20px; min-height: 46px; display: grid; place-items: center; border-radius: 10px; background: #2563eb; color: #fff; font-size: 14.5px; font-weight: 600;">Book a migration review</a>
        <a data-cta href="/faq.html#migration" class="h-ghost" style="padding: 13px 20px; min-height: 46px; display: grid; place-items: center; border-radius: 10px; background: #fff; border: 1px solid #d8dde6; color: #0b0d12; font-size: 14.5px; font-weight: 600;">Read the migration answers</a>
      </div>
    </div>
  </section>
${calculator()}
  <section style="border-bottom: 1px solid #e5e8ee; background: #fff;">
    <div data-wrap style="max-width: 1000px; margin: 0 auto; padding: 88px 32px;">
      <h2 style="font-size: 36px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">${esc(d.faqHeading)}</h2>
      ${accordion(d.faqs)}
      <p style="margin-top: 22px; font-size: 14.5px; color: #4d5661;">More operational detail is on the <a href="/faq.html" style="font-weight: 600;">full FAQ page</a>.</p>
    </div>
  </section>
${ctaBlock(d.ctaHeading, d.ctaBody)}
${pageClose('Competitor names and trademarks belong to their respective owners. Comparisons use published list pricing on the date stated and are provided for evaluation, not as a warranty of future pricing.')}`;
}

/* ---------------------------------------------------------- landing pages */

const LANDING = {
  postgres: {
    key: 'postgres', label: 'Managed Postgres', slug: '/managed-postgres.html',
    title: 'Managed Postgres hosting in the EU from $5/mo — DebutDeploy',
    desc: 'Production PostgreSQL 16 with nightly backups, injected connection strings and EU data residency, from $5/mo. No add-on markup, full pg_dump export any time.',
    eyebrow: 'Managed Postgres',
    headline: 'Production Postgres, backed up nightly, priced from $5.',
    intro: 'Provision a managed Postgres instance in the same panel as your application, get the connection string as an environment variable, and stop being responsible for backups, patching and volume management.',
    primaryCta: 'Provision a database',
    trustLine: 'EU regions · nightly backups · 7-day retention · full pg_dump export whenever you want it',
    codeTitle: 'Connection details are injected for you',
    codeLines: [
      '# environment variable set automatically',
      'DATABASE_URL=postgres://app:•••@db-fra1:5432/app',
      '',
      '$ psql $DATABASE_URL -c "select version();"',
      ' PostgreSQL 16.4 on x86_64-pc-linux-gnu',
      '',
      '# nightly backup, retained 7 days',
      'backup 2026-07-27T03:00Z  ok  412 MB'
    ],
    specs: [
      ['Engine', 'PostgreSQL 16'],
      ['Region', 'fra1 · Germany / hel1 · Finland'],
      ['Backups', 'nightly, 7-day retention'],
      ['Export', 'pg_dump, any time']
    ],
    includedHeading: 'What a managed instance gives you',
    included: [
      ['backup', '03:00 UTC nightly', 'Automated backups', 'Nightly logical backups with 7-day retention as standard. Longer retention and point-in-time recovery are available on request.'],
      ['credentials', 'injected at deploy', 'No secret shuffling', 'The connection string is written into your service environment as an encrypted variable — never pasted into a repository or an email.'],
      ['disk', '10 GB included', 'Included storage', 'Each tier ships with disk included and overage at $0.10/GB, so growth is a known cost rather than a surprise line item.'],
      ['network', 'private by default', 'Not on the open internet', 'Databases are reachable from your own services; external access is opt-in and scoped rather than exposed by default.'],
      ['export', 'pg_dump ready', 'No lock-in', 'It is ordinary PostgreSQL. Take a full dump whenever you like and run it anywhere — there is no proprietary layer to unpick.'],
      ['ops', 'patched for you', 'Maintenance handled', 'Minor-version patching, disk monitoring and restart handling are ours. You get told about maintenance windows, not asked to run them.']
    ],
    pricingHeading: 'Database pricing',
    pricingBody: 'Databases are priced separately from compute so you only pay for what your application actually needs. Storage overage is $0.10/GB and there is no charge for connections, queries or backup storage inside retention.',
    priceRows: [['DB Hobby', '256 MB RAM · 2 GB storage', '$5'], ['DB Starter', '1 GB RAM · 10 GB storage', '$12'], ['DB Pro', 'larger instances · on request', 'POA']],
    priceNote: 'USD per month, ex-VAT. Checked 24 July 2026. Comparable 1 GB managed Postgres starts at $19 on Render.',
    quickstartHeading: 'Adding a database',
    quickstart: [
      ['01', 'Create the instance', 'Pick a tier and region in the panel. Provisioning takes under a minute.', 'New → Postgres → DB Starter · fra1'],
      ['02', 'Attach it to a service', 'Attaching writes DATABASE_URL into the service environment and restarts it cleanly.', 'attach db → marketing-genius'],
      ['03', 'Run your migrations', 'Run migrations as part of your build or as a one-off job from the panel.', 'npm run migrate:deploy']
    ],
    faqHeading: 'Database questions',
    faqs: [
      ['Which Postgres version do you run?', 'PostgreSQL 16 with minor-version patching applied by us. Major-version upgrades are scheduled with you rather than applied silently.'],
      ['How often are backups taken and how long are they kept?', 'Nightly, retained for 7 days by default. Longer retention or point-in-time recovery can be arranged on request.'],
      ['Can I connect from outside the platform?', 'Yes, external access can be enabled with scoped credentials — but it is off by default so databases are not exposed on the open internet unintentionally.'],
      ['Can I export everything if I leave?', 'Yes. Take a full pg_dump whenever you want. It is standard PostgreSQL with no proprietary wrapper.'],
      ['Do you charge for backup storage or connections?', 'No. Backups inside the retention window, connection counts and query volume are all part of the instance price. Only disk beyond the included allowance is charged, at $0.10/GB.']
    ],
    ctaHeading: 'Provision a database and point a test app at it.',
    ctaBody: 'You can create an instance, attach it and run your migrations before moving anything that matters.'
  },

  nodejs: {
    key: 'nodejs', label: 'Node.js hosting', slug: '/nodejs-hosting.html',
    title: 'Node.js hosting in Europe with no cold starts — DebutDeploy',
    desc: 'Deploy Next.js, Express, NestJS and Fastify from Git on EU infrastructure. Node 18/20/22, no cold starts, 20 TB transfer included, fixed monthly pricing.',
    eyebrow: 'Node.js hosting',
    headline: 'Node apps that stay warm, on a fixed monthly price.',
    intro: 'Next.js, Express, NestJS, Fastify, Remix — detected from your repository, built on push and kept resident so the first request after a quiet hour is as fast as the last one.',
    primaryCta: 'Deploy a Node app',
    trustLine: 'Node 18 / 20 / 22 · npm, pnpm, yarn and bun lockfiles · no cold starts · 20 TB transfer included',
    codeTitle: 'Detected from your repository',
    codeLines: [
      '==> Detected Next.js 15 · node 22.4.0',
      '==> Lockfile: pnpm-lock.yaml',
      '==> pnpm install --frozen-lockfile',
      '==> pnpm build',
      '==> Compiled successfully in 43s',
      '==> Starting: pnpm start · PORT=8080',
      '==> Health check /api/health → 200 OK',
      '==> Live · TLS issued · rollback retained'
    ],
    specs: [
      ['Runtimes', 'Node 18, 20, 22'],
      ['Package managers', 'npm · pnpm · yarn · bun'],
      ['Cold starts', 'none — always resident'],
      ['Build cache', 'dependencies cached per service']
    ],
    includedHeading: 'What Node services get',
    included: [
      ['framework', 'auto-detected', 'Zero-config builds', 'Next.js, Nuxt, Remix, Astro, Express, NestJS and Fastify are recognised, with build and start commands prefilled and editable.'],
      ['process', 'web + worker', 'Workers alongside the app', 'Run BullMQ or similar queue workers as separate always-resident services with their own resources and logs.'],
      ['ws', 'supported', 'WebSockets and SSE', 'Long-lived connections are fine — services are not request-scoped functions, so sockets and streams behave normally.'],
      ['env', 'encrypted at rest', 'Environment variables', 'Paste a .env once. Values are encrypted, write-only afterwards and injected at build and run time.'],
      ['logs', 'streamed live', 'Build and runtime logs', 'Watch the build as it happens and keep 7 days of runtime logs without adding a logging vendor.'],
      ['rollback', 'one click', 'Rollbacks', 'The previous image is retained. If a deploy misbehaves, roll back while you work out why.']
    ],
    pricingHeading: 'What a Node service costs',
    pricingBody: 'Pick the box your app needs. Node applications with a typical SSR framework and a small database are comfortable on Pro or Pro Plus; API-only services often run happily on Starter.',
    priceRows: [['Starter', '1 GB RAM · 0.5 vCPU · shared', '$9'], ['Pro', '2 GB RAM · 1 vCPU · shared', '$15'], ['Pro Plus', '4 GB RAM · 2 vCPU · dedicated', '$45'], ['Scale', '8 GB RAM · 4 vCPU · dedicated', '$85']],
    priceNote: 'USD per month, ex-VAT. 20 TB transfer included on every plan. Managed Postgres priced separately from $5.',
    quickstartHeading: 'Deploying a Node app',
    quickstart: [
      ['01', 'Connect the repo', 'Authorise GitHub once and choose the repository and branch.', 'connect github → your-org/app'],
      ['02', 'Confirm the build', 'Detected commands are prefilled. Override them if your setup is unusual.', 'build: npm ci && npm run build'],
      ['03', 'Deploy', 'Watch the build log, then get a domain with TLS already issued.', 'start: npm run start']
    ],
    faqHeading: 'Node.js questions',
    faqs: [
      ['Which Node versions are supported?', 'Node 18, 20 and 22. Pin the version in your package.json engines field or a .nvmrc and the build will honour it.'],
      ['Do you support monorepos?', 'Yes. Set the root directory per service so a monorepo can deploy several services from one repository.'],
      ['Are WebSockets supported?', 'Yes. Services are long-running containers rather than request-scoped functions, so WebSockets and server-sent events work as they do locally.'],
      ['Can I run a queue worker?', 'Yes — deploy it as a background worker service. It stays resident, so scheduled and queued jobs are not subject to cold starts.'],
      ['What about build caching?', 'Dependency layers are cached per service, so repeat builds are quicker than a cold install. There is no per-build-minute charge either way.']
    ],
    ctaHeading: 'Deploy one Node service and see the build log.',
    ctaBody: 'Connect a repository, watch it build, and compare the result with whatever is running your app today.'
  },

  python: {
    key: 'python', label: 'Python hosting', slug: '/python-hosting.html',
    title: 'Python hosting for Django, FastAPI and Flask in the EU — DebutDeploy',
    desc: 'Deploy Django, FastAPI and Flask apps and Celery workers from Git on EU infrastructure. Python 3.10–3.13, resident memory, managed Postgres, fixed pricing.',
    eyebrow: 'Python hosting',
    headline: 'Django, FastAPI and Flask, without the ops rota.',
    intro: 'Deploy Python web services and Celery workers from Git, with managed Postgres alongside them and memory that stays allocated — useful when your application loads models or holds long-running work.',
    primaryCta: 'Deploy a Python app',
    trustLine: 'Python 3.10–3.13 · pip, Poetry and uv · Gunicorn and Uvicorn · Celery workers · no cold starts',
    codeTitle: 'A typical Python build',
    codeLines: [
      '==> Detected Python 3.12 · requirements.txt',
      '==> pip install -r requirements.txt',
      '==> python manage.py collectstatic --noinput',
      '==> python manage.py migrate',
      '==> Starting: gunicorn app.wsgi -w 3 -b :8080',
      '==> Worker: celery -A app worker -l info',
      '==> Health check /healthz → 200 OK',
      '==> Live · TLS issued · rollback retained'
    ],
    specs: [
      ['Versions', 'Python 3.10 – 3.13'],
      ['Dependency tools', 'pip · Poetry · uv · pipenv'],
      ['Servers', 'Gunicorn · Uvicorn · Hypercorn'],
      ['Workers', 'Celery, RQ, APScheduler']
    ],
    includedHeading: 'What Python services get',
    included: [
      ['framework', 'django · fastapi', 'Detected or declared', 'Django, FastAPI and Flask are recognised from the repository; anything else runs from a start command or a Dockerfile.'],
      ['worker', 'celery resident', 'Celery that stays up', 'Background workers are separate always-on services with their own CPU and memory, not opportunistic processes.'],
      ['memory', 'up to 8 GB', 'Room for models', 'Applications that load an embedding model or hold caches in memory keep that allocation for the whole month at a fixed price.'],
      ['migrate', 'on release', 'Migrations in the build', 'Run collectstatic and migrate as part of the release step so a deploy either completes fully or rolls back.'],
      ['cron', 'scheduled jobs', 'Scheduled tasks', 'Cron-style jobs run in the same environment as your app, with logs in the same place as your deploys.'],
      ['db', 'postgres 16', 'Postgres next door', 'Managed Postgres in the same region with the connection string injected — the usual Django or SQLAlchemy setup, minus the admin.']
    ],
    pricingHeading: 'What a Python service costs',
    pricingBody: 'Django applications with a worker typically run one Pro or Pro Plus box for the web service and a smaller box for the worker. AI or data workloads that hold models in memory usually want Pro Plus or Scale.',
    priceRows: [['Starter', '1 GB RAM · 0.5 vCPU · shared', '$9'], ['Pro', '2 GB RAM · 1 vCPU · shared', '$15'], ['Pro Plus', '4 GB RAM · 2 vCPU · dedicated', '$45'], ['Scale', '8 GB RAM · 4 vCPU · dedicated', '$85']],
    priceNote: 'USD per month, ex-VAT. Each service is billed separately — a web service plus a worker is two plans. 20 TB transfer included.',
    quickstartHeading: 'Deploying a Python app',
    quickstart: [
      ['01', 'Connect and detect', 'Point at the repository; requirements.txt, pyproject.toml or a Dockerfile is picked up.', 'connect github → your-org/api'],
      ['02', 'Set the start command', 'Gunicorn for WSGI, Uvicorn for ASGI — edited in the panel, not in a config file.', 'gunicorn app.wsgi -w 3 -b :8080'],
      ['03', 'Add the worker', 'Deploy the Celery worker as a second service from the same repository.', 'celery -A app worker -l info']
    ],
    faqHeading: 'Python questions',
    faqs: [
      ['Which Python versions are available?', 'Python 3.10 through 3.13. Declare it in pyproject.toml, a runtime.txt or your Dockerfile and the build follows it.'],
      ['Do you support Poetry and uv?', 'Yes — pip, Poetry, uv and pipenv lockfiles are all handled. If your setup is unusual, a Dockerfile always works.'],
      ['How do I run Django migrations?', 'As part of the release step, so a failed migration fails the deploy and the previous release stays live.'],
      ['Can I run Celery beat as well as workers?', 'Yes. Run beat as its own small service, or use scheduled jobs if you prefer the platform to own the timing.'],
      ['Is there a GPU option for AI workloads?', 'Not currently. CPU inference and API-based model calls are well supported; GPU hosting is not something we offer today.']
    ],
    ctaHeading: 'Put one Python service on it.',
    ctaBody: 'Deploy a web service and a worker from the same repository, and see how the fixed monthly price compares.'
  },

  docker: {
    key: 'docker', label: 'Docker hosting', slug: '/docker-hosting.html',
    title: 'Docker container hosting in the EU — DebutDeploy',
    desc: 'Deploy your Dockerfile on EU infrastructure with managed registry, TLS, health checks, persistent volumes and rollbacks. Fixed monthly pricing, 20 TB transfer included.',
    eyebrow: 'Docker hosting',
    headline: 'Your Dockerfile, built and run for you.',
    intro: 'If it builds locally, it deploys here. Bring your own image definition and let the platform handle registry, placement, TLS, health checks, restarts and rollbacks.',
    primaryCta: 'Deploy a container',
    trustLine: 'Dockerfile builds · multi-stage · private base images · persistent volumes · isolated containers',
    codeTitle: 'Build from your Dockerfile',
    codeLines: [
      '==> Dockerfile found at ./Dockerfile',
      '==> Stage 1/2: builder · installing deps',
      '==> Stage 2/2: runtime · copying artefacts',
      '==> Image built: 182 MB',
      '==> Pushing to EU registry',
      '==> Starting container · 2 vCPU / 4 GB',
      '==> Health check /health → 200 OK',
      '==> Live · previous image retained'
    ],
    specs: [
      ['Build source', 'Dockerfile in your repo'],
      ['Registry', 'EU-hosted, ours'],
      ['Isolation', 'one container per service'],
      ['Volumes', 'persistent disks supported']
    ],
    includedHeading: 'What container services get',
    included: [
      ['build', 'multi-stage ok', 'Standard Docker builds', 'Multi-stage builds, build arguments and private base images work as they do in your own CI.'],
      ['isolation', 'per-service', 'Genuine isolation', 'Every service runs in its own container with its own resource boundaries; dedicated plans do not share CPU with other tenants.'],
      ['disk', 'persistent', 'Volumes', 'Attach a persistent disk where your container needs state that must outlive a deploy.'],
      ['health', 'auto-restart', 'Health and restarts', 'Failing health checks stop a bad release from taking over, and crashed containers are restarted automatically.'],
      ['network', 'private (beta)', 'Service-to-service', 'Private networking between your own services is in beta — useful for an API and worker pair that should not go via the public internet.'],
      ['egress', '20 TB included', 'Transfer included', 'Container workloads that serve media or large API responses are not metered per gigabyte.']
    ],
    pricingHeading: 'What a container costs',
    pricingBody: 'Containers are billed as the box they run on, not per image or per build. Multi-service applications are several plans; agencies and larger architectures are quoted directly.',
    priceRows: [['Pro', '2 GB RAM · 1 vCPU · shared', '$15'], ['Pro Plus', '4 GB RAM · 2 vCPU · dedicated', '$45'], ['Scale', '8 GB RAM · 4 vCPU · dedicated', '$85'], ['Custom', 'multi-service and larger boxes', 'POA']],
    priceNote: 'USD per month, ex-VAT. No per-build, per-image or registry storage charge. 20 TB transfer included on every plan.',
    quickstartHeading: 'Deploying a container',
    quickstart: [
      ['01', 'Point at the repo', 'The Dockerfile is detected; set a different path or build context if needed.', 'dockerfile: ./docker/Dockerfile'],
      ['02', 'Declare the port', 'Expose the port your process listens on and the platform routes to it.', 'EXPOSE 8080'],
      ['03', 'Add a health check', 'A health endpoint lets deploys verify themselves before taking traffic.', 'healthcheck: GET /health']
    ],
    faqHeading: 'Container questions',
    faqs: [
      ['Can I push a prebuilt image instead of building here?', 'Building from your repository is the supported path today. If you need to deploy an image from your own registry, ask us — it is handled case by case.'],
      ['Are private base images supported?', 'Yes, with registry credentials stored as encrypted environment values.'],
      ['Do you support docker-compose?', 'Not as a single file. Each service in a compose file becomes its own DebutDeploy service, which is usually a cleaner production shape anyway.'],
      ['Can containers talk to each other privately?', 'Service-to-service private networking is in beta. Say so during a migration review and we will confirm your case before you commit.'],
      ['Is there a limit on image size?', 'Nothing you are likely to hit with a sensible multi-stage build. Very large images slow deploys down rather than being rejected.']
    ],
    ctaHeading: 'Build one image and run it here.',
    ctaBody: 'If your Dockerfile builds on your machine, it will build here. Try it on a test service before moving production.'
  },

  europe: {
    key: 'europe', label: 'European PaaS', slug: '/european-paas.html',
    title: 'European PaaS with EU data residency — DebutDeploy',
    desc: 'A deployment platform that stays in the EU: compute and storage in Germany and Finland, GBP or USD billing, published DPA and subprocessor list, named UK operator.',
    eyebrow: 'European PaaS',
    headline: 'A deployment platform that stays in the EU.',
    intro: 'Compute and storage in Germany and Finland, GBP or USD billing, and a named UK operator you can actually reach. Useful when data residency is a requirement rather than a preference.',
    primaryCta: 'Deploy in the EU',
    trustLine: 'Frankfurt and Helsinki regions · EU data residency · GBP or USD billing · DPA and subprocessor list published',
    codeTitle: 'Where your workload runs',
    codeLines: [
      'region      fra1   Falkenstein, Germany',
      'region      hel1   Helsinki, Finland',
      '',
      'compute     EU only',
      'storage     EU only',
      'backups     EU only',
      '',
      'billing     GBP or USD via Stripe'
    ],
    specs: [
      ['Regions', 'fra1 (DE) · hel1 (FI)'],
      ['Data residency', 'EU compute, storage and backups'],
      ['Billing currency', 'GBP or USD'],
      ['Operator', 'Debut Web Consultants, UK']
    ],
    includedHeading: 'Why the region matters',
    included: [
      ['latency', 'fra1 · hel1', 'Close to your users', 'UK and European traffic is served from the EU rather than routed to a US region and back.'],
      ['residency', 'EU only', 'Stated data location', 'Compute, storage and backups all stay in the EU, and the region is visible on every service rather than buried in documentation.'],
      ['dpa', 'published', 'Paperwork that exists', 'A Data Processing Agreement and a subprocessor list are published, so procurement has something concrete to review.'],
      ['billing', 'GBP or USD', 'Billing in your currency', 'Pay in GBP or USD through Stripe with VAT applied at checkout according to your billing country.'],
      ['egress', '20 TB included', 'No egress trap', 'Serving European users a lot of data does not create a per-gigabyte bill at the end of the month.'],
      ['contact', 'named operator', 'Someone accountable', 'DebutDeploy is operated by Debut Web Consultants in the UK. Support comes from an engineer, not an anonymous queue.']
    ],
    pricingHeading: 'EU hosting pricing',
    pricingBody: 'The same fixed monthly plans apply in both regions — there is no European surcharge. Databases are priced separately and transfer is included.',
    priceRows: [['Hobby', '512 MB RAM · 0.5 vCPU · shared', '$5'], ['Pro', '2 GB RAM · 1 vCPU · shared', '$15'], ['Pro Plus', '4 GB RAM · 2 vCPU · dedicated', '$45'], ['Scale', '8 GB RAM · 4 vCPU · dedicated', '$85']],
    priceNote: 'USD per month, ex-VAT; GBP billing available. Same price in fra1 and hel1. Checked 24 July 2026.',
    quickstartHeading: 'Getting started in the EU',
    quickstart: [
      ['01', 'Pick a region', 'Choose Frankfurt or Helsinki when you create the service; it is shown on the service afterwards.', 'region: fra1 · Germany'],
      ['02', 'Deploy from Git', 'Connect the repository and deploy — build and image storage stay in the EU too.', 'connect github → your-org/app'],
      ['03', 'Confirm the paperwork', 'Review the DPA and subprocessor list before you put customer data on it.', 'legal → DPA · subprocessors']
    ],
    faqHeading: 'European hosting questions',
    faqs: [
      ['Where exactly are applications hosted?', 'In enterprise-grade data centres in Germany (Falkenstein) and Finland (Helsinki), inside the EU. The region is shown on every service.'],
      ['Does any data leave the EU?', 'Compute, storage and backups stay in the EU. Where a subprocessor is involved, it is named in the published subprocessor list so you can assess it yourself.'],
      ['Can I sign a DPA?', 'Yes. A Data Processing Agreement is published and can be executed as part of onboarding.'],
      ['Are you SOC 2 or ISO 27001 certified?', 'No. Security controls are designed around industry-standard practices, and we will publish certifications only once they are genuinely held rather than implied.'],
      ['Can I be billed in GBP?', 'Yes. Billing is available in GBP or USD via Stripe, with VAT applied at checkout based on your billing country.']
    ],
    ctaHeading: 'Deploy inside the EU today.',
    ctaBody: 'Test a service in Frankfurt or Helsinki, review the DPA, and decide whether the residency story holds up for your customers.'
  }
};

const LANDING_ORDER = ['postgres', 'nodejs', 'python', 'docker', 'europe'];
const LANDING_TABS = LANDING_ORDER.map(k => ({ key: k, label: LANDING[k].label, slug: LANDING[k].slug }));

function landingPage(d) {
  return `${headCss(d.title, d.desc, d.slug.slice(1))}
${header('platform')}

<main style="display: block;">
  <section style="border-bottom: 1px solid #e5e8ee; background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 84px;">
      ${tabs(LANDING_TABS, d.key)}
      <p data-fine class="mono" style="margin-top: 18px; font-size: 11.5px; color: #8b939f;">${esc(d.slug)}</p>

      <div data-hero style="margin-top: 34px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 56px; align-items: start;">
        <div>
          <p data-fine class="mono" style="font-size: 11.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #2563eb; display: flex; align-items: center; gap: 12px;"><span aria-hidden="true" style="width: 22px; height: 2px; background: #2563eb; flex: none;"></span>${esc(d.eyebrow)}</p>
          <h1 style="margin-top: 20px; font-size: 52px; line-height: 1.05; letter-spacing: -0.035em; font-weight: 800; text-wrap: balance;">${esc(d.headline)}</h1>
          <p style="margin-top: 22px; font-size: 18px; line-height: 1.6; color: #4d5661; max-width: 34em; text-wrap: pretty;">${esc(d.intro)}</p>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px;">
            <a data-cta href="${APP}" class="h-primary" style="padding: 14px 22px; min-height: 48px; display: grid; place-items: center; font-size: 15px; font-weight: 600; color: #fff; background: #2563eb; border-radius: 11px; box-shadow: 0 6px 18px -8px rgba(37,99,235,0.7);">${esc(d.primaryCta)}</a>
            <a data-cta href="#calculator" class="h-ghost" style="padding: 14px 22px; min-height: 48px; display: grid; place-items: center; font-size: 15px; font-weight: 600; color: #0b0d12; background: #fff; border: 1px solid #d8dde6; border-radius: 11px;">Compare my current bill</a>
          </div>
          <p class="mono" style="margin-top: 24px; font-size: 12px; color: #6c7480; line-height: 1.9;">${esc(d.trustLine)}</p>
        </div>

        <div style="border: 1px solid #dfe4ec; border-radius: 16px; background: #fff; overflow: hidden; box-shadow: 0 26px 54px -34px rgba(11,13,18,0.26);">
          <div data-fine class="mono" style="padding: 11px 16px; border-bottom: 1px solid #eceff4; background: #fbfcfe; font-size: 11.5px; color: #8b939f;">${esc(d.codeTitle)}</div>
          <div data-table-scroll class="mono" style="background: #0e1117; padding: 18px; font-size: 12px; line-height: 1.95; overflow-x: auto;">
            ${d.codeLines.map(c => `<div style="white-space: pre; color: #cbd5e3;">${esc(c) || '&nbsp;'}</div>`).join('\n            ')}
          </div>
          <div style="padding: 16px 18px; display: grid; gap: 10px;">
            ${d.specs.map(([l, v]) => `<div class="mono" style="display: flex; justify-content: space-between; gap: 14px; font-size: 12px;"><span style="color: #8b939f;">${esc(l)}</span><span style="color: #0b0d12; font-weight: 600; text-align: right;">${esc(v)}</span></div>`).join('\n            ')}
          </div>
        </div>
      </div>
    </div>
  </section>

  <section style="border-bottom: 1px solid #e5e8ee; background: #fff;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 88px 32px;">
      <h2 style="font-size: 36px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">${esc(d.includedHeading)}</h2>
      <div data-grid="3" style="margin-top: 32px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px;">
        ${d.included.map(([fl, fv, title, body]) => `<article style="border: 1px solid #e5e8ee; border-radius: 15px; padding: 22px; background: #fbfcfe;">
          <div data-fine class="mono" style="border: 1px solid #eceff4; border-radius: 10px; background: #fff; padding: 11px 12px; font-size: 11.5px; display: flex; justify-content: space-between; gap: 12px;"><span style="color: #9aa2ae;">${esc(fl)}</span><span style="color: #2563eb; font-weight: 600;">${esc(fv)}</span></div>
          <h3 style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; margin-top: 16px;">${esc(title)}</h3>
          <p style="margin-top: 8px; font-size: 14.5px; line-height: 1.6; color: #4d5661; text-wrap: pretty;">${esc(body)}</p>
        </article>`).join('\n        ')}
      </div>
    </div>
  </section>

  <section style="border-bottom: 1px solid #e5e8ee; background: #f7f9fc;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 88px 32px;">
      <div data-2col style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; align-items: start;">
        <div>
          <h2 style="font-size: 34px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">${esc(d.pricingHeading)}</h2>
          <p style="margin-top: 14px; font-size: 16.5px; line-height: 1.6; color: #4d5661; text-wrap: pretty;">${esc(d.pricingBody)}</p>
          <a data-tap href="/#pricing" style="display: inline-block; margin-top: 20px; font-size: 14.5px; font-weight: 600;">See all plans and what is included →</a>
        </div>
        <div style="border: 1px solid #e5e8ee; border-radius: 16px; background: #fff; overflow: hidden;">
          ${d.priceRows.map(([name, spec, price]) => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #f2f4f8;">
            <span><span style="display: block; font-size: 15px; font-weight: 700;">${esc(name)}</span><span data-fine class="mono" style="display: block; font-size: 11.5px; color: #8b939f; margin-top: 4px;">${esc(spec)}</span></span>
            <span style="text-align: right; white-space: nowrap;"><span style="font-size: 21px; font-weight: 800; letter-spacing: -0.03em;">${esc(price)}</span> <span data-fine class="mono" style="font-size: 11px; color: #8b939f;">/mo</span></span>
          </div>`).join('\n          ')}
          <p data-fine class="mono" style="padding: 14px 20px; font-size: 11px; color: #8b939f; line-height: 1.8;">${esc(d.priceNote)}</p>
        </div>
      </div>
    </div>
  </section>

  <section style="border-bottom: 1px solid #e5e8ee; background: #fff;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 88px 32px;">
      <h2 style="font-size: 36px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">${esc(d.quickstartHeading)}</h2>
      <div data-grid="3" style="margin-top: 32px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px;">
        ${d.quickstart.map(([num, title, body, code]) => `<article style="border: 1px solid #e5e8ee; border-radius: 15px; padding: 22px; background: #fbfcfe;">
          <span data-fine class="mono" style="font-size: 11px; font-weight: 600; color: #2563eb;">${num}</span>
          <h3 style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; margin-top: 11px;">${esc(title)}</h3>
          <p style="margin-top: 8px; font-size: 14px; line-height: 1.6; color: #4d5661; text-wrap: pretty;">${esc(body)}</p>
          <p data-fine data-table-scroll class="mono" style="margin-top: 14px; padding: 10px 12px; border-radius: 9px; background: #0e1117; color: #cbd5e3; font-size: 11.5px; overflow-x: auto; white-space: pre;">${esc(code)}</p>
        </article>`).join('\n        ')}
      </div>
    </div>
  </section>
${calculator()}
  <section style="border-bottom: 1px solid #e5e8ee; background: #f7f9fc;">
    <div data-wrap style="max-width: 1000px; margin: 0 auto; padding: 88px 32px;">
      <h2 style="font-size: 36px; line-height: 1.12; letter-spacing: -0.03em; font-weight: 800;">${esc(d.faqHeading)}</h2>
      ${accordion(d.faqs)}
      <p style="margin-top: 22px; font-size: 14.5px; color: #4d5661;">More operational detail is on the <a href="/faq.html" style="font-weight: 600;">full FAQ page</a>.</p>
    </div>
  </section>
${ctaBlock(d.ctaHeading, d.ctaBody)}
${pageClose('')}`;
}

/* ----------------------------------------------------------------- FAQ page */

const FAQ_GROUPS = [
  { id: 'platform', label: 'The platform', items: [
    ['What is DebutDeploy?', 'A European application deployment platform. Connect a Git repository and DebutDeploy builds it, runs it in an isolated container, issues TLS, and gives you logs, metrics, health checks, rollbacks and managed Postgres — at a fixed monthly price per service.'],
    ['How is DebutDeploy different from Render?', 'The workflow is deliberately similar; the commercial model is not. Transfer is 20 TB included rather than metered, team seats are free rather than per-user, and equivalent compute is 29–51% cheaper depending on plan. Compute runs in Germany and Finland only.'],
    ['How is DebutDeploy different from Railway?', 'Railway meters vCPU, memory and egress by usage, so the monthly figure is only knowable afterwards. DebutDeploy sells a fixed box: you choose CPU and memory and pay the same amount every month.'],
    ['Where are applications hosted?', 'In enterprise-grade data centres in Falkenstein, Germany (fra1) and Helsinki, Finland (hel1), inside the EU. The region is shown on every service.'],
    ['Is DebutDeploy built on another infrastructure provider?', 'Yes — DebutDeploy is a control panel and orchestration layer on top of leased enterprise European infrastructure, rather than data centres we own. That is how the pricing works, and the current subprocessors are named in the published subprocessor list.'],
    ['Who owns and operates DebutDeploy?', 'It is operated by Debut Web Consultants, a UK company, and it runs the products that company builds and operates. Full registered company details are in the site footer.']
  ] },
  { id: 'runtime', label: 'Applications and runtimes', items: [
    ['Is my application isolated from other customers?', 'Yes. Every application and database runs in its own container with its own resource boundaries. Plans at 2 vCPU and above run on dedicated CPU that is not shared with other tenants.'],
    ['Does DebutDeploy support Docker?', 'Yes. Deploy from a Dockerfile in your repository, including multi-stage builds and private base images.'],
    ['Which programming languages are supported?', 'Node.js, Python, Go, Ruby, PHP and static frameworks are detected and built automatically. Anything else deploys via a Dockerfile.'],
    ['Are background workers supported?', 'Yes, as their own always-resident services with their own CPU and memory. They do not sleep between jobs.'],
    ['Are scheduled jobs supported?', 'Yes. Jobs run on a cron expression per service, with output in the same log view as your deploys.'],
    ['Does DebutDeploy support custom domains, and is SSL included?', 'Unlimited custom domains, with TLS certificates issued and renewed automatically via Traefik. There is no charge for certificates and no plaintext endpoints.'],
    ['Are preview environments available?', 'Not yet. Preview environments per pull request are planned and are not available today — if that is central to your workflow, it is a genuine gap.']
  ] },
  { id: 'data', label: 'Databases and data', items: [
    ['Is managed Postgres available?', 'Yes. PostgreSQL 16 instances from $5/mo, provisioned in the same panel, with the connection string injected into your service as an encrypted environment variable.'],
    ['How often are databases backed up?', 'Nightly, at 03:00 UTC.'],
    ['How long are backups retained?', 'Seven days by default. Longer retention and point-in-time recovery are available on request rather than as a published plan feature.'],
    ['Can I export my application and database?', 'Yes. Your code stays in your own Git repository and you can take a full pg_dump of any managed database at any time. There is no proprietary layer to unpick if you leave.'],
    ['Is persistent storage available?', 'Yes. Persistent disks can be attached to services that need state which outlives a deploy.']
  ] },
  { id: 'pricing', label: 'Pricing, transfer and billing', items: [
    ['What does the included transfer allowance cover?', '20 TB of outbound transfer per month on every plan — HTTP responses, API traffic and media delivery all count against the same allowance.'],
    ['What happens if I exceed the transfer allowance?', 'We contact you to agree a plan. There is no automatic overage charge applied to your card.'],
    ['Are there egress fees?', 'No per-GB egress fee inside the included allowance. This is the line that most often makes usage-based platforms unpredictable.'],
    ['How is billing handled?', 'Monthly via Stripe, in USD or GBP. No contract, no minimum term, cancel any time.'],
    ['Is VAT included?', 'No — prices are shown excluding VAT. VAT is applied at checkout where applicable, based on your billing country.'],
    ['Can agencies manage multiple customer applications?', 'Yes. Team members are included at no extra cost, and agency or multi-service portfolios are quoted under a Custom plan rather than forced into single-app tiers.']
  ] },
  { id: 'migration', label: 'Migration and support', items: [
    ['Can DebutDeploy migrate my existing application?', 'Yes. Assisted migration reviews your services, databases, variables, volumes, domains and workers, reproduces them here, validates the result and prepares a rollback plan before any traffic moves.'],
    ['Will migration require downtime?', 'Usually none for the cutover: we reproduce and validate the service, then move DNS. Databases with large datasets need a short agreed write-freeze window. Your existing service stays online throughout preparation.'],
    ['Can I deploy a test application before migrating?', 'Yes, and it is the recommended route. Run the same repository here alongside your current provider for a billing cycle before deciding anything.'],
    ['What support is included?', 'Email support with next-business-day response on all plans, and migration support from an engineer rather than a ticket queue. Faster response commitments are part of Custom arrangements.'],
    ['Is there an uptime SLA?', 'An SLA document is published and forms part of the terms. Any specific availability commitment beyond it — including credits and carve-outs — is agreed in writing under a Custom arrangement rather than implied.']
  ] },
  { id: 'ops', label: 'Access, API and status', items: [
    ['Is there an API?', 'Yes. Programmatic API tokens are scoped read-only or full, revocable, and enforce per-resource ownership checks.'],
    ['Where can I view platform status?', 'On the live status page at status.debutdepoly.com, which is also where incidents are published while they are being investigated.'],
    ['How is access to my account secured?', 'Sign in with GitHub or Google. Repository access uses a single read-only deploy key, requesting only the GitHub scopes needed to build and deploy.'],
    ['Are you SOC 2 or ISO 27001 certified?', 'No. Security controls are designed around industry-standard practices, and certifications will be published only once they are genuinely held.']
  ] }
];

function faqPage() {
  return `${headCss(
    'Frequently asked questions — DebutDeploy',
    'Thirty operational questions about DebutDeploy answered precisely: hosting regions, isolation, Docker, databases, backups, transfer, migration, billing, VAT, API and platform status.',
    'faq.html')}
${header('faq')}

<main style="display: block;">
  <section style="border-bottom: 1px solid #e5e8ee; background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%);">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 72px 32px;">
      <p data-fine class="mono" style="font-size: 11.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #2563eb; display: flex; align-items: center; gap: 12px;"><span aria-hidden="true" style="width: 22px; height: 2px; background: #2563eb; flex: none;"></span>Reference</p>
      <h1 style="margin-top: 20px; font-size: 50px; line-height: 1.05; letter-spacing: -0.035em; font-weight: 800; max-width: 20em;">Everything worth asking before you trust a platform with production.</h1>
      <p style="margin-top: 20px; font-size: 18px; line-height: 1.6; color: #4d5661; max-width: 40em; text-wrap: pretty;">Thirty questions, answered precisely. Where the answer is no, it says no.</p>
    </div>
  </section>

  <section style="background: #fff; border-bottom: 1px solid #e5e8ee;">
    <div data-wrap style="max-width: 1280px; margin: 0 auto; padding: 72px 32px;">
      <div data-faq-layout style="display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 48px; align-items: start;">
        <nav data-toc aria-label="Sections" style="position: sticky; top: 100px; display: grid; gap: 6px;">
          ${FAQ_GROUPS.map(g => `<a data-toc-link data-fine href="#${g.id}" class="h-menu mono" style="font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #6c7480; padding: 8px 10px; border-radius: 8px;">${esc(g.label)}</a>`).join('\n          ')}
          <div style="margin-top: 14px; border: 1px solid #d3e0ff; background: #f7f9ff; border-radius: 12px; padding: 16px;">
            <p style="font-size: 13.5px; line-height: 1.6; color: #2b323c;">Not answered here? Ask an engineer directly rather than a sales queue.</p>
            <a data-tap href="/contact.html" style="display: inline-block; margin-top: 10px; font-size: 13.5px; font-weight: 600;">Contact support →</a>
          </div>
        </nav>

        <div style="display: grid; gap: 40px;">
          ${FAQ_GROUPS.map(g => `<section id="${g.id}" style="display: block;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <h2 data-fine class="mono" style="font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #0b0d12;">${esc(g.label)}</h2>
              <span style="flex: 1; height: 1px; background: #e0e4ec;"></span>
              <span data-fine class="mono" style="font-size: 11px; color: #9aa2ae; white-space: nowrap;">${g.items.length} questions</span>
            </div>
            ${accordion(g.items, { openFirst: false, pad: '48px' })}
          </section>`).join('\n          ')}
        </div>
      </div>
    </div>
  </section>
${calculator()}
${ctaBlock('Deploy one application before moving anything important.', 'Connect a repository, test the workflow and compare the result with your current provider. No production migration required.')}
${pageClose('')}`;
}

/* ------------------------------------------------------------------- write */

const pages = [];
for (const k of COMPARE_ORDER) pages.push([COMPARE[k].slug.slice(1), comparePage(COMPARE[k])]);
for (const k of LANDING_ORDER) pages.push([LANDING[k].slug.slice(1), landingPage(LANDING[k])]);
pages.push(['faq.html', faqPage()]);

for (const [file, html] of pages) {
  writeFileSync(join(OUT, file), html, 'utf8');
  console.log('wrote www/' + file + '  (' + Math.round(html.length / 1024) + ' KB)');
}

/* Sitemap covers the generated pages plus the hand-maintained ones, with
   priority reflecting how we want them crawled. No lastmod: we would only be
   guessing at it, and a wrong date is worse than none. */
const SITEMAP = [
  ['', '1.0'],
  ...COMPARE_ORDER.map(k => [COMPARE[k].slug.slice(1), '0.9']),
  ...LANDING_ORDER.map(k => [LANDING[k].slug.slice(1), '0.9']),
  ['faq.html', '0.8'],
  ['about.html', '0.6'], ['contact.html', '0.6'], ['security.html', '0.6'],
  ['legal.html', '0.3'], ['terms.html', '0.3'], ['privacy.html', '0.3'],
  ['dpa.html', '0.3'], ['acceptable-use.html', '0.3'], ['sla.html', '0.3']
];

writeFileSync(join(OUT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP.map(([p, pr]) => `  <url><loc>${SITE}/${p}</loc><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`, 'utf8');
console.log('wrote www/sitemap.xml  (' + SITEMAP.length + ' urls)');

writeFileSync(join(OUT, 'robots.txt'),
`User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`, 'utf8');
console.log('wrote www/robots.txt');

console.log('\n' + pages.length + ' pages generated.');
