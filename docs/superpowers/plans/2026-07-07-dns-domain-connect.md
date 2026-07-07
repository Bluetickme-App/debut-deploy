# One-Click DNS via Domain Connect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a domain owner apply the DNS records DebutDeploy needs (business email + custom app domains) by logging into their own DNS provider and clicking "Approve" (Domain Connect sync flow), with today's manual copy-paste table as the universal fallback.

**Architecture:** A provider-agnostic Domain Connect engine (`server/domainconnect.js`) builds a signed-later/unsigned-now redirect URL from two committed record templates. A single canonical record generator per use case feeds both the one-click template params and the manual fallback, so they can't drift. Three thin Express routes drive discover → approve → verify; a small SQLite table tracks status. One shared React component surfaces it on the Email page and the service domain manager.

**Tech stack:** Node/Express (ESM), better-sqlite3, React+Vite. Tests: `node:test` + `node:assert/strict`, run with `node --test`. No new runtime dependency (Node `dns/promises`, `fetch`, `crypto`).

## Global Constraints

- ESM everywhere (`import`, not `require`).
- Never store customer DNS-provider credentials (sync flow avoids this).
- The manual fallback must work with zero external deps and be reachable on every failure path — one-click never blocks setup.
- Canonical record content lives in exactly one place per kind: `mail.js dnsRecords(domain)` (mail) and `dns.js appRecords(domain)` (hosting). The template params and the fallback both derive from these — never fork the values.
- `PROVIDER_ID = "debutdeploy.com"`; Domain Connect `serviceId` ∈ `mail` | `hosting`.
- `expectedIp` (from `COOLIFY_BASE_URL`) is assumed to be a bare IP; `appRecords` guards A→CNAME if it is ever a hostname.
- Tests use `process.env.DATABASE_FILE = ":memory:"` set BEFORE importing `db.js` (module opens the DB at import).
- v1 ships the apply URL **unsigned** (spec C5: signing off → providers that require it fall back to manual). Signing is the final task, gated behind external provider onboarding.

## File Structure

- `server/db.js` (modify) — add migration #23 (`domain_dns_setup` table) + row helpers.
- `server/dns.js` (modify) — add `appRecords(domain)` + `verifyMail(domain)`.
- `server/domainconnect.js` (create) — engine: `recordsFor`, `paramsFor`, `buildApplyUrl`, `makeState`/`readState`, `discover`, (later) `signQuery`.
- `server/templates/debutdeploy.com.mail.json`, `…hosting.json` (create) — Domain Connect templates.
- `server/index.js` (modify) — mount `/api/dns/discover`, `/api/dns/callback`, `/api/dns/status`.
- `server/*.test.js` (create) — one test file per server task.
- `client/src/lib/api.js` (modify) — `dnsDiscover`, `dnsStatus`.
- `client/src/components/DnsSetup.jsx` (create) — shared button + status + manual table.
- `client/src/pages/Email.jsx` (modify) — use `<DnsSetup kind="mail">`.
- `client/src/pages/ServiceDetail.jsx` (modify) — use `<DnsSetup kind="hosting">` in the domain manager.

---

## Task 1: `domain_dns_setup` table + row helpers

**Files:**
- Modify: `server/db.js` (append a migration to the `MIGRATIONS` array; add exported helpers near the other query helpers)
- Test: `server/dns_setup.test.js`

**Interfaces:**
- Produces:
  - `upsertDnsSetup({ orgId, domain, kind, provider, status }) → void` — orgId null is coerced to `''` so the UNIQUE constraint dedupes admin/operator rows (SQLite treats NULLs as distinct in UNIQUE).
  - `getDnsSetup(orgId, domain, kind) → row | undefined` where row = `{ org_id, domain, kind, provider, status, applied_at, verified_at }`.
  - `setDnsSetupStatus({ orgId, domain, kind, status, verified=false }) → void` — updates status; stamps `verified_at` when `verified` is true, `applied_at` when status becomes `applied`.

- [ ] **Step 1: Write the failing test**

Create `server/dns_setup.test.js`:

```js
// node --test server/dns_setup.test.js
process.env.DATABASE_FILE = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
const { upsertDnsSetup, getDnsSetup, setDnsSetupStatus } = await import("./db.js");

test("upsert creates a row, second upsert updates in place (org null coerced)", () => {
  upsertDnsSetup({ orgId: null, domain: "acme.com", kind: "mail", provider: null, status: "pending" });
  upsertDnsSetup({ orgId: null, domain: "acme.com", kind: "mail", provider: "GoDaddy", status: "applied" });
  const row = getDnsSetup(null, "acme.com", "mail");
  assert.equal(row.org_id, "");
  assert.equal(row.provider, "GoDaddy");
  assert.equal(row.status, "applied");
  assert.ok(row.applied_at, "applied_at stamped when status becomes applied");
});

test("setDnsSetupStatus verified stamps verified_at", () => {
  upsertDnsSetup({ orgId: "org1", domain: "b.com", kind: "hosting", provider: "IONOS", status: "applied" });
  setDnsSetupStatus({ orgId: "org1", domain: "b.com", kind: "hosting", status: "verified", verified: true });
  const row = getDnsSetup("org1", "b.com", "hosting");
  assert.equal(row.status, "verified");
  assert.ok(row.verified_at);
});

test("rows are keyed by (org, domain, kind) — different kind is a different row", () => {
  upsertDnsSetup({ orgId: "org1", domain: "c.com", kind: "mail", provider: null, status: "manual" });
  upsertDnsSetup({ orgId: "org1", domain: "c.com", kind: "hosting", provider: null, status: "pending" });
  assert.equal(getDnsSetup("org1", "c.com", "mail").status, "manual");
  assert.equal(getDnsSetup("org1", "c.com", "hosting").status, "pending");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/dns_setup.test.js`
Expected: FAIL — `upsertDnsSetup is not a function` (not yet exported).

- [ ] **Step 3: Add the migration**

In `server/db.js`, append a new function to the end of the `MIGRATIONS` array (it becomes user_version 23):

```js
  // -> user_version 23: one-click DNS (Domain Connect) setup status per (org, domain, kind)
  (d) => {
    d.exec(`
      CREATE TABLE domain_dns_setup (
        id INTEGER PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('mail','hosting')),
        provider TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','manual','applied','verified','failed')),
        applied_at TEXT,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(org_id, domain, kind)
      );
    `);
  },
```

- [ ] **Step 4: Add the row helpers**

In `server/db.js`, after the existing exported query helpers (e.g. near `getSetting`/`setSetting`), add:

```js
// ── One-click DNS (Domain Connect) setup status ────────────────────────────────
export function upsertDnsSetup({ orgId, domain, kind, provider = null, status }) {
  const org = orgId ?? "";
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO domain_dns_setup (org_id, domain, kind, provider, status, applied_at, created_at)
    VALUES (@org, @domain, @kind, @provider, @status, @applied, @now)
    ON CONFLICT(org_id, domain, kind) DO UPDATE SET
      provider = excluded.provider,
      status = excluded.status,
      applied_at = COALESCE(excluded.applied_at, domain_dns_setup.applied_at)
  `).run({ org, domain, kind, provider, status, now, applied: status === "applied" ? now : null });
}

export function getDnsSetup(orgId, domain, kind) {
  return db.prepare(
    "SELECT * FROM domain_dns_setup WHERE org_id = ? AND domain = ? AND kind = ?"
  ).get(orgId ?? "", domain, kind);
}

export function setDnsSetupStatus({ orgId, domain, kind, status, verified = false }) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE domain_dns_setup
       SET status = @status,
           applied_at = CASE WHEN @status = 'applied' AND applied_at IS NULL THEN @now ELSE applied_at END,
           verified_at = CASE WHEN @verified = 1 THEN @now ELSE verified_at END
     WHERE org_id = @org AND domain = @domain AND kind = @kind
  `).run({ org: orgId ?? "", domain, kind, status, verified: verified ? 1 : 0, now });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/dns_setup.test.js`
Expected: PASS — `# pass 3`.

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/dns_setup.test.js
git commit -m "feat(dns): domain_dns_setup table + status helpers"
```

---

## Task 2: Canonical `appRecords` + `verifyMail` in `dns.js`

**Files:**
- Modify: `server/dns.js`
- Test: `server/dns_records.test.js`

**Interfaces:**
- Consumes: `expectedIp` (existing export).
- Produces:
  - `appRecords(domain) → Array<{type,name,value,note}>` — the canonical hosting record set (same shape as `mail.js dnsRecords`).
  - `verifyMail(domain, { resolveMx } = {}) → Promise<{ domain, expectedMx, resolvedMx, pointsToMail }>` — `resolveMx` is injectable for tests; defaults to `node:dns/promises` `resolveMx`.

- [ ] **Step 1: Write the failing test**

Create `server/dns_records.test.js`:

```js
// node --test server/dns_records.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { appRecords, verifyMail, expectedIp } from "./dns.js";

test("appRecords returns apex A -> expectedIp and www CNAME -> apex", () => {
  const recs = appRecords("acme.com");
  const a = recs.find((r) => r.type === "A");
  const cname = recs.find((r) => r.type === "CNAME");
  assert.equal(a.name, "acme.com");
  assert.equal(a.value, expectedIp);
  assert.equal(cname.name, "www.acme.com");
  assert.equal(cname.value, "acme.com");
});

test("verifyMail reports pointsToMail true when MX resolves to the mail host", async () => {
  const resolveMx = async () => [{ exchange: "mail.debutdepoly.com", priority: 10 }];
  const r = await verifyMail("acme.com", { resolveMx });
  assert.equal(r.pointsToMail, true);
  assert.deepEqual(r.resolvedMx, ["mail.debutdepoly.com"]);
});

test("verifyMail tolerates a domain with no MX yet (pointsToMail false)", async () => {
  const resolveMx = async () => { const e = new Error("not found"); e.code = "ENOTFOUND"; throw e; };
  const r = await verifyMail("acme.com", { resolveMx });
  assert.equal(r.pointsToMail, false);
  assert.deepEqual(r.resolvedMx, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/dns_records.test.js`
Expected: FAIL — `appRecords is not a function`.

- [ ] **Step 3: Implement in `server/dns.js`**

Add to the top import and new exports:

```js
import { resolve4, resolveMx as _resolveMx } from "node:dns/promises";

// Canonical hosting record set for a custom app domain. `expectedIp` is a bare IP
// in this deployment; if it ever becomes a hostname, emit a CNAME apex instead.
export function appRecords(domain) {
  const apexIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(expectedIp);
  return [
    apexIsIp
      ? { type: "A", name: domain, value: expectedIp, note: "Point your domain at the platform" }
      : { type: "CNAME", name: domain, value: expectedIp, note: "Point your domain at the platform" },
    { type: "CNAME", name: `www.${domain}`, value: domain, note: "www → apex" },
  ];
}

const MAIL_HOST = process.env.MAIL_HOSTNAME || "mail.debutdepoly.com";

export async function verifyMail(domain, { resolveMx = _resolveMx } = {}) {
  let resolvedMx = [];
  try {
    resolvedMx = (await resolveMx(domain)).map((m) => m.exchange);
  } catch (err) {
    const ignorable = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "ECONNREFUSED", "ETIMEOUT"]);
    if (!ignorable.has(err.code)) throw err;
  }
  return { domain, expectedMx: MAIL_HOST, resolvedMx, pointsToMail: resolvedMx.includes(MAIL_HOST) };
}
```

(Change the existing `import { resolve4 } from "node:dns/promises";` line to the combined import above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/dns_records.test.js`
Expected: PASS — `# pass 3`.

- [ ] **Step 5: Commit**

```bash
git add server/dns.js server/dns_records.test.js
git commit -m "feat(dns): canonical appRecords + verifyMail"
```

---

## Task 3: Domain Connect engine — `domainconnect.js`

**Files:**
- Create: `server/domainconnect.js`
- Test: `server/domainconnect.test.js`

**Interfaces:**
- Consumes: `mail.js dnsRecords(domain)`, `dns.js appRecords(domain)`, `dns.js expectedIp`, `process.env.SESSION_SECRET`.
- Produces:
  - `PROVIDER_ID = "debutdeploy.com"`.
  - `recordsFor(kind, domain) → Array<{type,name,value,note}>` — `mail` → `dnsRecords`, `hosting` → `appRecords`.
  - `paramsFor(kind, domain) → object` — `hosting` → `{ ip: expectedIp }`, `mail` → `{}`.
  - `makeState({ orgId, domain, kind }) → string` and `readState(token) → { orgId, domain, kind }` (throws on tamper/format).
  - `buildApplyUrl({ urlSyncUX, domain, kind, params, redirectUri, state }) → string`.
  - `discover(domain, { resolveTxt, fetchImpl } = {}) → Promise<{ supported, providerId?, providerName?, urlSyncUX? }>`.

- [ ] **Step 1: Write the failing test**

Create `server/domainconnect.test.js`:

```js
// node --test server/domainconnect.test.js
process.env.SESSION_SECRET = "test-secret";
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordsFor, paramsFor, makeState, readState, buildApplyUrl, discover, PROVIDER_ID } from "./domainconnect.js";
import { expectedIp } from "./dns.js";

test("recordsFor delegates to the canonical generators", () => {
  assert.ok(recordsFor("mail", "acme.com").some((r) => r.type === "MX"));
  assert.ok(recordsFor("hosting", "acme.com").some((r) => r.type === "A" || r.type === "CNAME"));
});

test("paramsFor hosting carries the platform ip; mail is empty", () => {
  assert.deepEqual(paramsFor("hosting", "acme.com"), { ip: expectedIp });
  assert.deepEqual(paramsFor("mail", "acme.com"), {});
});

test("state round-trips and rejects tampering", () => {
  const tok = makeState({ orgId: "org1", domain: "acme.com", kind: "mail" });
  assert.deepEqual(readState(tok), { orgId: "org1", domain: "acme.com", kind: "mail" });
  assert.throws(() => readState(tok.slice(0, -2) + "xx"), /state/);
});

test("buildApplyUrl assembles the sync-flow apply URL", () => {
  const url = buildApplyUrl({
    urlSyncUX: "https://dcc.godaddy.com/manage",
    domain: "acme.com", kind: "hosting", params: { ip: "1.2.3.4" },
    redirectUri: "https://app.debutdepoly.com/api/dns/callback", state: "ST",
  });
  assert.ok(url.startsWith(`https://dcc.godaddy.com/manage/v2/domainTemplates/providers/${PROVIDER_ID}/services/hosting/apply?`));
  const q = new URL(url).searchParams;
  assert.equal(q.get("domain"), "acme.com");
  assert.equal(q.get("ip"), "1.2.3.4");
  assert.equal(q.get("redirect_uri"), "https://app.debutdepoly.com/api/dns/callback");
  assert.equal(q.get("state"), "ST");
});

test("discover returns supported=true when TXT + settings resolve", async () => {
  const resolveTxt = async () => [["dcc.godaddy.com"]];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ providerId: "godaddy", providerName: "GoDaddy", urlSyncUX: "https://dcc.godaddy.com/manage" }) });
  const d = await discover("acme.com", { resolveTxt, fetchImpl });
  assert.equal(d.supported, true);
  assert.equal(d.providerName, "GoDaddy");
  assert.equal(d.urlSyncUX, "https://dcc.godaddy.com/manage");
});

test("discover returns supported=false when the TXT record is absent", async () => {
  const resolveTxt = async () => { const e = new Error("nx"); e.code = "ENOTFOUND"; throw e; };
  const d = await discover("acme.com", { resolveTxt });
  assert.equal(d.supported, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/domainconnect.test.js`
Expected: FAIL — cannot find module `./domainconnect.js`.

- [ ] **Step 3: Implement `server/domainconnect.js`**

```js
// Provider-agnostic Domain Connect (sync flow) engine. Builds the redirect URL a
// domain owner opens to approve DNS changes in their own DNS provider. Record
// content is never defined here — it comes from the canonical generators so the
// one-click template and the manual fallback can't drift. See the design spec.
import { resolveTxt as _resolveTxt } from "node:dns/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dnsRecords } from "./mail.js";
import { appRecords, expectedIp } from "./dns.js";

export const PROVIDER_ID = "debutdeploy.com";
const SECRET = () => process.env.SESSION_SECRET || "";

export function recordsFor(kind, domain) {
  if (kind === "mail") return dnsRecords(domain);
  if (kind === "hosting") return appRecords(domain);
  throw Object.assign(new Error(`Unknown DNS kind: ${kind}`), { status: 400 });
}

export function paramsFor(kind, domain) {
  return kind === "hosting" ? { ip: expectedIp } : {};
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) => createHmac("sha256", SECRET()).update(data).digest("base64url");

// Opaque, tamper-evident state carried through the provider round-trip.
export function makeState({ orgId, domain, kind }) {
  const payload = b64u(JSON.stringify({ orgId: orgId ?? "", domain, kind }));
  return `${payload}.${hmac(payload)}`;
}

export function readState(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) throw Object.assign(new Error("Malformed state"), { status: 400 });
  const expect = hmac(payload);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error("Bad state signature"), { status: 400 });
  const { orgId, domain, kind } = JSON.parse(Buffer.from(payload, "base64url").toString());
  return { orgId, domain, kind };
}

export function buildApplyUrl({ urlSyncUX, domain, kind, params, redirectUri, state }) {
  const base = `${urlSyncUX.replace(/\/$/, "")}/v2/domainTemplates/providers/${PROVIDER_ID}/services/${kind}/apply`;
  const q = new URLSearchParams({ domain, ...params, redirect_uri: redirectUri, state });
  return `${base}?${q.toString()}`;
}

// Query _domainconnect TXT for the provider's API host, then its settings, to learn
// urlSyncUX. Any miss (NXDOMAIN, non-2xx, malformed) → { supported:false }.
export async function discover(domain, { resolveTxt = _resolveTxt, fetchImpl = fetch } = {}) {
  let host;
  try {
    const txt = await resolveTxt(`_domainconnect.${domain}`);
    host = (Array.isArray(txt?.[0]) ? txt[0].join("") : txt?.[0]) || "";
  } catch { return { supported: false }; }
  if (!host) return { supported: false };
  try {
    const res = await fetchImpl(`https://${host}/v2/${domain}/settings`);
    if (!res.ok) return { supported: false };
    const s = await res.json();
    if (!s?.urlSyncUX) return { supported: false };
    return { supported: true, providerId: s.providerId, providerName: s.providerName, urlSyncUX: s.urlSyncUX };
  } catch { return { supported: false }; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/domainconnect.test.js`
Expected: PASS — `# pass 6`.

- [ ] **Step 5: Commit**

```bash
git add server/domainconnect.js server/domainconnect.test.js
git commit -m "feat(dns): Domain Connect sync-flow engine (discover, state, apply URL)"
```

---

## Task 4: Domain Connect templates + drift-guard test

**Files:**
- Create: `server/templates/debutdeploy.com.mail.json`, `server/templates/debutdeploy.com.hosting.json`
- Test: `server/dc_templates.test.js`

**Interfaces:**
- Consumes: `recordsFor(kind, domain)` from `domainconnect.js`.
- Produces: the two template files onboarded with providers (Task 7 / external).

- [ ] **Step 1: Write the failing test**

Create `server/dc_templates.test.js`. It normalizes each template's records to the canonical `{type,name,value}` shape (with a sample domain + ip substituted) and asserts it equals `recordsFor`, so the committed template can never drift from the generator.

```js
// node --test server/dc_templates.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { recordsFor } from "./domainconnect.js";
import { expectedIp } from "./dns.js";

const DOMAIN = "acme.com";

// Map a Domain Connect template record to our canonical shape.
function norm(rec) {
  const name = rec.host === "@" ? DOMAIN : `${rec.host}.${DOMAIN}`;
  let value;
  if (rec.type === "MX") value = `${rec.priority} ${rec.pointsTo}`;
  else if (rec.type === "CNAME") value = rec.pointsTo === "@" ? DOMAIN : rec.pointsTo;
  else value = rec.data ?? rec.pointsTo;
  value = value.replaceAll("%domain%", DOMAIN).replaceAll("%ip%", expectedIp);
  return { type: rec.type, name, value };
}

const strip = (recs) => recs.map((r) => ({ type: r.type, name: r.name, value: r.value }))
  .sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));

for (const [kind, file] of [["mail", "./templates/debutdeploy.com.mail.json"], ["hosting", "./templates/debutdeploy.com.hosting.json"]]) {
  test(`${kind} template matches recordsFor (no drift)`, async () => {
    const tpl = JSON.parse(await readFile(new URL(file, import.meta.url)));
    assert.equal(tpl.providerId, "debutdeploy.com");
    assert.equal(tpl.serviceId, kind);
    assert.deepEqual(strip(tpl.records.map(norm)), strip(recordsFor(kind, DOMAIN)));
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/dc_templates.test.js`
Expected: FAIL — cannot open `./templates/debutdeploy.com.mail.json`.

- [ ] **Step 3: Create `server/templates/debutdeploy.com.mail.json`**

```json
{
  "providerId": "debutdeploy.com",
  "providerName": "DebutDeploy",
  "serviceId": "mail",
  "serviceName": "DebutDeploy Email",
  "syncBlock": false,
  "records": [
    { "type": "MX", "host": "@", "pointsTo": "mail.debutdepoly.com", "priority": 10, "ttl": 3600 },
    { "type": "TXT", "host": "@", "data": "v=spf1 include:amazonses.com ~all", "ttl": 3600 },
    { "type": "TXT", "host": "_dmarc", "data": "v=DMARC1; p=quarantine; rua=mailto:postmaster@%domain%", "ttl": 3600 },
    { "type": "CNAME", "host": "autoconfig", "pointsTo": "mail.debutdepoly.com", "ttl": 3600 },
    { "type": "CNAME", "host": "autodiscover", "pointsTo": "mail.debutdepoly.com", "ttl": 3600 }
  ]
}
```

- [ ] **Step 4: Create `server/templates/debutdeploy.com.hosting.json`**

```json
{
  "providerId": "debutdeploy.com",
  "providerName": "DebutDeploy",
  "serviceId": "hosting",
  "serviceName": "DebutDeploy Hosting",
  "syncBlock": false,
  "records": [
    { "type": "A", "host": "@", "pointsTo": "%ip%", "ttl": 3600 },
    { "type": "CNAME", "host": "www", "pointsTo": "@", "ttl": 3600 }
  ]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/dc_templates.test.js`
Expected: PASS — `# pass 2`. If it fails on a value mismatch, fix the TEMPLATE to match the generator (the generator is canonical), not the reverse.

- [ ] **Step 6: Commit**

```bash
git add server/templates/ server/dc_templates.test.js
git commit -m "feat(dns): Domain Connect mail + hosting templates (drift-guarded)"
```

---

## Task 5: Server routes — discover / callback / status

**Files:**
- Modify: `server/index.js` (add imports near the other `import * as` lines ~L76–89; add routes after the mail routes block that ends ~L914)
- Test: `server/dns_routes.test.js` (unit-level: exercise the callback status transition via the exported helper, since the repo has no HTTP test harness)

**Interfaces:**
- Consumes: `domainconnect.discover/buildApplyUrl/makeState/readState/recordsFor/paramsFor`, `db` helpers from Task 1, `dns.verifyDomain/verifyMail`.
- Produces three routes (all `requireAuth`; `req.org` is `{id,role}` for customers, `null` for admins — store `req.org?.id ?? null` as the org):
  - `GET /api/dns/discover?domain=&kind=` → `{ supported, provider, applyUrl?, records }`.
  - `GET /api/dns/callback?state=&...` → 302 back to the panel.
  - `GET /api/dns/status?domain=&kind=` → `{ status, provider, verified }`.

- [ ] **Step 1: Write the failing test**

Create `server/dns_routes.test.js`. Factor the callback's verify-and-persist logic into a pure-ish exported helper `applyCallbackResult` in `domainconnect.js` so it is testable without HTTP:

```js
// node --test server/dns_routes.test.js
process.env.DATABASE_FILE = ":memory:";
process.env.SESSION_SECRET = "test-secret";
import { test } from "node:test";
import assert from "node:assert/strict";
const { applyCallbackResult } = await import("./domainconnect.js");
const { getDnsSetup, upsertDnsSetup } = await import("./db.js");

test("applyCallbackResult error param marks the row failed", async () => {
  upsertDnsSetup({ orgId: "o1", domain: "acme.com", kind: "mail", provider: "GoDaddy", status: "pending" });
  await applyCallbackResult({ orgId: "o1", domain: "acme.com", kind: "mail", error: "access_denied", verify: async () => true });
  assert.equal(getDnsSetup("o1", "acme.com", "mail").status, "failed");
});

test("applyCallbackResult success verifies and marks verified", async () => {
  upsertDnsSetup({ orgId: "o1", domain: "b.com", kind: "hosting", provider: "IONOS", status: "pending" });
  await applyCallbackResult({ orgId: "o1", domain: "b.com", kind: "hosting", error: null, verify: async () => true });
  const row = getDnsSetup("o1", "b.com", "hosting");
  assert.equal(row.status, "verified");
  assert.ok(row.verified_at);
});

test("applyCallbackResult success but not-yet-propagated stays applied", async () => {
  upsertDnsSetup({ orgId: "o1", domain: "c.com", kind: "mail", provider: "GoDaddy", status: "pending" });
  await applyCallbackResult({ orgId: "o1", domain: "c.com", kind: "mail", error: null, verify: async () => false });
  assert.equal(getDnsSetup("o1", "c.com", "mail").status, "applied");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/dns_routes.test.js`
Expected: FAIL — `applyCallbackResult is not a function`.

- [ ] **Step 3: Add `applyCallbackResult` to `domainconnect.js`**

Append to `server/domainconnect.js`:

```js
import { setDnsSetupStatus } from "./db.js";

// Resolve a provider redirect into a persisted status. `verify` returns whether the
// records are already live (so we can jump applied → verified without waiting).
export async function applyCallbackResult({ orgId, domain, kind, error, verify }) {
  if (error) { setDnsSetupStatus({ orgId, domain, kind, status: "failed" }); return "failed"; }
  setDnsSetupStatus({ orgId, domain, kind, status: "applied" });
  const live = await verify().catch(() => false);
  if (live) { setDnsSetupStatus({ orgId, domain, kind, status: "verified", verified: true }); return "verified"; }
  return "applied";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/dns_routes.test.js`
Expected: PASS — `# pass 3`.

- [ ] **Step 5: Wire the routes in `server/index.js`**

Add imports alongside the existing ones (near L76–89):

```js
import * as domainconnect from "./domainconnect.js";
import { upsertDnsSetup, getDnsSetup } from "./db.js";
```

After the mail routes block (the `DELETE /api/mail/mailboxes/:address` handler, ~L914), add:

```js
// ── One-click DNS (Domain Connect) ─────────────────────────────────────────────
const DNS_KINDS = new Set(["mail", "hosting"]);
const publicBase = () => (process.env.OAUTH_CALLBACK_BASE || "").replace(/\/$/, "");

function verifyByKind(kind, domain) {
  return kind === "mail"
    ? dns.verifyMail(domain).then((r) => r.pointsToMail)
    : dns.verifyDomain(domain).then((r) => r.pointsToServer);
}

app.get("/api/dns/discover", requireAuth, h(async (req) => {
  const domain = String(req.query.domain || "").trim().toLowerCase();
  const kind = String(req.query.kind || "");
  if (!DNS_KINDS.has(kind) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    throw Object.assign(new Error("A valid domain and kind are required"), { status: 400 });
  const orgId = req.org?.id ?? null;
  const records = domainconnect.recordsFor(kind, domain);
  const d = await domainconnect.discover(domain);
  if (!d.supported) {
    upsertDnsSetup({ orgId, domain, kind, provider: null, status: "manual" });
    return { supported: false, provider: null, records };
  }
  const state = domainconnect.makeState({ orgId, domain, kind });
  const applyUrl = domainconnect.buildApplyUrl({
    urlSyncUX: d.urlSyncUX, domain, kind,
    params: domainconnect.paramsFor(kind, domain),
    redirectUri: `${publicBase()}/api/dns/callback`, state,
  });
  upsertDnsSetup({ orgId, domain, kind, provider: d.providerName || d.providerId, status: "pending" });
  return { supported: true, provider: d.providerName || d.providerId, applyUrl, records };
}));

app.get("/api/dns/callback", h(async (req, res) => {
  let s;
  try { s = domainconnect.readState(req.query.state); }
  catch { return res.redirect(`${publicBase()}/email?dns=error`); }
  await domainconnect.applyCallbackResult({
    orgId: s.orgId || null, domain: s.domain, kind: s.kind,
    error: req.query.error || null,
    verify: () => verifyByKind(s.kind, s.domain),
  });
  const back = s.kind === "mail" ? "/email" : "/services";
  return res.redirect(`${publicBase()}${back}?dns=${req.query.error ? "error" : "ok"}`);
}));

app.get("/api/dns/status", requireAuth, h(async (req) => {
  const domain = String(req.query.domain || "").trim().toLowerCase();
  const kind = String(req.query.kind || "");
  if (!DNS_KINDS.has(kind)) throw Object.assign(new Error("valid kind required"), { status: 400 });
  const orgId = req.org?.id ?? null;
  const row = getDnsSetup(orgId, domain, kind);
  return { status: row?.status || "none", provider: row?.provider || null, verified: !!row?.verified_at };
}));
```

Note: `/api/dns/callback` has NO `requireAuth` — the provider redirects the user's browser here and the signed `state` is what authenticates the request.

- [ ] **Step 6: Verify the server boots and all server tests pass**

Run: `node --check server/index.js && node --test server/*.test.js`
Expected: `node --check` prints nothing (syntax OK); test run ends with `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add server/index.js server/domainconnect.js server/dns_routes.test.js
git commit -m "feat(dns): discover/callback/status routes for one-click DNS"
```

---

## Task 6: Client — `api.js` methods + shared `<DnsSetup>` + wiring

**Files:**
- Modify: `client/src/lib/api.js`
- Create: `client/src/components/DnsSetup.jsx`
- Modify: `client/src/pages/Email.jsx` (replace the inline DNS table in `DomainCard` with `<DnsSetup>`)
- Modify: `client/src/pages/ServiceDetail.jsx` (add `<DnsSetup kind="hosting">` to the custom-domain manager)

**Interfaces:**
- Consumes: `GET /api/dns/discover`, `GET /api/dns/status` (Task 5); `Button`, `Card`, `Spinner` from `components/ui.jsx`.
- Produces: `<DnsSetup domain kind webmail? />`.

- [ ] **Step 1: Add api methods**

In `client/src/lib/api.js`, after the mail methods (~L105) add:

```js
  // One-click DNS (Domain Connect)
  dnsDiscover: (domain, kind) => req(`/dns/discover?domain=${encodeURIComponent(domain)}&kind=${kind}`),
  dnsStatus:   (domain, kind) => req(`/dns/status?domain=${encodeURIComponent(domain)}&kind=${kind}`),
```

- [ ] **Step 2: Create `client/src/components/DnsSetup.jsx`**

Moves the manual records table into a shared component and adds the one-click button + status badge.

```jsx
import { useEffect, useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Spinner } from "./ui.jsx";

// One-click DNS setup for a domain. `kind` is "mail" or "hosting". Falls back to a
// copy-paste records table when the provider isn't Domain-Connect-capable.
export default function DnsSetup({ domain, kind, webmail }) {
  const [state, setState] = useState(null); // { supported, provider, applyUrl, records }
  const [status, setStatus] = useState(null); // { status, provider, verified }
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.dnsStatus(domain, kind).then(setStatus).catch(() => {}); }, [domain, kind]);

  async function discover() {
    setBusy(true);
    try {
      const s = await api.dnsDiscover(domain, kind);
      setState(s);
      if (s.supported && s.applyUrl) window.open(s.applyUrl, "_blank", "noopener");
      else setOpen(true);
    } finally { setBusy(false); }
  }

  const records = state?.records;
  const badge = status?.verified ? "Configured ✓"
    : status?.status === "applied" ? "Applied — verifying…"
    : status?.status === "failed" ? "Setup failed"
    : status?.status === "manual" ? "Manual setup" : null;

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={discover} disabled={busy}>
          {busy ? <Spinner /> : <Wand2 size={14} />} Set up DNS automatically
        </Button>
        {badge && <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {badge}{status?.provider ? ` · ${status.provider}` : ""}
        </span>}
        {records && (
          <button onClick={() => setOpen((v) => !v)} className="ml-auto flex items-center gap-1 text-xs"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Or add records manually
          </button>
        )}
      </div>
      {open && records && <RecordsTable records={records} webmail={webmail} domain={domain} kind={kind} />}
    </div>
  );
}

function RecordsTable({ records, webmail, domain, kind }) {
  const all = kind === "mail" && webmail
    ? [...records, { type: "CNAME", name: webmail, value: "mail.debutdepoly.com", note: "Webmail" }]
    : records;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead><tr style={{ color: "var(--text-muted)" }}>
          <th className="px-2 py-1 text-left font-semibold uppercase">Type</th>
          <th className="px-2 py-1 text-left font-semibold uppercase">Name</th>
          <th className="px-2 py-1 text-left font-semibold uppercase">Value</th>
        </tr></thead>
        <tbody>
          {all.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="px-2 py-1.5 mono">{r.type}</td>
              <td className="px-2 py-1.5 mono" style={{ color: "var(--text-muted)" }}>{r.name}</td>
              <td className="px-2 py-1.5"><CopyVal value={r.value} /><div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{r.note}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyVal({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="mono inline-flex items-center gap-1.5" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text)" }} title="Copy">
      {value} {copied ? <Check size={12} style={{ color: "var(--ok-text)" }} /> : <Copy size={12} style={{ opacity: 0.5 }} />}
    </button>
  );
}
```

- [ ] **Step 3: Wire into `Email.jsx`**

In `client/src/pages/Email.jsx`, add the import and replace the manual DNS disclosure in `DomainCard` (the block from the `<button onClick={() => setOpen…}>DNS records to publish</button>` through `{open && <DnsTable …/>}`, ~L110–113) with `<DnsSetup>`. The old `DnsTable`/`CopyVal` helpers in this file can be deleted (now living in `DnsSetup.jsx`).

```jsx
import DnsSetup from "../components/DnsSetup.jsx";
// …inside DomainCard, replacing the DNS records disclosure:
<DnsSetup domain={d.domain} kind="mail" webmail={webmail} />
```

- [ ] **Step 4: Wire into the service domain manager**

In `client/src/pages/ServiceDetail.jsx`, import `DnsSetup` and render `<DnsSetup domain={fqdn} kind="hosting" />` under each custom domain row in the domains manager (next to the existing "A record → platform IP" verify UI).

```jsx
import DnsSetup from "../components/DnsSetup.jsx";
// …under a bound custom domain:
<DnsSetup domain={fqdn} kind="hosting" />
```

- [ ] **Step 5: Verify the client builds**

Run: `npm run build`
Expected: Vite build completes with no errors and emits `client/dist`.

- [ ] **Step 6: Manual smoke test**

Run `npm run dev`, open the Email page, click **Set up DNS automatically** on a domain:
- Unsupported/unknown provider → the manual records table expands (fallback). ✓
- The status badge reflects `GET /api/dns/status`. ✓
Repeat on a service's custom domain (kind hosting).

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/api.js client/src/components/DnsSetup.jsx client/src/pages/Email.jsx client/src/pages/ServiceDetail.jsx
git commit -m "feat(dns): shared DnsSetup component + wire into Email and service domains"
```

---

## Task 7: Sync-flow signing (gated behind onboarding)

**Files:**
- Modify: `server/domainconnect.js` (extend `buildApplyUrl` to append `sig`+`key` when signing is enabled)
- Test: `server/dc_signing.test.js`

**Interfaces:**
- Consumes: `process.env.DOMAINCONNECT_PRIVATE_KEY` (PEM), `process.env.DOMAINCONNECT_KEY_HOST` (the `_dcsig` host id registered with the provider), `process.env.DOMAINCONNECT_SIGNING` (`"on"` to enable).
- Produces: signed apply URLs when signing is on; unchanged (unsigned) when off.

**Context:** Domain Connect providers that require signed sync applies verify a signature over the query string using a public key published at a host you register during onboarding. Until onboarding + `DOMAINCONNECT_SIGNING=on`, apply URLs are unsigned and such providers report unsupported → manual fallback (Task 5 already handles that). This task makes the one-click path light up once onboarding lands, with no route changes.

- [ ] **Step 1: Write the failing test**

Create `server/dc_signing.test.js` (generates an ephemeral RSA keypair so the test needs no real secret):

```js
// node --test server/dc_signing.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.DOMAINCONNECT_SIGNING = "on";
process.env.DOMAINCONNECT_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" });
process.env.DOMAINCONNECT_KEY_HOST = "_dcsig";
const { buildApplyUrl } = await import("./domainconnect.js");

test("signed apply URL carries sig+key and the sig verifies over the query", () => {
  const url = buildApplyUrl({
    urlSyncUX: "https://dcc.godaddy.com/manage", domain: "acme.com", kind: "mail",
    params: {}, redirectUri: "https://app.debutdepoly.com/api/dns/callback", state: "ST",
  });
  const u = new URL(url);
  const sig = u.searchParams.get("sig");
  const key = u.searchParams.get("key");
  assert.ok(sig && key === "_dcsig");
  // Signature is over the query string minus the sig/key params, in order.
  u.searchParams.delete("sig"); u.searchParams.delete("key");
  const signed = u.search.slice(1);
  const ok = createVerify("RSA-SHA256").update(signed).verify(publicKey, Buffer.from(sig, "base64"));
  assert.equal(ok, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/dc_signing.test.js`
Expected: FAIL — no `sig` param (signing not implemented).

- [ ] **Step 3: Implement signing in `buildApplyUrl`**

In `server/domainconnect.js`, add the signer and call it at the end of `buildApplyUrl`:

```js
import { createSign } from "node:crypto";

function signQuery(search) {
  if (process.env.DOMAINCONNECT_SIGNING !== "on" || !process.env.DOMAINCONNECT_PRIVATE_KEY) return null;
  const sig = createSign("RSA-SHA256").update(search).sign(process.env.DOMAINCONNECT_PRIVATE_KEY, "base64");
  return { sig, key: process.env.DOMAINCONNECT_KEY_HOST || "_dcsig" };
}
```

Change the return of `buildApplyUrl` to sign when enabled:

```js
export function buildApplyUrl({ urlSyncUX, domain, kind, params, redirectUri, state }) {
  const base = `${urlSyncUX.replace(/\/$/, "")}/v2/domainTemplates/providers/${PROVIDER_ID}/services/${kind}/apply`;
  const q = new URLSearchParams({ domain, ...params, redirect_uri: redirectUri, state });
  const signed = signQuery(q.toString());
  if (signed) { q.set("sig", signed.sig); q.set("key", signed.key); }
  return `${base}?${q.toString()}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test server/dc_signing.test.js server/domainconnect.test.js`
Expected: PASS — signing test passes AND the Task 3 tests still pass (signing off by default, so their URLs stay unsigned).

- [ ] **Step 5: Commit**

```bash
git add server/domainconnect.js server/dc_signing.test.js
git commit -m "feat(dns): optional Domain Connect sync-flow signing (gated by env)"
```

---

## External follow-ups (not code tasks)

- Onboard `server/templates/*.json` with providers: submit to the public Domain Connect Templates repo and email `domainconnect@godaddy.com` for GoDaddy; register the signing public key; then set `DOMAINCONNECT_SIGNING=on` + `DOMAINCONNECT_PRIVATE_KEY` in the panel Coolify env.
- Deploy: commit + `node server/_deploydd.mjs` (pushes origin/main, triggers Coolify rebuild).

## Deferred (out of this plan)

Raw GoDaddy API-key bridge; Domain Connect async/OAuth flow; registrar reselling; flipping the Email/domain UI to end-customer self-serve (the engine is org-aware, but the buttons stay behind current pages until that exposure is designed).
