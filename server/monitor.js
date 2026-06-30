// Health-transition monitor — pure logic + thin runner.
// Wiring (setInterval) lives in index.js.
// VERIFY LIVE: Coolify status field names confirmed via coolify.js mapApp():
//   status = compound.split(":")[0], health = compound.split(":")[1]

/** @param {Array<{uuid,name,status,health}>} services */
export function snapshotOf(services) {
  const snap = {};
  for (const s of services) snap[s.uuid] = { name: s.name, status: s.status, health: s.health };
  return snap;
}

// Up = status "running" AND health is not "unhealthy" (missing health → treat as not-unhealthy)
function isUp(status, health) {
  return status === "running" && health !== "unhealthy";
}

function shortStatus(status, health) {
  return health ? `${status}:${health}` : status;
}

/**
 * @param {Record<string,{name,status,health}>} prev
 * @param {Array<{uuid,name,status,health}>} curr
 * @returns {Array<{uuid,name,from,to,down}>}
 */
export function diffStatuses(prev, curr) {
  const events = [];
  for (const svc of curr) {
    const p = prev[svc.uuid];
    if (!p) continue; // first sight → no event
    const wasUp = isUp(p.status, p.health);
    const nowUp = isUp(svc.status, svc.health);
    if (wasUp === nowUp) continue; // no state change
    events.push({
      uuid: svc.uuid,
      name: svc.name,
      from: shortStatus(p.status, p.health),
      to: shortStatus(svc.status, svc.health),
      down: !nowUp,
    });
  }
  return events;
}

/**
 * @param {{ listServices: () => Promise<Array>, prev?: object, onTransition?: Function }} opts
 * @returns {Promise<{ snapshot: object, transitions: Array, error?: true }>}
 */
export async function runHealthCheck({ listServices, prev = {}, onTransition }) {
  let current;
  try {
    current = await listServices();
  } catch {
    return { snapshot: prev, transitions: [], error: true };
  }
  const transitions = diffStatuses(prev, current);
  if (onTransition) {
    for (const t of transitions) await onTransition(t);
  }
  return { snapshot: snapshotOf(current), transitions };
}
