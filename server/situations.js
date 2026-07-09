// ponytail: pure evaluator — no DB/SSH; Task 3 will add DB helpers to this file
const DOWN_STATUSES = new Set(["exited", "stopped", "dead", "not_running", "paused"]);

export const DISK_WARN = 85;
export const DISK_CRIT = 92;
export const MEM_WARN = 90;
export const ZOMBIE_DEPLOY_SEC = 1200;
export const QUEUE_PILEUP = 3;

export const REGISTRY = {
  "prune-docker": {
    title: "Reclaim disk (prune images + build cache)",
    situationTypes: ["host.disk"],
    confidence: "high",
    command: "docker image prune -af --filter until=24h && docker builder prune -f --keep-storage 20GB",
  },
  "restart-service": {
    title: "Restart the unhealthy service",
    situationTypes: ["service.unhealthy"],
    confidence: "medium",
    // ponytail: routes through control_service, not a raw host cmd — see applyRemediation (Task 3)
    command: "coolify-restart",
  },
  "clear-deploy-queue": {
    title: "Clear the stuck deploy (restart coolify to reconcile)",
    situationTypes: ["deploy.zombie"],
    confidence: "high",
    command: "docker restart coolify",
  },
};

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
