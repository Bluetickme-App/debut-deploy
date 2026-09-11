// Is a domain actually serving a certificate a browser will accept?
//
// Nothing else in the fleet check can answer this. A site with a self-signed cert is
// healthy by every other measure — container up, HTTP 200 — while every visitor gets a
// full-page security warning. That gap is real: Traefik asks Let's Encrypt for a cert
// when a route first appears, and if that attempt fails (DNS still pointing elsewhere,
// ACME rate limit) it backs off. Fixing the underlying cause re-triggers nothing, so the
// placeholder cert is served indefinitely until somebody restarts the app by hand.
//
// Pure classification (classifyCert) is split from the socket work (probeCertificate) so
// the decision table is unit-testable without a network.
import tls from "node:tls";

/** Renew well before the 30-day mark Let's Encrypt itself starts nagging about. */
export const CERT_EXPIRY_WARN_DAYS = 14;

const CONNECT_TIMEOUT_MS = 5000;

function issuerName(issuer) {
  if (!issuer || typeof issuer !== "object") return null;
  return issuer.CN || issuer.O || null;
}

/**
 * Decide what a peer certificate means. Trust is judged by `authorized` — the TLS
 * stack's own chain validation — rather than by pattern-matching issuer names, so this
 * catches an expired cert, a wrong-hostname cert and Traefik's self-signed default
 * alike, without a list of strings to keep current.
 *
 * @returns {{state: "ok"|"untrusted"|"expiring", detail?: string, daysLeft?: number}}
 */
export function classifyCert({ authorized, authorizationError, validTo, issuer }, nowMs = Date.now()) {
  if (!authorized) {
    const cn = issuerName(issuer);
    return {
      state: "untrusted",
      detail: cn ? `untrusted certificate, issued by "${cn}"` : String(authorizationError || "certificate did not validate"),
    };
  }
  const expiresMs = Date.parse(validTo);
  if (Number.isFinite(expiresMs)) {
    const daysLeft = Math.floor((expiresMs - nowMs) / 86_400_000);
    if (daysLeft <= CERT_EXPIRY_WARN_DAYS) {
      return { state: "expiring", daysLeft, detail: `certificate expires in ${daysLeft} day(s)` };
    }
  }
  return { state: "ok" };
}

/**
 * Probe one domain's TLS certificate. Never rejects: an unreachable host resolves as
 * `unknown`, deliberately distinct from `untrusted`. They are different faults with
 * different fixes, and conflating them would have the auto-remediator restarting apps
 * over a network blip — the classic monitoring own-goal where the cure causes outages.
 *
 * rejectUnauthorized is false on purpose. Rejecting would close the socket before the
 * certificate could be read, and reading the bad certificate is the entire job.
 */
export function probeCertificate(domain, { connect = tls.connect, timeoutMs = CONNECT_TIMEOUT_MS, nowMs = Date.now } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({ domain, ...result });
    };

    let socket;
    try {
      socket = connect(
        { host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: timeoutMs },
        () => {
          let result;
          try {
            const cert = socket.getPeerCertificate() || {};
            result = classifyCert(
              { authorized: socket.authorized, authorizationError: socket.authorizationError, validTo: cert.valid_to, issuer: cert.issuer },
              nowMs(),
            );
          } catch (e) {
            result = { state: "unknown", detail: e.message };
          }
          try { socket.destroy(); } catch { /* already gone */ }
          finish(result);
        },
      );
    } catch (e) {
      return finish({ state: "unknown", detail: e.message });
    }

    socket.on("error", (e) => finish({ state: "unknown", detail: e.message }));
    socket.on("timeout", () => {
      try { socket.destroy(); } catch { /* already gone */ }
      finish({ state: "unknown", detail: `no TLS response within ${timeoutMs}ms` });
    });
  });
}

/**
 * Which services are worth probing.
 *
 * sslip.io hostnames are excluded by design: they encode an IP in a shared public
 * suffix that Let's Encrypt rate-limits hard, so they realistically never hold a trusted
 * certificate. Alerting on them would be permanent noise, and with auto-remediation on it
 * would restart perfectly healthy apps forever. A domain carrying an explicit port is
 * skipped for the same reason — it is not a plain HTTPS vhost.
 */
export function certProbeTargets(services) {
  return (services ?? []).flatMap((s) => {
    const domain = String(s?.domain ?? "").trim().toLowerCase();
    if (!domain || domain.includes(":") || domain.includes("/")) return [];
    if (domain.endsWith(".sslip.io") || domain.endsWith(".nip.io")) return [];
    if (!domain.includes(".")) return [];
    return [{ uuid: s.uuid, name: s.name ?? domain, domain }];
  });
}

/** Probe every worthwhile domain in parallel. Best-effort: failures come back as `unknown`. */
export async function probeServiceCerts(services, opts = {}) {
  const targets = certProbeTargets(services);
  return Promise.all(
    targets.map(async (t) => ({ uuid: t.uuid, name: t.name, ...(await probeCertificate(t.domain, opts)) })),
  );
}
