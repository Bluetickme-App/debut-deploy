# Task 4: `placeResourceInEnvironment` Service — Report

## Summary

Implemented the single, validated writer for `resource_ownership.environment_id` that ensures both resource ownership and environment org-membership before placement.

## What was done

1. **Created `server/test_placement.mjs`** — Test file with 4 tests covering:
   - Successful placement of an owned resource into an org's environment
   - Rejection (404) when placing into another org's environment
   - Rejection (404) when placing a resource the caller doesn't own
   - Rejection (400) when non-admin tries to unplace (`environmentId: null`)

2. **Created `server/placement.js`** — Service function `placeResourceInEnvironment({ user, type, resourceUuid, environmentId })` that:
   - Calls `assertOwns()` first (404 if caller's org doesn't own the resource)
   - On unplace (`environmentId === null`), requires admin role (400 if not)
   - Resolves the target environment via `getEnvironmentWithOrg()`; 404 if missing
   - For non-admin users, validates the environment's org matches the caller's org (404 if not)
   - Updates `resource_ownership.environment_id` via prepared statement
   - Returns `{ ok: true }`

## Test command & output

```
node --test server/test_placement.mjs
```

All 4 tests passed:
```
TAP version 13
# Subtest: places an owned resource into an env in the caller's org
ok 1 - places an owned resource into an env in the caller's org
# Subtest: rejects placing into another org's environment (404)
ok 2 - rejects placing into another org's environment (404)
# Subtest: rejects placing a resource the caller doesn't own (404)
ok 3 - rejects placing a resource the caller doesn't own (404)
# Subtest: non-admin cannot unplace (environmentId null)
ok 4 - non-admin cannot unplace (environmentId null)
1..4
# tests 4
# pass 4
# fail 0
```

## Deviations

None. The code follows the exact spec from the plan without modifications.

## Commit

**Short-SHA:** `4cb3770`  
**Message:** `feat(grouping): placeResourceInEnvironment service (single validated writer)`
