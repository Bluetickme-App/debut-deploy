// Keeps the panel's mail billing tables in step with what the mail server actually hosts.
//
// Why this exists: the monthly charge counts mailboxes via mailChargePence(), which reads
// `SELECT COUNT(*) FROM mail_mailboxes WHERE org_id = ?`. Two things silently zero that out:
//
//   1. A domain or mailbox created straight in mailcow has NO row here at all, so it is
//      invisible to billing — it can never be charged, to anyone.
//   2. A domain with org_id NULL bills to nobody, and its mailbox rows inherit that NULL
//      at creation time, so assigning the domain later does not by itself fix the mailboxes.
//
// reconcile() closes both: it imports what's upstream and re-stamps every mailbox row from
// its domain's org. Idempotent — safe to run on a schedule or a button.

import { db } from "./db.js";
import * as _mail from "./mail.js";
import {
  setMailDomainOrg, getMailDomainOrg, addMailboxRow, deleteMailboxRow,
} from "./db.js";

const hasDomainRow = () => db.prepare("SELECT 1 FROM mail_domains WHERE domain = ?");
const hasMailboxRow = () => db.prepare("SELECT 1 FROM mail_mailboxes WHERE address = ?");

/**
 * Import upstream domains/mailboxes and re-stamp billing attribution.
 * @param {{ mail?: { listDomains: Function, listMailboxes: Function } }} [opts] — injectable for tests
 * @returns {Promise<{domainsAdded:number, mailboxesAdded:number, mailboxesRemoved:number,
 *                    mailboxesReStamped:number, unassigned:string[]}>}
 */
export async function reconcile({ mail = _mail } = {}) {
  const domainRow = hasDomainRow();
  const mailboxRow = hasMailboxRow();
  const summary = { domainsAdded: 0, mailboxesAdded: 0, mailboxesRemoved: 0, mailboxesReStamped: 0, unassigned: [] };

  const liveDomains = await mail.listDomains();
  const seen = new Set();
  const listedOk = new Set(); // domains whose mailbox listing actually SUCCEEDED

  for (const d of liveDomains) {
    if (!domainRow.get(d.domain)) { setMailDomainOrg(d.domain, null); summary.domainsAdded += 1; }
    const orgId = getMailDomainOrg(d.domain);
    if (orgId == null) summary.unassigned.push(d.domain);

    // A domain whose mailbox listing fails is skipped, NOT treated as empty — otherwise a
    // transient upstream error would delete every one of its rows as "gone upstream" below.
    let boxes;
    try { boxes = await mail.listMailboxes(d.domain); listedOk.add(d.domain); }
    catch { continue; }

    for (const m of boxes || []) {
      seen.add(m.address);
      if (!mailboxRow.get(m.address)) { addMailboxRow(m.address, d.domain, orgId); summary.mailboxesAdded += 1; }
      else {
        // `IS NOT` is null-safe in SQLite, so this catches null→org and org→null alike.
        summary.mailboxesReStamped += db
          .prepare("UPDATE mail_mailboxes SET org_id = ? WHERE address = ? AND org_id IS NOT ?")
          .run(orgId, m.address, orgId).changes;
      }
    }
  }

  // Stop billing for mailboxes deleted upstream — but ONLY within domains whose listing
  // succeeded. Gating on liveDomains instead would let one transient upstream error wipe
  // every row for that domain (its `seen` set is empty), silently zeroing real revenue.
  for (const row of db.prepare("SELECT address, domain FROM mail_mailboxes").all()) {
    if (!listedOk.has(row.domain)) continue;
    if (!seen.has(row.address)) { deleteMailboxRow(row.address); summary.mailboxesRemoved += 1; }
  }

  return summary;
}
