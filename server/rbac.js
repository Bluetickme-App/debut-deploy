// Capability ladder: each role includes every level at or below its own rank.
const RANK = { viewer: 1, deployer: 2, manager: 3, owner: 4 };
const NEED = { read: 1, deploy: 2, manage: 3, owner: 4 };

export function hasCapability(role, level) {
  const have = RANK[role] || 0;
  const need = NEED[level];
  return need != null && have >= need;
}
