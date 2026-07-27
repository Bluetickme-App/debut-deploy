// Outbound SMTP — the panel sending mail *as* a mailbox on our own mail server.
// Currently one caller: the mailbox password-reset flow, which has to reach a user who is
// by definition locked out of the mailbox we host for them.
//
//   MAIL_SMTP_USER   admin@debutdepoly.com   (a real mailbox; also the From address)
//   MAIL_SMTP_PASS   <its password>
//   MAIL_SMTP_HOST   defaults to MAIL_HOSTNAME
//   MAIL_SMTP_PORT   defaults to 587 (STARTTLS). 465 switches to implicit TLS.
//   MAIL_FROM_NAME   defaults to "DebutDeploy"
//
// Unconfigured is a first-class state, exactly like mail.js: isConfigured() is false and
// send() throws 503 rather than hanging a request on a TCP connect that will never work.

import nodemailer from "nodemailer";
import { MAIL_HOSTNAME } from "./mail.js";

const USER = process.env.MAIL_SMTP_USER || "";
const PASS = process.env.MAIL_SMTP_PASS || "";
const HOST = process.env.MAIL_SMTP_HOST || MAIL_HOSTNAME;
const PORT = Number(process.env.MAIL_SMTP_PORT || 587);
const FROM_NAME = process.env.MAIL_FROM_NAME || "DebutDeploy";

export const isConfigured = () => !!(USER && PASS && HOST);
export const fromAddress = () => USER;

// One lazily-built pooled transport. Built on first send so an unconfigured deploy pays
// nothing, and so a credential fix only needs a restart, not a code change.
let _tx;
function transport() {
  if (!_tx) {
    _tx = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,        // 465 = implicit TLS; 587 = STARTTLS (upgraded below)
      requireTLS: PORT !== 465,    // refuse to send in the clear if STARTTLS is unavailable
      auth: { user: USER, pass: PASS },
      pool: true,
      maxConnections: 2,
    });
  }
  return _tx;
}

/**
 * Send one message. Throws 503 when SMTP isn't configured — callers decide whether that
 * is fatal or merely means "we couldn't notify them".
 * @param {{to:string, subject:string, text:string, html?:string}} msg
 */
export async function send({ to, subject, text, html }) {
  if (!isConfigured()) {
    throw Object.assign(
      new Error("Outbound email not configured — set MAIL_SMTP_USER + MAIL_SMTP_PASS"),
      { status: 503 }
    );
  }
  const info = await transport().sendMail({
    from: `"${FROM_NAME}" <${USER}>`,
    to, subject, text, ...(html ? { html } : {}),
  });
  return { messageId: info.messageId, accepted: info.accepted };
}

// Proves the credentials + TLS actually work, without sending anything. Used by the
// admin health check so a broken password surfaces before a user needs a reset.
export async function verify() {
  if (!isConfigured()) return { ok: false, error: "not configured" };
  try { await transport().verify(); return { ok: true, host: HOST, port: PORT, from: USER }; }
  catch (e) { return { ok: false, error: e.message, host: HOST, port: PORT }; }
}
