import { resolve4 } from "node:dns/promises";

const BASE = (process.env.COOLIFY_BASE_URL || "").replace(/\/$/, "");
export const expectedIp = BASE ? new URL(BASE).hostname : "";

export async function verifyDomain(fqdn) {
  if (!fqdn || typeof fqdn !== "string" || !/^[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(fqdn.trim())) {
    throw Object.assign(new Error("fqdn is required and must be a valid domain"), { status: 400 });
  }
  const instructions = `Create a DNS A record: ${fqdn} -> ${expectedIp}`;
  let resolvedIps = [];
  try {
    resolvedIps = await resolve4(fqdn.trim());
  } catch (err) {
    const ignorable = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "ECONNREFUSED", "ETIMEOUT"]);
    if (!ignorable.has(err.code)) throw err;
  }
  return { fqdn, expectedIp, resolvedIps, pointsToServer: resolvedIps.includes(expectedIp), instructions };
}
