// Run privileged DB tooling on the Hetzner HOST over SSH (the host has docker; the
// app container doesn't, and we don't want to mount its socket). Config via env:
//   MIGRATION_SSH_HOST, MIGRATION_SSH_USER (default root), MIGRATION_SSH_KEY (PEM),
//   MIGRATION_SSH_PORT (default 22), PG_MIGRATE_DOCKER_NETWORK (default coolify).
import { Client } from "ssh2";
import { createHash, timingSafeEqual } from "node:crypto";

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

// Default pg client image for ADMIN SQL (CREATE DATABASE/ROLE, pg_isready) on the
// shared cluster, which is PG16. The dump/restore migration NO LONGER uses this — it
// picks an image matched to the SOURCE version (see detectPgMajor / migrate.js), so a
// PG18 Render source is read by a PG18 client. Override with PG_MIGRATE_IMAGE.
export const PG_IMAGE = process.env.PG_MIGRATE_IMAGE || "postgres:16";

// Verify the host key against a pinned SHA-256 (hex) to prevent MITM. Fails closed.
function makeHostVerifier() {
  const pinnedHex = (process.env.MIGRATION_SSH_HOSTKEY_SHA256 || "").replace(/[:\s]/g, "").toLowerCase();
  const pinned = pinnedHex ? Buffer.from(pinnedHex, "hex") : null;
  return (keyBlob) => {
    if (!pinned || !pinned.length) return false; // no pin configured → refuse
    const got = createHash("sha256").update(keyBlob).digest();
    return got.length === pinned.length && timingSafeEqual(got, pinned);
  };
}

export function runOnHost(command) {
  return new Promise((resolve, reject) => {
    const host = process.env.MIGRATION_SSH_HOST;
    const user = process.env.MIGRATION_SSH_USER || "root";
    const key = (process.env.MIGRATION_SSH_KEY || "").replace(/\\n/g, "\n");
    if (!host || !key) {
      return reject(Object.assign(new Error("DB migration host not configured (set MIGRATION_SSH_HOST + MIGRATION_SSH_KEY)"), { status: 501 }));
    }
    if (!process.env.MIGRATION_SSH_HOSTKEY_SHA256) {
      return reject(Object.assign(new Error("MIGRATION_SSH_HOSTKEY_SHA256 not set — refusing to connect without a pinned host key"), { status: 501 }));
    }
    const conn = new Client();
    let out = "", err = "";
    conn
      .on("ready", () => {
        conn.exec(command, (e, stream) => {
          if (e) { conn.end(); return reject(e); }
          stream
            .on("close", (code) => {
              conn.end();
              if (code === 0) resolve(out);
              else reject(Object.assign(new Error(`host command exit ${code}: ${err.slice(-500)}`), { status: 500 }));
            })
            .on("data", (d) => { out += d; })
            .stderr.on("data", (d) => { err += d; });
        });
      })
      .on("error", (e) => reject(Object.assign(new Error(`SSH to migration host failed: ${e.message}`), { status: 502 })))
      .connect({
        host,
        port: Number(process.env.MIGRATION_SSH_PORT || 22),
        username: user,
        privateKey: key,
        readyTimeout: 15000,
        hostVerifier: makeHostVerifier(), // pinned SHA-256 of the host key (MITM guard)
        algorithms: { serverHostKey: ["ssh-ed25519"] }, // match the key type we fingerprinted
      });
  });
}

// Live container stats for a service (Coolify has no metrics API). Runs `docker
// stats` on the host for the app's container(s). uuid is sanitised before use.
export async function getContainerStats(uuid) {
  if (DEMO) return [{ name: uuid + "-demo", cpu: "3.20%", mem: "48MiB / 512MiB", memPerc: "9.4%" }];
  const u = String(uuid).replace(/[^a-z0-9]/gi, "");
  if (!u) return [];
  const out = await runOnHost(`IDS=$(docker ps -q --filter name=${u}); if [ -n "$IDS" ]; then docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' $IDS; fi`);
  return String(out).trim().split("\n").filter(Boolean).map((line) => {
    const [name, cpu, mem, memPerc] = line.split("|");
    return { name, cpu, mem, memPerc };
  });
}

// Real runtime logs via `docker logs` on the host — Coolify's log API is thin.
// Returns structured lines [{ time, level, message }] (newest last).
export async function getServiceLogs(uuid, { tail = 300 } = {}) {
  if (DEMO) return [{ time: new Date().toISOString(), level: "INFO", message: "demo log line" }];
  const u = String(uuid).replace(/[^a-z0-9]/gi, "");
  if (!u) return [];
  const n = Math.min(Math.max(Number(tail) || 300, 1), 2000);
  const out = await runOnHost(`CID=$(docker ps -q --filter name=${u} | head -1); if [ -n "$CID" ]; then docker logs --tail ${n} --timestamps $CID 2>&1; fi`);
  return String(out).split("\n").filter((l) => l.length).map((line) => {
    const m = line.match(/^(\S+?Z)\s?(.*)$/); // docker --timestamps prefix
    const time = m ? m[1] : null;
    const message = m ? m[2] : line;
    const level = /\b(error|exception|fatal|fail(ed|ure)?|panic)\b/i.test(message)
      ? "ERROR" : /\bwarn(ing)?\b/i.test(message) ? "WARN" : /\binfo\b/i.test(message) ? "INFO" : "LOG";
    return { time, level, message };
  });
}

// Run a `docker run ${PG_IMAGE}` command on the host. Secret values (connection
// URLs, SQL) pass as base64 env — only [A-Za-z0-9+/=], safe to interpolate — and
// are decoded INSIDE the container, so no secret ever appears in the shell command.
export async function dockerPg({ vars = {}, script, image = PG_IMAGE }) {
  if (DEMO) return { ok: true, demo: true, out: "" };
  const net = process.env.PG_MIGRATE_DOCKER_NETWORK || "coolify";
  const flags = Object.keys(vars).map((k) => `-e B64_${k}=${Buffer.from(String(vars[k])).toString("base64")}`).join(" ");
  const decode = Object.keys(vars).map((k) => `${k}=$(echo "$B64_${k}" | base64 -d)`).join("; ");
  // bash + pipefail so a failure in ANY stage of a pipe propagates. Without it,
  // `pg_dump | psql` hides a pg_dump abort (e.g. "server version mismatch" when the
  // source is newer than the pg client): psql gets empty input, exits 0, and the
  // migration reports success having copied ZERO rows. The image (Debian postgres)
  // has bash. `image` is chosen per-call so pg_dump can match the source version.
  const out = await runOnHost(`docker run --rm --network ${net} ${flags} ${image} bash -c 'set -o pipefail; ${decode}; ${script}'`);
  return { ok: true, out };
}

// Detect a Postgres server's MAJOR version over the wire (any psql can query any
// server for its version). Used to pick a pg_dump matching the source and to decide
// whether a restore is a cross-major downgrade. Returns an integer major, or NaN.
export async function detectPgMajor(url, { image = "postgres:18" } = {}) {
  if (DEMO) return 16;
  const { out } = await dockerPg({ image, vars: { U: url }, script: 'psql -Atqc "SHOW server_version_num" "$U"' });
  const n = parseInt(String(out).trim(), 10); // e.g. 180004 → 18
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 10000) : NaN;
}
