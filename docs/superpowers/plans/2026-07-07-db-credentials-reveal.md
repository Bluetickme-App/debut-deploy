# Revealable Database Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a database's owner (or an admin) reveal its full connection details — username, password, host, port, db, and internal/external connection URLs — from the database's panel page.

**Architecture:** On-demand fetch. On reveal, the server runs `docker inspect <db-uuid>` on the host over the existing `runOnHost` SSH channel and parses the container's plaintext env/image/port-bindings into a credential object. Nothing is stored; works for existing + future DBs.

**Tech Stack:** Node/Express (ESM), `node:test`, React+Vite. Reuses `ssh2`-based `runOnHost` ([hostexec.js](../../../server/hostexec.js)). No new dependency.

## Global Constraints

- ESM everywhere (`import`, not `require`).
- Never persist or log the DB password (audit records DB uuid + actor only, never the secret).
- Reveal route is `requireAuth` + `assertOwns(req.user, "database", <id>)` (owner passes, admin bypasses) — same guard as the other `/api/databases/:id/*` routes.
- `username`/`password` are `encodeURIComponent`-escaped inside connection URLs.
- `runOnHost` targets the primary host; a DB whose container isn't found there returns a clear 404, never a 5xx.
- Tests: `node --test`; pure parser tested with fixtures; no new HTTP test harness (consistent with the repo's server tests).

## File Structure

- `server/dbcreds.js` (create) — `parseInspect` (pure) + `getDatabaseCredentials` (runOnHost + parse).
- `server/dbcreds.test.js` (create) — fixture tests for the parser + a mocked-runOnHost 404 path.
- `server/index.js` (modify) — import `dbcreds`, add `GET /api/databases/:id/credentials`.
- `client/src/lib/api.js` (modify) — add `dbCredentials(id)`.
- `client/src/pages/DatabaseDetail.jsx` (modify) — add a "Connection details" reveal card.

---

## Task 1: `dbcreds.js` — parser + host fetch

**Files:**
- Create: `server/dbcreds.js`
- Test: `server/dbcreds.test.js`

**Interfaces:**
- Consumes: `runOnHost(command) → Promise<stdout>` from `./hostexec.js` (rejects with `{status}`-tagged errors; `getDatabaseCredentials` injects it for tests via an optional param).
- Produces:
  - `parseInspect(inspect, { uuid, publicHost }) → creds` (pure). `inspect` is the parsed `docker inspect` output (array or single object). `creds = { engine, username, password, database, internalHost, internalPort, externalHost, externalPort, internalUrl, externalUrl }`.
  - `getDatabaseCredentials(uuid, { run } = {}) → Promise<creds>` — `run` defaults to `runOnHost`.

- [ ] **Step 1: Write the failing test**

Create `server/dbcreds.test.js`:

```js
// node --test server/dbcreds.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInspect, getDatabaseCredentials } from "./dbcreds.js";

const PG = [{
  Config: { Image: "postgres:16-alpine", Env: ["PATH=/usr/bin", "POSTGRES_USER=myuser", "POSTGRES_PASSWORD=p@ss/w0rd", "POSTGRES_DB=appdb"] },
  HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5433" }] } },
  NetworkSettings: { Ports: {} },
}];
const REDIS = [{
  Config: { Image: "redis:7.2", Env: ["REDIS_PASSWORD=secretpass"] },
  HostConfig: { PortBindings: {} },
  NetworkSettings: { Ports: {} },
}];

test("postgres with a published port → full creds + internal & external URLs (encoded)", () => {
  const c = parseInspect(PG, { uuid: "abc123", publicHost: "10.0.0.9" });
  assert.equal(c.engine, "postgres");
  assert.equal(c.username, "myuser");
  assert.equal(c.password, "p@ss/w0rd");
  assert.equal(c.database, "appdb");
  assert.equal(c.internalUrl, "postgresql://myuser:p%40ss%2Fw0rd@abc123:5432/appdb");
  assert.equal(c.externalPort, 5433);
  assert.equal(c.externalUrl, "postgresql://myuser:p%40ss%2Fw0rd@10.0.0.9:5433/appdb");
});

test("redis with no public port → external URL is null, internal has no /db", () => {
  const c = parseInspect(REDIS, { uuid: "red1", publicHost: "10.0.0.9" });
  assert.equal(c.engine, "redis");
  assert.equal(c.username, "default");
  assert.equal(c.password, "secretpass");
  assert.equal(c.externalUrl, null);
  assert.equal(c.internalUrl, "redis://default:secretpass@red1:6379");
});

test("getDatabaseCredentials throws 404 when no container is found", async () => {
  const run = async () => "[]";
  await assert.rejects(() => getDatabaseCredentials("nope", { run }), (e) => e.status === 404);
});

test("getDatabaseCredentials parses a real-shaped inspect via injected run", async () => {
  const run = async () => JSON.stringify(PG);
  const c = await getDatabaseCredentials("abc123", { run });
  assert.equal(c.password, "p@ss/w0rd");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/dbcreds.test.js`
Expected: FAIL — cannot find module `./dbcreds.js`.

- [ ] **Step 3: Implement `server/dbcreds.js`**

```js
// Reveal a database's connection credentials on demand. Coolify's REST API masks
// an existing DB's password, so we read the running container's plaintext env
// (POSTGRES_PASSWORD etc.) via `docker inspect` over the SSH-to-host channel. Pure
// parsing (parseInspect) is split from the host call so it's unit-testable.
import { runOnHost } from "./hostexec.js";

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

// Per-engine: URL scheme, default port, and the env var names the image uses.
const ENGINES = {
  postgres: { scheme: "postgresql", port: 5432, user: "POSTGRES_USER", pass: "POSTGRES_PASSWORD", db: "POSTGRES_DB", defUser: "postgres" },
  redis:    { scheme: "redis",      port: 6379, pass: "REDIS_PASSWORD", defUser: "default" },
  mysql:    { scheme: "mysql",      port: 3306, user: "MYSQL_USER", pass: "MYSQL_PASSWORD", db: "MYSQL_DATABASE", defUser: "root" },
  mariadb:  { scheme: "mysql",      port: 3306, user: "MARIADB_USER", pass: "MARIADB_PASSWORD", db: "MARIADB_DATABASE", defUser: "root" },
  mongo:    { scheme: "mongodb",    port: 27017, user: "MONGO_INITDB_ROOT_USERNAME", pass: "MONGO_INITDB_ROOT_PASSWORD", db: "MONGO_INITDB_DATABASE", defUser: "root" },
};

function engineFromImage(image = "") {
  const i = String(image).toLowerCase();
  if (i.includes("postgres")) return "postgres";
  if (i.includes("redis") || i.includes("valkey") || i.includes("keydb") || i.includes("dragonfly")) return "redis";
  if (i.includes("mariadb")) return "mariadb";
  if (i.includes("mysql")) return "mysql";
  if (i.includes("mongo")) return "mongo";
  return null;
}

const NOT_FOUND = () => Object.assign(new Error("database container not found on the managed host (is it running?)"), { status: 404 });

export function parseInspect(inspect, { uuid, publicHost }) {
  const c = Array.isArray(inspect) ? inspect[0] : inspect;
  if (!c) throw NOT_FOUND();
  const engine = engineFromImage(c.Config?.Image);
  const spec = engine && ENGINES[engine];
  const env = Object.fromEntries((c.Config?.Env || []).map((e) => { const i = e.indexOf("="); return [e.slice(0, i), e.slice(i + 1)]; }));

  const username = spec ? (spec.user ? (env[spec.user] || spec.defUser) : spec.defUser) : null;
  const password = spec ? (env[spec.pass] ?? null) : null;
  const database = spec?.db ? (env[spec.db] || username) : null;
  const internalPort = spec?.port || null;

  let externalPort = null;
  const bindings = c.HostConfig?.PortBindings || c.NetworkSettings?.Ports || {};
  const b = internalPort ? bindings[`${internalPort}/tcp`] : null;
  if (Array.isArray(b) && b[0]?.HostPort) externalPort = Number(b[0].HostPort);

  const enc = (s) => encodeURIComponent(String(s ?? ""));
  const scheme = spec?.scheme || "db";
  const auth = username ? `${enc(username)}:${enc(password)}@` : (password ? `:${enc(password)}@` : "");
  const path = database ? `/${database}` : "";
  const internalUrl = spec ? `${scheme}://${auth}${uuid}:${internalPort}${path}` : null;
  const externalUrl = (spec && externalPort && publicHost) ? `${scheme}://${auth}${publicHost}:${externalPort}${path}` : null;

  return {
    engine: engine || "unknown",
    username, password, database,
    internalHost: uuid, internalPort,
    externalHost: externalPort ? publicHost : null, externalPort,
    internalUrl, externalUrl,
  };
}

export async function getDatabaseCredentials(uuid, { run = runOnHost } = {}) {
  const u = String(uuid).replace(/[^a-z0-9]/gi, "");
  if (!u) throw Object.assign(new Error("database uuid required"), { status: 400 });
  if (DEMO) {
    return { engine: "postgres", username: "demo", password: "demo-pass", database: "demo",
      internalHost: u, internalPort: 5432, externalHost: null, externalPort: null,
      internalUrl: `postgresql://demo:demo-pass@${u}:5432/demo`, externalUrl: null };
  }
  const raw = await run(`CID=$(docker ps -q --filter name=${u} | head -1); [ -n "$CID" ] && docker inspect "$CID" || echo '[]'`);
  let inspect;
  try { inspect = JSON.parse(String(raw).trim() || "[]"); } catch { inspect = []; }
  if (!Array.isArray(inspect) || !inspect.length) throw NOT_FOUND();
  return parseInspect(inspect, { uuid: u, publicHost: process.env.MIGRATION_SSH_HOST || null });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/dbcreds.test.js`
Expected: PASS — `# pass 4`.

- [ ] **Step 5: Commit**

```bash
git add server/dbcreds.js server/dbcreds.test.js
git commit -m "feat(db): dbcreds — parse container inspect into connection credentials"
```

---

## Task 2: reveal route + client api method

**Files:**
- Modify: `server/index.js` (import near the other `import * as` lines; add the route next to the other `/api/databases/:id/*` routes, e.g. after the GET detail route ~line 768)
- Modify: `client/src/lib/api.js` (add next to the other database methods)

**Interfaces:**
- Consumes: `dbcreds.getDatabaseCredentials(uuid)` (Task 1); existing `requireAuth`, `h`, `assertOwns`, `record`.
- Produces: `GET /api/databases/:id/credentials → creds`; `api.dbCredentials(id) → Promise<creds>`.

- [ ] **Step 1: Add the import**

In `server/index.js`, alongside the other module imports (near the top `import * as ...` block):

```js
import * as dbcreds from "./dbcreds.js";
```

- [ ] **Step 2: Add the route**

In `server/index.js`, immediately after the `GET /api/databases/:uuid` detail route (the handler that returns `{ ...d, plan_id }`, ~line 768), add:

```js
// Reveal a database's connection credentials (owner or admin). On-demand: reads the
// running container's env via docker inspect over SSH — never stored. Audit-logged.
app.get(
  "/api/databases/:id/credentials",
  requireAuth,
  h(async (req) => {
    assertOwns(req.user, "database", req.params.id);
    const creds = await dbcreds.getDatabaseCredentials(req.params.id);
    record(req, "db.credentials.reveal", { resourceType: "database", resourceUuid: req.params.id });
    return creds;
  })
);
```

- [ ] **Step 3: Add the client method**

In `client/src/lib/api.js`, next to the other `database` methods (e.g. after `database:`):

```js
  dbCredentials: (id) => req(`/databases/${encodeURIComponent(id)}/credentials`),
```

- [ ] **Step 4: Verify the server boots and the suite is green**

Run: `node --check server/index.js && node --test server/*.test.js`
Expected: `node --check` prints nothing; the suite ends with `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/index.js client/src/lib/api.js
git commit -m "feat(db): GET /api/databases/:id/credentials reveal route + api method"
```

---

## Task 3: UI — "Connection details" reveal card

**Files:**
- Modify: `client/src/pages/DatabaseDetail.jsx`

**Interfaces:**
- Consumes: `api.dbCredentials(id)` (Task 2); the page's `uuid` from `useParams`; existing imports `Eye, EyeOff, Copy` (lucide-react), `Button`, `Spinner`, `SettingsSection`, `SettingsRow`.

**Context:** `DatabaseDetail.jsx` already imports `Eye, EyeOff, Copy` from `lucide-react` and `SettingsSection`/`SettingsRow` from `../components/SettingsSection.jsx`, and reads the DB via `api.database(uuid)`. The page has section cards (e.g. `DbPlanScale`). Add a new `DbCredentials` component and render it among those sections.

- [ ] **Step 1: Add the `DbCredentials` component**

In `client/src/pages/DatabaseDetail.jsx`, add this component (near `DbPlanScale`):

```jsx
function CopyBtn({ value }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" title="Copy"
      onClick={() => { navigator.clipboard?.writeText(value); setOk(true); setTimeout(() => setOk(false), 1200); }}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}>
      <Copy size={14} /> {ok ? "copied" : ""}
    </button>
  );
}

// On-demand reveal of the database's connection details. Nothing is fetched until
// the owner/admin clicks Reveal; the password sits behind a show/hide toggle.
function DbCredentials({ dbUuid }) {
  const [creds, setCreds] = useState(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function reveal() {
    setBusy(true); setErr(null);
    try { setCreds(await api.dbCredentials(dbUuid)); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <SettingsSection id="credentials" title="Connection details">
      {!creds ? (
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={reveal} disabled={busy}>{busy ? <Spinner /> : <Eye size={16} />} Reveal</Button>
          {err && <span className="text-sm" style={{ color: "var(--err-text)" }}>{err}</span>}
        </div>
      ) : (
        <>
          <SettingsRow label="Username"><span className="mono">{creds.username || "—"}</span></SettingsRow>
          <SettingsRow label="Password">
            <span className="mono">{show ? (creds.password ?? "—") : "••••••••••"}</span>{" "}
            <button type="button" onClick={() => setShow((v) => !v)} title={show ? "Hide" : "Show"}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            {creds.password && <> <CopyBtn value={creds.password} /></>}
          </SettingsRow>
          <SettingsRow label="Host"><span className="mono">{creds.internalHost}:{creds.internalPort}</span></SettingsRow>
          {creds.database && <SettingsRow label="Database"><span className="mono">{creds.database}</span></SettingsRow>}
          {creds.internalUrl && (
            <SettingsRow label="Internal URL">
              <span className="mono break-all">{show ? creds.internalUrl : creds.internalUrl.replace(/:[^:@/]+@/, ":••••@")}</span> <CopyBtn value={creds.internalUrl} />
            </SettingsRow>
          )}
          <SettingsRow label="External URL">
            {creds.externalUrl ? (
              <><span className="mono break-all">{show ? creds.externalUrl : creds.externalUrl.replace(/:[^:@/]+@/, ":••••@")}</span> <CopyBtn value={creds.externalUrl} /></>
            ) : (
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>No public port — enable one to connect from outside the platform.</span>
            )}
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
}
```

- [ ] **Step 2: Render it on the page**

In the `DatabaseDetail` page body, render `<DbCredentials dbUuid={uuid} />` among the other section cards (e.g. just after the `DbPlanScale` section). Use the same `uuid` variable the page already reads from `useParams`.

```jsx
<DbCredentials dbUuid={uuid} />
```

- [ ] **Step 3: Verify the client builds**

Run: `npm run build`
Expected: Vite build completes with no errors and emits `client/dist` (a pre-existing chunk-size warning is fine).

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`, open a database's detail page, click **Reveal**:
- Fields + connection URL(s) appear; password is masked until the eye toggle. ✓
- A database without a public port shows the "No public port" note for External URL. ✓

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DatabaseDetail.jsx
git commit -m "feat(db): Connection details reveal card on the database page"
```

---

## Deferred (out of this plan)

- Databases on dedicated/other servers (reveal SSHes to the primary host only).
- Password rotation from the UI (reveal is read-only).
- Caching/persisting credentials in the panel (deliberately on-demand).
