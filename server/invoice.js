// Self-contained, printable HTML invoice for one org + period. No PDF dependency:
// the browser's "Save as PDF" turns this into a PDF. ponytail: HTML-print invoice;
// swap in a server-side PDF renderer only if a one-click PDF file is required.

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

// data: { issuer:{name}, org:{name}, info:{billing_email,billing_company,billing_vat},
//   period, invoiceNo, planLines:[{label,amount_pence}], planTotalPence,
//   usageLines:[{label,detail,pence}], charge:{amount_pence,created_at}|null, balancePence }
export function renderInvoiceHtml(d) {
  const planRows = d.planLines.map((l) =>
    `<tr><td>${esc(l.label)}</td><td class="r mono">${gbp(l.amount_pence)}</td></tr>`).join("") ||
    `<tr><td colspan="2" class="muted">No priced resources.</td></tr>`;

  const usageRows = d.usageLines.map((l) =>
    `<tr><td>${esc(l.label)}</td><td class="muted">${esc(l.detail)}</td><td class="r mono">${gbp(l.pence)}</td></tr>`).join("") ||
    `<tr><td colspan="3" class="muted">No metered usage.</td></tr>`;

  const paid = d.charge
    ? `Charged to account credit on ${esc(new Date(d.charge.created_at).toLocaleDateString("en-GB"))}.`
    : `Not yet charged for this period.`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Invoice ${esc(d.invoiceNo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; max-width: 720px; margin: 32px auto; padding: 0 24px; }
  .bar { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 28px; }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: #667; } .r { text-align: right; } .mono { font-variant-numeric: tabular-nums; }
  .parties { display:flex; justify-content:space-between; gap:24px; margin: 20px 0 28px; }
  .parties h3 { font-size: 11px; text-transform: uppercase; letter-spacing:.06em; color:#889; margin:0 0 4px; }
  table { width:100%; border-collapse: collapse; margin: 8px 0 20px; }
  th, td { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; text-align:left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing:.05em; color:#889; }
  .total { display:flex; justify-content:flex-end; }
  .total table { width: 280px; }
  .total .grand td { border-top: 2px solid #1a1a1a; border-bottom:none; font-weight:700; font-size: 15px; }
  .note { margin-top: 24px; color:#667; font-size: 13px; }
  .btn { display:inline-block; padding:8px 14px; background:#2563eb; color:#fff; border:none; border-radius:6px; cursor:pointer; font:inherit; }
  @media print { .noprint { display:none; } body { margin: 0; } }
</style></head><body>
  <div class="noprint" style="margin-bottom:16px"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
  <div class="bar">
    <div><h1>${esc(d.issuer.name)}</h1><div class="muted">Invoice</div></div>
    <div class="r"><div><strong>${esc(d.invoiceNo)}</strong></div><div class="muted">Period ${esc(d.period)}</div></div>
  </div>
  <div class="parties">
    <div><h3>Billed to</h3>
      <div>${esc(d.info?.billing_company || d.org.name)}</div>
      ${d.info?.billing_email ? `<div class="muted">${esc(d.info.billing_email)}</div>` : ""}
      ${d.info?.billing_vat ? `<div class="muted">VAT ${esc(d.info.billing_vat)}</div>` : ""}
    </div>
    <div class="r"><h3>Account</h3>
      <div>${esc(d.org.name)}</div>
      <div class="muted">Credit balance ${gbp(d.balancePence)}</div>
    </div>
  </div>

  <h3 class="muted" style="text-transform:uppercase;font-size:11px;letter-spacing:.05em">Plan charges</h3>
  <table><thead><tr><th>Resource / plan</th><th class="r">Monthly</th></tr></thead><tbody>${planRows}</tbody></table>

  <h3 class="muted" style="text-transform:uppercase;font-size:11px;letter-spacing:.05em">Usage this period (metered)</h3>
  <table><thead><tr><th>Dimension</th><th>Detail</th><th class="r">Amount</th></tr></thead><tbody>${usageRows}</tbody></table>

  <div class="total"><table>
    <tr><td>Plan total</td><td class="r mono">${gbp(d.planTotalPence)}</td></tr>
    <tr class="grand"><td>Total due</td><td class="r mono">${gbp(d.planTotalPence)}</td></tr>
  </table></div>

  <div class="note">${paid} Metered usage is shown for transparency; billing is the monthly plan total (prepaid from account credit).</div>
</body></html>`;
}
