// ponytail: pure evaluator + DB lifecycle; Task 3 added reconcile/list below; Task 5 added applyRemediation
import { db } from "./db.js";
import { fleetOverview as _fleetOverview } from "./metrics.js";
import { runOnHost } from "./hostexec.js";
import { controlService as _controlService } from "./coolify.js";
import { clearDeployQueue as _clearDeployQueue } from "./coolifydb.js";
const DOWN_STATUSES = new Set(["exited", "stopped", "dead", "not_running", "paused"]);

// The app UUID comes along for the ride so a deploy.zombie's target can BE the uuid —
// clear-deploy-queue acts on a specific application, and only the uuid identifies one.
// LEFT JOIN + fallback: a queue row whose application row is gone still gets reported.
// (application_id is TEXT in Coolify's schema, hence the ::text cast on applications.id.)
// Two ages per row, and the difference matters. created_at is when the deploy was
// ENQUEUED; Coolify serialises builds per server, so a deploy queued behind another
// accrues that age doing nothing wrong. Judging a zombie on it killed healthy builds:
// a service whose builds take ~900s, queued behind one more, trips 1200s while its own
// build is 5 minutes old and progressing fine. updated_at is when the row last MOVED,
// so "stalled" is the honest test — a build whose worker died stops touching it.
const DEPLOY_QUERY =
  "SELECT q.deployment_uuid, COALESCE(a.uuid,''), q.application_name, q.status," +
  " EXTRACT(EPOCH FROM (now()-q.created_at))::int," +
  " EXTRACT(EPOCH FROM (now()-q.updated_at))::int" +
  " FROM application_deployment_queues q LEFT JOIN applications a ON a.id::text = q.application_id" +
  " WHERE q.status IN ('in_progress','queued')";

// Same query without updated_at. collectSituationInputs falls back to this if the
// column isn't there: a failed query yields deploys=[], which would silently switch
// OFF every deploy situation fleet-wide — a worse failure than the bug being fixed.
const DEPLOY_QUERY_LEGACY =
  "SELECT q.deployment_uuid, COALESCE(a.uuid,''), q.application_name, q.status," +
  " EXTRACT(EPOCH FROM (now()-q.created_at))::int" +
  " FROM application_deployment_queues q LEFT JOIN applications a ON a.id::text = q.application_id" +
  " WHERE q.status IN ('in_progress','queued')";

/**
 * Gather host metrics + live deploy-queue state.
 * @param {{ fleetOverview?: () => Promise<object> }} [opts]  — injectable for tests
 * @returns {Promise<{ host: object, sites: object[], deploys: object[] }>}
 */
export async function collectSituationInputs({ fleetOverview = _fleetOverview } = {}) {
  let host = { diskRoot: { pct: 0 }, diskVolume: null, mem: { pct: 0 } };
  let sites = [];
  let deploys = [];
  try {
    const fo = await fleetOverview();
    host = fo.host ?? host;
    sites = fo.sites ?? [];
  } catch { /* best-effort */ }
  const psql = (q) => runOnHost(`docker exec coolify-db psql -U coolify -d coolify -tAF'|' -c "${q}"`);
  try {
    // stallSec is absent on the legacy path, and parseDeployRows leaves it null there —
    // evaluateSituations then falls back to ageSec, i.e. today's behaviour.
    let raw;
    try { raw = await psql(DEPLOY_QUERY); }
    catch { raw = await psql(DEPLOY_QUERY_LEGACY); }
    deploys = parseDeployRows(raw);
  } catch { /* best-effort: SSH down or no deploys table */ }
  return { host, sites, deploys };
}

/** Parse psql's `-tAF'|'` output. Tolerates the 5-column legacy shape. */
export function parseDeployRows(raw) {
  return String(raw ?? "").split("\n").filter(Boolean).map((line) => {
    const [uuid, appUuid, application_name, status, ageSec, stallSec] = line.split("|");
    return {
      uuid,
      appUuid: appUuid || null,
      application_name,
      status,
      ageSec: Number(ageSec),
      stallSec: stallSec === undefined || stallSec === "" ? null : Number(stallSec),
    };
  });
}

export const DISK_WARN = 85;
export const DISK_CRIT = 92;
export const MEM_WARN = 90;
export const ZOMBIE_DEPLOY_SEC = 1200;
export const QUEUE_PILEUP = 3;

// How long an in-progress deploy has gone without moving. Prefers the stall age; only a
// legacy row with no updated_at falls back to total age (which counts queue wait).
export const zombieStallSec = (d) => (d.stallSec == null ? d.ageSec : d.stallSec);

export const REGISTRY = {
  "prune-docker": {
    title: "Reclaim disk (prune images + build cache)",
    situationTypes: ["host.disk"],
    auto: true,
    confidence: "high",
    cooldownSec: 3600,
    command: "docker image prune -af --filter until=24h && docker builder prune -f --keep-storage 20GB",
  },
  "restart-service": {
    title: "Restart the unhealthy service",
    situationTypes: ["service.unhealthy"],
    auto: false,
    confidence: "medium",
    // ponytail: routes through control_service, not a raw host cmd — see applyRemediation (Task 3)
    command: "coolify-restart",
  },
  "clear-deploy-queue": {
    title: "Clear the stuck deploy (fail its queue rows, drop hung build containers, nudge the worker)",
    situationTypes: ["deploy.zombie"],
    auto: true,
    confidence: "high",
    cooldownSec: 1800,
    // Was `docker restart coolify`, which CANNOT fix a zombie: a stuck row is an orphaned
    // DB record (its worker process is already dead, or its job never reached redis), and
    // restarting the orchestrator neither reconciles the row nor re-dispatches the job — it
    // just takes the whole management plane down. Routes through coolifydb.clearDeployQueue
    // instead, which fails THIS app's stuck rows, removes its hung build helpers and runs
    // `queue:restart`. See applyRemediation. // ponytail: same shape as coolify-restart —
    // a sentinel, not a shell string, because it needs the app uuid from situation.target.
    command: "coolify-clear-queue",
  },
};

// ponytail: safety default OFF — requires explicit opt-in via env
export const AUTO_REMEDIATE_ENABLED = process.env.AUTO_REMEDIATE === "true";

/**
 * Pure selector: returns which open situations should be auto-remediated.
 * Does NOT check AUTO_REMEDIATE_ENABLED — caller gates on that.
 *
 * @param {Array<{id:number, suggested_remediation:string|null, auto_applied_at:string|null}>} openSituations
 * @param {Array<{action:string, at:string}>} recentLog
 * @param {number} nowMs  — Date.now()-style timestamp
 * @returns {Array<{situation:object, remediationId:string}>}
 */
export function selectAutoRemediations(openSituations, recentLog, nowMs) {
  return openSituations.flatMap((situation) => {
    const key = situation.suggested_remediation;
    const reg = key ? REGISTRY[key] : null;
    if (!reg || !reg.auto || reg.confidence !== "high") return [];
    if (situation.auto_applied_at) return [];
    const withinCooldown = recentLog.some(
      (entry) => entry.action === key && nowMs - Date.parse(entry.at) < reg.cooldownSec * 1000
    );
    if (withinCooldown) return [];
    return [{ situation, remediationId: key }];
  });
}

/**
 * @param {{ host: { diskRoot: {pct:number}, diskVolume: {pct:number}|null, mem: {pct:number} },
 *           sites: Array<{uuid:string, name:string, status:string, health:string}>,
 *           deploys: Array<{uuid:string, application_name:string, status:string, ageSec:number}> }} input
 * @returns {Array<{type:string, target:string, severity:string, detail:string, suggested_remediation:string|null}>}
 */
export function evaluateSituations({ host, sites, deploys }) {
  const out = [];

  const checkDisk = (pct, label) => {
    if (pct >= DISK_CRIT)
      out.push({ type: "host.disk", target: "host", severity: "crit", detail: `${label} at ${pct}%`, suggested_remediation: "prune-docker" });
    else if (pct >= DISK_WARN)
      out.push({ type: "host.disk", target: "host", severity: "warn", detail: `${label} at ${pct}%`, suggested_remediation: "prune-docker" });
  };

  checkDisk(host.diskRoot.pct, "root disk");
  if (host.diskVolume != null) checkDisk(host.diskVolume.pct, "volume disk");

  if (host.mem.pct >= MEM_WARN)
    out.push({ type: "host.mem", target: "host", severity: "warn", detail: `mem at ${host.mem.pct}%`, suggested_remediation: null });

  for (const site of sites) {
    if (DOWN_STATUSES.has(site.status) || site.health === "unhealthy")
      out.push({ type: "service.unhealthy", target: site.uuid, severity: "warn", detail: `${site.name ?? site.uuid} is ${site.status}/${site.health}`, suggested_remediation: "restart-service" });
  }

  for (const d of deploys) {
    // target is the app UUID (what clear-deploy-queue needs), mirroring service.unhealthy;
    // the human-readable name lives in `detail`. Falls back to the name when the app row
    // is missing — the situation still opens, its remediation just can't resolve a target.
    //
    // Judged on STALL, not total age: queue wait is not evidence of a hung build. Only
    // when updated_at is unavailable (legacy query) does this fall back to total age.
    if (d.status !== "in_progress") continue;
    const stalled = zombieStallSec(d);
    if (stalled > ZOMBIE_DEPLOY_SEC) {
      const detail = d.stallSec == null
        ? `${d.application_name} deploy in_progress for ${d.ageSec}s`
        : `${d.application_name} deploy stalled — no progress for ${d.stallSec}s (queued ${d.ageSec}s ago)`;
      out.push({ type: "deploy.zombie", target: d.appUuid ?? d.application_name, severity: "crit", detail, suggested_remediation: "clear-deploy-queue" });
    }
  }

  const queued = deploys.filter((d) => d.status === "queued");
  if (queued.length >= QUEUE_PILEUP)
    out.push({ type: "deploy.pileup", target: "host", severity: "warn", detail: `${queued.length} deploys queued`, suggested_remediation: null });

  return out;
}

const stmtOpenRows = db.prepare("SELECT * FROM situations WHERE status = 'open'");
const stmtInsert = db.prepare(
  "INSERT INTO situations (type, target, severity, detail, suggested_remediation, status, opened_at) VALUES (?,?,?,?,?,'open',?)"
);
const stmtResolve = db.prepare(
  "UPDATE situations SET status = 'resolved', resolved_at = ? WHERE id = ?"
);
const stmtListOpen = db.prepare("SELECT * FROM situations WHERE status='open' ORDER BY opened_at DESC, id DESC");
const stmtListAll  = db.prepare("SELECT * FROM situations ORDER BY opened_at DESC, id DESC");

/**
 * Diff desired situations against open DB rows; open new ones, resolve stale ones.
 * @param {Array<{type,target,severity,detail,suggested_remediation}>} desired
 * @param {string} nowIso  — ISO 8601 timestamp for opened_at / resolved_at
 * @returns {{ opened: object[], resolved: object[] }}
 */
export function reconcileSituations(desired, nowIso) {
  const run = db.transaction(() => {
    const openRows = stmtOpenRows.all();
    const openKeys = new Set(openRows.map((r) => r.type + "|" + r.target));
    const desiredKeys = new Set(desired.map((d) => d.type + "|" + d.target));

    const opened = [];
    for (const item of desired) {
      if (!openKeys.has(item.type + "|" + item.target)) {
        const info = stmtInsert.run(item.type, item.target, item.severity, item.detail ?? null, item.suggested_remediation ?? null, nowIso);
        opened.push({ id: info.lastInsertRowid, ...item, status: "open", opened_at: nowIso });
      }
    }

    const resolved = [];
    for (const row of openRows) {
      if (!desiredKeys.has(row.type + "|" + row.target)) {
        stmtResolve.run(nowIso, row.id);
        resolved.push({ ...row, status: "resolved", resolved_at: nowIso });
      }
    }

    return { opened, resolved };
  });
  return run();
}

/**
 * @param {{ includeResolved?: boolean }} [opts]
 * @returns {object[]}
 */
export function listSituations({ includeResolved = false } = {}) {
  return (includeResolved ? stmtListAll : stmtListOpen).all();
}

const stmtMarkAutoApplied = db.prepare("UPDATE situations SET auto_applied_at = ? WHERE id = ?");
const stmtRecentLog = db.prepare("SELECT action, at FROM remediation_log WHERE at >= ? ORDER BY at DESC");

/** @param {number} situationId @param {string} nowIso */
export function markAutoApplied(situationId, nowIso) {
  stmtMarkAutoApplied.run(nowIso, situationId);
}

/** @param {string} sinceIso @returns {Array<{action:string, at:string}>} */
export function recentRemediationLog(sinceIso) {
  return stmtRecentLog.all(sinceIso);
}

const stmtGetSituation = db.prepare("SELECT * FROM situations WHERE id = ?");
const stmtLogRemediation = db.prepare(
  "INSERT INTO remediation_log (situation_id, action, actor, command, ok, result, at) VALUES (?,?,?,?,?,?,?)"
);

/**
 * Execute the registered remediation for a situation and log the result.
 * Security: REGISTRY commands are fixed strings — situation data NEVER reaches the shell.
 *
 * @param {number} situationId
 * @param {string} actor  — email or label for audit trail
 * @param {{ control?: Function, runOnHostFn?: Function, clearQueue?: Function, nowIso?: string }} [opts]  — injectable for tests
 * @returns {Promise<{ ok: boolean, result?: string, error?: string }>}
 */
export async function applyRemediation(situationId, actor, { control = _controlService, runOnHostFn = runOnHost, clearQueue = _clearDeployQueue, nowIso } = {}) {
  const situation = stmtGetSituation.get(situationId);
  if (!situation) return { ok: false, error: "situation not found" };

  const reg = situation.suggested_remediation ? REGISTRY[situation.suggested_remediation] : null;
  if (!reg) return { ok: false, error: "no remediation" };

  const at = nowIso ?? new Date().toISOString();
  let ok = false;
  let result = "";
  try {
    if (reg.command === "coolify-restart") {
      // ponytail: situation.target must be an app UUID — only service.unhealthy maps here, and its target IS the uuid
      await control(situation.target, "restart");
      result = `restarted ${situation.target}`;
    } else if (reg.command === "coolify-clear-queue") {
      // situation.target is the app uuid (deploy.zombie sets it that way). A row opened
      // before that change carries a NAME instead, which resolves to nothing — report the
      // 0 honestly rather than logging a success that cleared nothing.
      const { cleared } = await clearQueue(situation.target);
      result = cleared
        ? `cleared ${cleared} stuck deploy(s) for ${situation.target}`
        : `no stuck deploys found for ${situation.target} — nothing cleared`;
    } else {
      // ponytail: REGISTRY command is a fixed string — situation data never interpolated into it
      result = String(await runOnHostFn(reg.command) ?? "");
    }
    ok = true;
  } catch (e) {
    result = e.message ?? String(e);
  }
  // ponytail: log written on both success and failure — intentional audit trail of every remediation attempt
  stmtLogRemediation.run(situationId, situation.suggested_remediation, actor, reg.command, ok ? 1 : 0, result.slice(0, 1000), at);
  return ok ? { ok: true, result } : { ok: false, error: result };
}
