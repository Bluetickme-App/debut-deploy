// node:test suite for server/mailreset.js — the security-critical half of self-service
// mailbox password reset. Run: node --test server/test_mailreset.mjs
//
// Dynamic imports: ESM hoists static ones above these env lines, which would open the real
// server/data/debut.db instead of :memory:.

process.env.DATABASE_FILE = ":memory:";
process.env.DEMO_MODE = "true";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { db } = await import("./db.js");
const {
  setRecoveryEmail, getRecoveryEmail, clearRecoveryEmail, maskEmail,
  createResetToken, peekToken, consumeToken, sweepTokens, resetEmail, TOKEN_TTL_MS,
} = await import("./mailreset.js");

const BOX = "paul@acme.com";
const RECOVERY = "paul.personal@gmail.com";

// ── recovery addresses ────────────────────────────────────────────────────────

test("stores and reads back a recovery address, lowercased", () => {
  setRecoveryEmail("Paul@ACME.com", "Paul.Personal@Gmail.com");
  assert.equal(getRecoveryEmail(BOX), RECOVERY);
  assert.equal(getRecoveryEmail("PAUL@acme.com"), RECOVERY, "lookup is case-insensitive");
});

test("rejects a recovery address equal to the mailbox — it would be unreadable when locked out", () => {
  assert.throws(() => setRecoveryEmail(BOX, BOX), (e) => e.status === 400);
  assert.throws(() => setRecoveryEmail(BOX, "PAUL@ACME.COM"), (e) => e.status === 400, "case-insensitive");
});

test("rejects malformed addresses on both sides", () => {
  assert.throws(() => setRecoveryEmail("not-an-email", RECOVERY), (e) => e.status === 400);
  assert.throws(() => setRecoveryEmail(BOX, "nope"), (e) => e.status === 400);
  assert.throws(() => setRecoveryEmail(BOX, ""), (e) => e.status === 400);
});

test("maskEmail hides the local part but keeps the domain recognisable", () => {
  assert.equal(maskEmail("paul.personal@gmail.com"), "p***l@gmail.com");
  assert.equal(maskEmail("jo@x.com"), "j@x.com");
  assert.ok(!maskEmail(RECOVERY).includes("personal"), "must not leak the full local part");
});

// ── tokens ────────────────────────────────────────────────────────────────────

test("no recovery address on file → no token (the caller still answers generically)", () => {
  assert.equal(createResetToken("stranger@acme.com"), null);
});

test("mints a usable token and stores ONLY its hash", () => {
  setRecoveryEmail(BOX, RECOVERY);
  const t = createResetToken(BOX);
  assert.ok(t.token && t.token.length >= 40);
  assert.equal(t.recoveryEmail, RECOVERY);

  const rows = db.prepare("SELECT token_hash FROM mailbox_reset_tokens WHERE address = ?").all(BOX);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, t.token, "raw token must never be stored");
  assert.equal(rows[0].token_hash, createHash("sha256").update(t.token).digest("hex"));
  assert.equal(peekToken(t.token).address, BOX);
});

test("a new request invalidates the previous unused link", () => {
  const first = createResetToken(BOX);
  const second = createResetToken(BOX);
  assert.equal(peekToken(first.token), null, "old link is dead");
  assert.equal(peekToken(second.token).address, BOX);
});

test("token is single-use", () => {
  const t = createResetToken(BOX);
  assert.equal(consumeToken(t.token), BOX);
  assert.throws(() => consumeToken(t.token), (e) => e.status === 400 && /already been used|invalid/i.test(e.message));
});

test("expired token is refused", () => {
  const t = createResetToken(BOX, { ttlMs: -1000 }); // already in the past
  assert.equal(peekToken(t.token), null);
  assert.throws(() => consumeToken(t.token), (e) => e.status === 400);
});

test("garbage and empty tokens are refused, not crashed on", () => {
  assert.equal(peekToken("nope"), null);
  assert.equal(peekToken(""), null);
  assert.equal(peekToken(undefined), null);
  assert.throws(() => consumeToken("nope"), (e) => e.status === 400);
});

test("clearing the recovery address stops any future reset", () => {
  setRecoveryEmail(BOX, RECOVERY);
  assert.equal(clearRecoveryEmail(BOX), 1);
  assert.equal(getRecoveryEmail(BOX), null);
  assert.equal(createResetToken(BOX), null);
});

test("sweepTokens removes spent and expired rows, keeps live ones", () => {
  db.exec("DELETE FROM mailbox_reset_tokens");
  setRecoveryEmail("a@acme.com", RECOVERY);
  setRecoveryEmail("b@acme.com", RECOVERY);
  const spent = createResetToken("a@acme.com");
  consumeToken(spent.token);
  createResetToken("b@acme.com"); // live
  const removed = sweepTokens();
  assert.equal(removed, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM mailbox_reset_tokens").get().c, 1);
});

test("the email body carries the link and never the mailbox password", () => {
  const url = "https://app.debutdepoly.com/mail/reset?token=abc";
  const m = resetEmail({ address: BOX, url, expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() });
  assert.match(m.subject, /paul@acme\.com/);
  assert.ok(m.text.includes(url));
  assert.match(m.text, /60 minutes|59 minutes/);
  assert.match(m.text, /didn't request this/i, "tells an unexpecting recipient they can ignore it");
});
