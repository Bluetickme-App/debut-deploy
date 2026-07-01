# DebutDeploy Competitive Pricing Research

> **Research date:** 2026-07-01  
> **Purpose:** Inform pricing strategy for a Render-style deploy platform running on Hetzner/Coolify.  
> **Operator:** UK-based (GBP relevant; prices shown in USD unless noted; £1 ≈ $1.27 at time of writing).

---

## 1. Compute Pricing Matrix

Instance sizes are matched to the closest published tier per provider. Where only monthly pricing is published, hourly is derived as $/730. Render, DigitalOcean, and Heroku publish monthly only; Railway and Fly.io publish per-second rates convertible to monthly.

> **Hetzner raw cost note:** Post-June-2026 price adjustment, the CX23 (2 vCPU / 4 GB) costs **€5.49/mo (€0.0088/hr)**. CX33 (4 vCPU / 8 GB) = **€8.49/mo**. CX43 (8 vCPU / 16 GB) = **€15.99/mo**. At ~1.08 USD/EUR these are ~$5.93, $9.17, $17.27/mo respectively. The older cx22/cx32/cx42 naming is superseded; cx23 is the current 2/4 GB tier.

### 1.1 Compute Pricing Table (~0.5 GB RAM tier)

| Provider | Closest tier | RAM | vCPU | $/mo | $/hr | Notes |
|---|---|---|---|---|---|---|
| **Render** | Starter | 512 MB | 0.5 | $7.00 | $0.0096 | Always-on, shared CPU |
| **Railway** | Resource-based | 512 MB | ~0.25 avg | ~$4.99 | $0.0068 | Per-second billing; Hobby plan ($5/mo min) |
| **Fly.io** | shared-cpu-1x 512MB | 512 MB | 1 shared | $3.32 | $0.0045 | Billed per-second; paused machines ~$0 |
| **Heroku** | Eco / Basic | 512 MB | shared | $5–$7 | $0.0068–$0.0096 | Eco sleeps; Basic always-on |
| **DigitalOcean AP** | Basic XXS | 512 MiB | 1 shared | $5.00 | $0.0068 | 50 GiB transfer included |
| **Vercel** | Pro (Functions) | N/A serverless | N/A | $20/seat + usage | ~$0.128/CPU-hr active | Not persistent compute; invocation model |
| **Hetzner raw** | CX23 shared ÷ ~8 tenants | 512 MB equiv | 0.25 equiv | ~$0.74 | $0.0010 | Our cost if we allocate ⅛ of a CX23 |

### 1.2 Compute Pricing Table (~1 GB RAM tier)

| Provider | Closest tier | RAM | vCPU | $/mo | $/hr | Notes |
|---|---|---|---|---|---|---|
| **Render** | Starter | 512 MB | 0.5 | $7.00 | $0.0096 | No 1 GB tier; next is Standard at 2 GB |
| **Railway** | Resource-based | 1 GB | ~0.5 avg | ~$9.99 | $0.0137 | Memory $0.0139/GB-hr + CPU $0.0278/vCPU-hr |
| **Fly.io** | shared-cpu-1x 1GB | 1 GB | 1 shared | $5.92 | $0.0081 | |
| **Heroku** | Standard-2X | 1 GB | 2x | $50.00 | $0.0685 | Significant premium for 1 GB |
| **DigitalOcean AP** | Basic XS | 1 GiB | 1 shared | $10.00 | $0.0137 | 100 GiB transfer |
| **Vercel** | Pro Functions | serverless | N/A | $20/seat base | ~$0.128/active CPU-hr | No persistent 1 GB container |
| **Hetzner raw** | ¼ of CX23 | 1 GB | 0.5 | ~$1.48 | $0.0020 | |

### 1.3 Compute Pricing Table (~2 GB RAM tier)

| Provider | Closest tier | RAM | vCPU | $/mo | $/hr | Notes |
|---|---|---|---|---|---|---|
| **Render** | Standard | 2 GB | 1 | $25.00 | $0.0342 | |
| **Railway** | Resource-based | 2 GB | 1 avg | ~$19.98 | $0.0274 | |
| **Fly.io** | shared-cpu-2x 2GB | 2 GB | 2 shared | $11.83 | $0.0162 | |
| **Heroku** | Standard-2X (1GB) → n/a | — | — | — | — | No clean 2 GB tier |
| **DigitalOcean AP** | Basic S | 2 GiB | 1 shared | $20.00 | $0.0274 | 200 GiB transfer |
| **Vercel** | N/A | serverless | N/A | — | — | |
| **Hetzner raw** | ½ of CX23 | 2 GB | 1 | ~$2.97 | $0.0041 | |

### 1.4 Compute Pricing Table (~4 GB RAM tier)

| Provider | Closest tier | RAM | vCPU | $/mo | $/hr | Notes |
|---|---|---|---|---|---|---|
| **Render** | Pro | 4 GB | 2 | $85.00 | $0.1164 | Big jump from Standard |
| **Railway** | Resource-based | 4 GB | 2 avg | ~$39.96 | $0.0547 | |
| **Fly.io** | shared-cpu-4x 4GB | 4 GB | 4 shared | $23.66 | $0.0324 | |
| **Heroku** | Performance-M (2.5GB) | 2.5 GB | 12x | $250.00 | $0.3425 | Wildly overpriced for RAM; no 4GB tier |
| **DigitalOcean AP** | Basic M / Pro M | 4 GiB | 2 shared | $40–$50 | $0.0548–$0.0685 | |
| **Vercel** | N/A | serverless | N/A | — | — | |
| **Hetzner raw** | Full CX23 | 4 GB | 2 | $5.93 | $0.0088 | **Our baseline box** |

### 1.5 Compute Pricing Table (~8 GB RAM tier)

| Provider | Closest tier | RAM | vCPU | $/mo | $/hr | Notes |
|---|---|---|---|---|---|---|
| **Render** | Pro Plus | 8 GB | 4 | $175.00 | $0.2397 | |
| **Railway** | Resource-based | 8 GB | 4 avg | ~$79.92 | $0.1095 | |
| **Fly.io** | shared-cpu-8x 8GB | 8 GB | 8 shared | $47.32 | $0.0648 | |
| **Heroku** | — | — | — | — | — | Heroku Performance-M only 2.5GB; -L is 14GB at $500 |
| **DigitalOcean AP** | Pro L (dedicated) | 8 GiB | 2 dedicated | $150.00 | $0.2055 | Dedicated CPU |
| **Vercel** | N/A | serverless | N/A | — | — | |
| **Hetzner raw** | CX33 | 8 GB | 4 | $9.17 | $0.0117 | |

---

## 2. Managed PostgreSQL Pricing Matrix

### 2.1 Entry Tier (~1 GB RAM, small storage)

| Provider | Plan | RAM | Storage | $/mo | Notes |
|---|---|---|---|---|---|
| **Render** | Basic-1gb | 1 GB | ~16 GB | $19–$20 | +$0.30/GB/mo storage |
| **Railway** | Resource-based | 1 GB | per-GB billing | ~$10–$15 | Same compute rates as services; $0.15/GB/mo disk |
| **Fly.io** | Basic | 1 GB | $0.28/GB/mo | $38.00 | HA included |
| **Heroku** | Essential-2 | shared | 32 GB | $20.00 | Shared compute, connection limits |
| **DigitalOcean** | 1 GiB single node | 1 GiB | 10 GiB base | $15.15 | +$0.215/GiB overage |
| **Hetzner raw** | Coolify Postgres container on CX23 | up to 4 GB | per-volume | ~$1–$2 | Volume ~€0.05/GB/mo; marginal cost on shared box |

### 2.2 Mid Tier (~4–8 GB RAM)

| Provider | Plan | RAM | Storage | $/mo | Notes |
|---|---|---|---|---|---|
| **Render** | Standard / Pro-4gb | 4 GB | 96 GB | $75–$95 | Significant storage included |
| **Railway** | Resource-based | 4 GB | per-GB | ~$40 | No managed Postgres HA; DIY |
| **Fly.io** | Starter | 2 GB | $0.28/GB/mo | $72.00 | HA; Launch (8GB) = $282/mo |
| **Heroku** | Standard-0 | 4 GB | 64 GB | $50.00 | No HA; Standard-2 (8GB) = $200/mo |
| **DigitalOcean** | 4 GiB single node | 4 GiB | 60 GiB base | $60.90 | HA (standby) adds ~$60.90 more |
| **Hetzner raw** | Coolify Postgres on CX33 | 8 GB | per-volume | ~$9–$11 | Separate CX33 box + volumes |

---

## 3. Key Findings

- **Render is the most overpriced at the 4 GB compute tier**: $85/mo vs Hetzner raw ~$5.93 — that is a **~14× multiple**. Even the 2 GB Standard at $25/mo is ~8× the Hetzner raw cost. This is the most striking number in the dataset.

- **Competitors bundle little to justify premiums**: Render, Heroku, and DigitalOcean AP include some egress/transfer allowance (Render's is generous at 100 GB free per service), but none include autoscaling in base plans without surcharges. Heroku's autoscaling requires Standard+ dyno types. Fly.io and Railway charge for actual usage, making cost unpredictable at scale.

- **Free tier gotchas are severe**: Render free web services sleep after 15 minutes of inactivity, with a ~30-second cold-start penalty. Render free Postgres is hard-deleted after 30 days with no grace period. Railway's free tier is a one-time $5 credit only; there is no ongoing free compute. Heroku's Eco dynos sleep when quota is exhausted.

- **Egress fees are the hidden multiplier**: Railway charges $0.05/GB egress. DigitalOcean charges $0.02/GiB beyond plan allowance. Fly.io charges $0.02/GB outbound. Vercel charges $0.15/GB over 1 TB. These compound significantly for data-heavy apps. Hetzner includes 20 TB/mo traffic on CX23 — effectively free for almost all workloads.

- **Vercel is not a fair comparison for persistent compute**: Its model is invocation/function-based (Fluid Compute), not a persistent container. $0.128/active CPU-hr sounds cheap but a continuously running service at 1 vCPU would cost ~$93/mo in active CPU charges alone, plus $20/seat plan fee. It is designed for Next.js/edge use-cases, not long-running API servers.

- **Railway is the best-value managed competitor** for mid-tier compute (resource-based billing at ~$0.0139/GB-hr RAM + $0.0278/vCPU-hr CPU), but its Postgres is not fully managed (no HA, manual backups). For a true apples-to-apples managed Postgres comparison, Fly.io's $38/mo Basic is the cheapest managed HA Postgres on the market — but that is still ~20× our Hetzner-based Coolify cost.

---

## 4. Proposed DebutDeploy Pricing

### Philosophy
- Target **30–50% cheaper than Render** at equivalent RAM (the market leader and price anchor).
- Show the **margin over Hetzner raw cost** explicitly.
- Assume one customer app per CX23 box at the solo tier; shared hosting model at Starter (8 tenants/box); dedicated box at Pro+.
- Hetzner volumes: €0.05/GB/mo ≈ $0.054/GB/mo (negligible). 20 TB/mo included traffic — no egress surcharges for DebutDeploy customers at typical scale.

### 4.1 Compute Plans

| Plan | RAM | vCPU | Our $/mo | Our $/hr | Hetzner raw cost/mo | Margin | Render equiv | Discount vs Render |
|---|---|---|---|---|---|---|---|---|
| **Hobby** | 512 MB | 0.5 shared | **$5** | $0.0068 | ~$0.74 (⅛ CX23) | ~$4.26 (575%) | Starter $7 | 29% cheaper |
| **Starter** | 1 GB | 0.5 shared | **$9** | $0.0123 | ~$1.48 (¼ CX23) | ~$7.52 (508%) | — ($7 starter is 512MB) | — |
| **Pro** | 2 GB | 1 shared | **$15** | $0.0205 | ~$2.97 (½ CX23) | ~$12.03 (405%) | Standard $25 | 40% cheaper |
| **Pro Plus** | 4 GB | 2 dedicated | **$45** | $0.0616 | ~$5.93 (1× CX23) | ~$39.07 (659%) | Pro $85 | 47% cheaper |
| **Scale** | 8 GB | 4 dedicated | **$85** | $0.1164 | ~$9.17 (1× CX33) | ~$75.83 (827%) | Pro Plus $175 | 51% cheaper |

> **ponytail:** Hobby/Starter share a CX23 (8-way for Hobby, 4-way for Starter). Pro uses a half-box. Pro Plus and Scale get a dedicated box each. Coolify handles the container isolation. Margin at Pro Plus is very healthy; Hobby margin looks thin in raw numbers but is fine with 8-way sharing.

**GBP equivalents** (÷1.27): Hobby £3.94/mo, Starter £7.09, Pro £11.81, Pro Plus £35.43, Scale £66.93.

### 4.2 Managed PostgreSQL Add-On

| Plan | RAM | Storage incl. | $/mo | Hetzner raw cost | Margin | Render equiv | Discount |
|---|---|---|---|---|---|---|---|
| **DB Hobby** | 256 MB (shared) | 2 GB | **$5** | ~$0.50 | ~$4.50 | Basic-256mb $6 | 17% |
| **DB Starter** | 1 GB | 10 GB | **$12** | ~$2 | ~$10 | Basic-1gb $19–$20 | 37% |
| **DB Pro** | 4 GB | 50 GB | **$45** | ~$8–$10 | ~$35–$37 | Standard/Pro-4gb $75–$95 | 40–53% |
| **DB Scale** | 8 GB | 100 GB | **$90** | ~$14–$16 | ~$74–$76 | Pro-8gb $100–$185 | 10–51% |

> Storage overage: $0.10/GB/mo (our cost ~$0.054, so 85% margin on overage).

### 4.3 Suggested Plan Bundles

| Bundle | Includes | $/mo | Notes |
|---|---|---|---|
| **Indie** | 1× Pro compute + DB Starter | $27 | Full-stack solo developer; replaces Render $45/mo combo |
| **Growth** | 3× Pro compute + DB Pro | $90 | Small team; Render equiv ~$170/mo |
| **Team** | 5× Pro Plus compute + DB Pro | $270 | Render equiv ~$520/mo |

### 4.4 Positioning

> **"Same app. Half the price. Your hardware."**

Secondary: *"Render pricing without the Render bill. Powered by Hetzner — the most price-efficient datacenter in Europe."*

For UK market: *"Deploy like Render, pay like Hetzner. From £4/mo."*

---

## 5. Sources & Confidence

| Source | URL | Accessed | Confidence |
|---|---|---|---|
| Render pricing (compute tiers) | https://render.com/pricing | 2026-07-01 | High — cross-verified via kuberns.com and servercompass.app |
| Render Postgres tiers | https://render.com/docs/postgresql-refresh | 2026-07-01 | Medium — instance type names confirmed; exact prices slightly vary across third-party sources; $7–$20–$75–$95 range used |
| Railway resource rates | https://www.srvrlss.io/provider/railway/ | 2026-07-01 | High — $0.00000386/GB-s and $0.00000772/vCPU-s confirmed by docs.railway.com |
| Fly.io machine prices | https://fly.io/docs/about/pricing/ | 2026-07-01 | High — direct from Fly.io docs |
| Fly.io Managed Postgres | https://fly.io/mpg/ | 2026-07-01 | High — direct from Fly.io |
| Heroku dyno & Postgres | https://www.heroku.com/pricing/ | 2026-07-01 | High — direct from Heroku |
| DigitalOcean App Platform | https://docs.digitalocean.com/products/app-platform/details/pricing/ | 2026-07-01 | High — direct from DO docs |
| DigitalOcean Managed Postgres | https://www.digitalocean.com/pricing/managed-databases | 2026-07-01 | High — direct from DO |
| Vercel pricing | https://vercel.com/pricing | 2026-07-01 | High — direct from Vercel |
| Hetzner cx-line (pre-adjustment) | https://kuberns.com/blogs/hetzner-cloud-pricing/ | 2026-07-01 | Medium — third-party; cx22 ~€3.79/mo |
| Hetzner June 2026 adjustment | https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ | 2026-07-01 | High — official Hetzner docs; cx23 now €5.49/mo, cx33 €8.49/mo, cx43 €15.99/mo |

### Caveats

- **Render Postgres pricing has two versions in circulation** (one source shows Basic-1gb at $19, another at $20; Standard at $75 vs $95). We use $19/$75 as the lower bound for honest comparisons.
- **Railway compute** is usage-based so monthly cost depends on actual consumption. The $0.0139/GB-hr + $0.0278/vCPU-hr rates are verified; sample costs assume 24/7 uptime.
- **Vercel** is excluded from the compute matrix for persistent workloads — it is structurally a different product (edge functions, not containers). Included for completeness.
- **Hetzner naming change**: Old cx22/cx32/cx42 → new cx23/cx33/cx43 after June 2026 adjustment. The specs (vCPU/RAM) are the same or slightly improved; prices changed. CX23 (2 vCPU/4GB) is now **€5.49/mo**, down from the ~€6.49/mo figure previously cited.
- **Currency**: EUR/USD rate assumed 1.08; GBP/USD 1.27. These fluctuate; UK customers will want GBP pricing locked.
- **VAT**: Hetzner prices are ex-VAT. UK/EU customers pay +20% VAT on Hetzner invoices. DebutDeploy should price inclusive of its own VAT obligations.
