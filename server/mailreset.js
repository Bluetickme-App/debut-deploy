// Self-service mailbox password reset.
//
// The problem this solves: a user locked out of the mailbox we host cannot be emailed at
// that mailbox, and mailcow stores only a password hash so nothing can be "sent back to
// them". So each mailbox may register a RECOVERY address elsewhere (their personal email),
// and a reset is a signed, single-use, expiring token delivered there.
//
// Own tables, created outside db.js's user_version ladder — same pattern as envstore.js /
// vargroups.js, and it keeps this off a file another workstream is editing.
//
// Security shape (deliberate, please keep):
//   * Only the token HASH is stored. A database read cannot mint a working link.
//   * Single-use: consumed atomically, so a leaked link in a browser history or a mail
//     scanner's prefetch cannot be replayed.
//   * Short TTL (1h) — long enough for a real person, short enough to limit exposure.
//   * requestReset NEVER reveals whether a mailbox or recovery address exists; the caller
//     returns an identical response either way (no account enumeration).

import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS mailbox_recovery (
    address        TEXT PRIMARY KEY,
    recovery_email TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mailbox_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    address    TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mailbox_reset_address ON mailbox_reset_tokens(address);
`);

export const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const hash = (raw) => createHash("sha256").update(String(raw)).digest("hex");
const nowIso = () => new Date().toISOString();
const err = (m, status) => Object.assign(new Error(m), { status });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

// --- recovery addresses ------------------------------------------------------

export function setRecoveryEmail(address, recoveryEmail) {
  const addr = String(address).toLowerCase();
  const rec = String(recoveryEmail || "").trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) throw err("A valid mailbox address is required", 400);
  if (!EMAIL_RE.test(rec)) throw err("A valid recovery email address is required", 400);
  // A recovery address inside the mailbox being recovered is useless — the user can't read
  // it while locked out. Reject rather than silently accept a dead-end.
  if (rec === addr) throw err("The recovery address must be different from the mailbox itself", 400);
  db.prepare(
    "INSERT INTO mailbox_recovery (address, recovery_email, updated_at) VALUES (?,?,?) " +
    "ON CONFLICT(address) DO UPDATE SET recovery_email = excluded.recovery_email, updated_at = excluded.updated_at"
  ).run(addr, rec, nowIso());
  return { address: addr, recoveryEmail: rec };
}

export const getRecoveryEmail = (address) =>
  db.prepare("SELECT recovery_email FROM mailbox_recovery WHERE address = ?")
    .get(String(address).toLowerCase())?.recovery_email ?? null;

export const clearRecoveryEmail = (address) =>
  db.prepare("DELETE FROM mailbox_recovery WHERE address = ?").run(String(address).toLowerCase()).changes;

// Masked for display, so the request page can say where the mail went without disclosing
// the full address to whoever typed the mailbox name. j***n@example.com
export function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  const shown = local.length <= 2 ? local[0] || "" : local[0] + "***" + local[local.length - 1];
  return `${shown}@${domain}`;
}

// --- tokens ------------------------------------------------------------------

/**
 * Mint a reset token for a mailbox that HAS a recovery address.
 * Returns null when there's no recovery address on file — the caller must still respond
 * identically to the success case, or it becomes an enumeration oracle.
 * @returns {{token:string, recoveryEmail:string, expiresAt:string}|null}
 */
export function createResetToken(address, { ttlMs = TOKEN_TTL_MS } = {}) {
  const addr = String(address).toLowerCase();
  const recoveryEmail = getRecoveryEmail(addr);
  if (!recoveryEmail) return null;

  // Any earlier unused token for this mailbox is void — requesting a new link should
  // invalidate the old one, so a forwarded/leaked earlier mail stops working.
  db.prepare("DELETE FROM mailbox_reset_tokens WHERE address = ? AND used_at IS NULL").run(addr);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(
    "INSERT INTO mailbox_reset_tokens (token_hash, address, expires_at, created_at) VALUES (?,?,?,?)"
  ).run(hash(token), addr, expiresAt, nowIso());
  return { token, recoveryEmail, expiresAt };
}

/** Look a token up without spending it — for rendering the "set a new password" form. */
export function peekToken(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM mailbox_reset_tokens WHERE token_hash = ?").get(hash(token));
  if (!row || row.used_at) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return { address: row.address, expiresAt: row.expires_at };
}

/**
 * Spend a token. Marks it used in the SAME statement that checks it is unused, so two
 * concurrent submissions can't both win (better-sqlite3 is synchronous + single-connection,
 * and the guard is in the WHERE clause rather than a separate read).
 * @returns {string} the mailbox address
 */
export function consumeToken(token) {
  const row = peekToken(token);
  if (!row) throw err("This reset link is invalid or has expired. Request a new one.", 400);
  const spent = db.prepare(
    "UPDATE mailbox_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL"
  ).run(nowIso(), hash(token)).changes;
  if (!spent) throw err("This reset link has already been used. Request a new one.", 400);
  return row.address;
}

// Housekeeping: drop spent/expired rows. Called opportunistically on request.
export function sweepTokens() {
  return db.prepare("DELETE FROM mailbox_reset_tokens WHERE used_at IS NOT NULL OR expires_at <= ?")
    .run(nowIso()).changes;
}

// --- the message -------------------------------------------------------------

export function resetEmail({ address, url, expiresAt }) {
  const mins = Math.max(1, Math.round((Date.parse(expiresAt) - Date.now()) / 60000));
  return {
    subject: `Reset the password for ${address}`,
    text: [
      `A password reset was requested for the mailbox ${address}.`,
      ``,
      `Open this link to set a new password (valid for ${mins} minutes, single use):`,
      url,
      ``,
      `If you didn't request this, you can ignore this email — the password is unchanged`,
      `and the link expires on its own.`,
    ].join("\n"),
  };
}
