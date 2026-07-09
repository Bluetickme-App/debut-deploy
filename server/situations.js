// ponytail: pure evaluator + DB lifecycle; Task 3 added reconcile/list below; Task 5 added applyRemediation
import { db } from "./db.js";
import { fleetOverview as _fleetOverview } from "./metrics.js";
import { runOnHost } from "./hostexec.js";
import { controlService as _controlService } from "./coolify.js";
const DOWN_STATUSES = new Set(["exited", "stopped", "dead", "not_running", "paused"]);

const DEPLOY_QUERY =
  "SELECT deployment_uuid, application_name, status, EXTRACT(EPOCH FROM (now()-created_at))::int" +
  " FROM application_deployment_queues WHERE status IN ('in_progress','queued')";

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
  try {
    const raw = await runOnHost(`docker exec coolify-db psql -U coolify -d coolify -tAF'|' -c "${DEPLOY_QUERY}"`);
    deploys = raw.split("\n").filter(Boolean).map((line) => {
      const [uuid, application_name, status, ageSec] = line.split("|");
      return { uuid, application_name, status, ageSec: Number(ageSec) };
    });
  } catch { /* best-effort: SSH down or no deploys table */ }
  return { host, sites, deploys };
}

export const DISK_WARN = 85;
export const DISK_CRIT = 92;
export const MEM_WARN = 90;
export const ZOMBIE_DEPLOY_SEC = 1200;
export const QUEUE_PILEUP = 3;

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
    title: "Clear the stuck deploy (restart coolify to reconcile)",
    situationTypes: ["deploy.zombie"],
    auto: true,
    confidence: "high",
    cooldownSec: 1800,
    command: "docker restart coolify",
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
    if (d.status === "in_progress" && d.ageSec > ZOMBIE_DEPLOY_SEC)
      out.push({ type: "deploy.zombie", target: d.application_name, severity: "crit", detail: `${d.application_name} deploy in_progress for ${d.ageSec}s`, suggested_remediation: "clear-deploy-queue" });
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
 * @param {{ control?: Function, runOnHostFn?: Function, nowIso?: string }} [opts]  — injectable for tests
 * @returns {Promise<{ ok: boolean, result?: string, error?: string }>}
 */
export async function applyRemediation(situationId, actor, { control = _controlService, runOnHostFn = runOnHost, nowIso } = {}) {
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
