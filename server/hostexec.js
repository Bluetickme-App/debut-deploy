// Run privileged DB tooling on the Hetzner HOST over SSH (the host has docker; the
// app container doesn't, and we don't want to mount its socket). Config via env:
//   MIGRATION_SSH_HOST, MIGRATION_SSH_USER (default root), MIGRATION_SSH_KEY (PEM),
//   MIGRATION_SSH_PORT (default 22), PG_MIGRATE_DOCKER_NETWORK (default coolify).
import { Client } from "ssh2";
import { createHash, timingSafeEqual } from "node:crypto";

const DEMO = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";

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

// Run a `docker run postgres:18` command on the host. Secret values (connection
// URLs, SQL) pass as base64 env — only [A-Za-z0-9+/=], safe to interpolate — and
// are decoded INSIDE the container, so no secret ever appears in the shell command.
export async function dockerPg({ vars = {}, script }) {
  if (DEMO) return { ok: true, demo: true };
  const net = process.env.PG_MIGRATE_DOCKER_NETWORK || "coolify";
  const flags = Object.keys(vars).map((k) => `-e B64_${k}=${Buffer.from(String(vars[k])).toString("base64")}`).join(" ");
  const decode = Object.keys(vars).map((k) => `${k}=$(echo "$B64_${k}" | base64 -d)`).join("; ");
  await runOnHost(`docker run --rm --network ${net} ${flags} postgres:18 sh -c '${decode}; ${script}'`);
  return { ok: true };
}
