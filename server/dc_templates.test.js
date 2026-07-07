process.env.COOLIFY_BASE_URL = "http://167.233.206.184:8000";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { recordsFor } = await import("./domainconnect.js");
const { expectedIp } = await import("./dns.js");

const DOMAIN = "acme.com";

// Map a Domain Connect template record to our canonical shape.
function norm(rec) {
  const name = rec.host === "@" ? DOMAIN : `${rec.host}.${DOMAIN}`;
  let value;
  if (rec.type === "MX") value = `${rec.priority} ${rec.pointsTo}`;
  else if (rec.type === "CNAME") value = rec.pointsTo === "@" ? DOMAIN : rec.pointsTo;
  else value = rec.data ?? rec.pointsTo;
  value = value.replaceAll("%domain%", DOMAIN).replaceAll("%ip%", expectedIp);
  return { type: rec.type, name, value };
}

const strip = (recs) => recs.map((r) => ({ type: r.type, name: r.name, value: r.value }))
  .sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));

for (const [kind, file] of [["mail", "./templates/debutdeploy.com.mail.json"], ["hosting", "./templates/debutdeploy.com.hosting.json"]]) {
  test(`${kind} template matches recordsFor (no drift)`, async () => {
    const tpl = JSON.parse(await readFile(new URL(file, import.meta.url)));
    assert.equal(tpl.providerId, "debutdeploy.com");
    assert.equal(tpl.serviceId, kind);
    assert.deepEqual(strip(tpl.records.map(norm)), strip(recordsFor(kind, DOMAIN)));
  });
}
