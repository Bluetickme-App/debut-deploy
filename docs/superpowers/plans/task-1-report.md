# Task 1 Report: Migration 18

## What was done

1. Wrote `server/test_projects_migration.mjs` verbatim from the plan spec (5 tests covering: project/env creation, backfill placement, kind assignment, CHECK constraint rejection, CASCADE + SET NULL on delete).
2. Ran the test to confirm failure: `no such table: projects` (as expected).
3. Appended migration 18 to the `MIGRATIONS` array in `server/db.js` (index 17 → user_version 18) verbatim from the plan spec:
   - Creates `projects` and `environments` tables with FK cascades.
   - `ALTER TABLE resource_ownership ADD COLUMN environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL` — SQLite accepted this without issue.
   - `ALTER TABLE resource_ownership ADD COLUMN kind TEXT NOT NULL DEFAULT 'web_service' CHECK(...)` — SQLite accepted this without issue.
   - Three indexes created.
   - Backfill loop: one Default project + Production environment per org; all owned resources placed; databases set to `kind='postgres'`.
   - Validation guard: throws if any owned resource is left unplaced (rolls back the transaction).
4. Ran the new test: **5/5 pass**.
5. Ran existing DB tests: **28/28 pass** (no regression).
6. Committed.

## Test commands and output

### New test (after migration written)

```
node --test server/test_projects_migration.mjs
```

```
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 147.19
```

### Regression suite

```
node --test server/test_orgs_migration.mjs server/test_billing_migration.mjs server/test_migrate.mjs
```

```
1..28
# tests 28
# suites 0
# pass 28
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 283.71
```

## Deviations from plan

None. SQLite accepted both `ALTER TABLE ADD COLUMN … REFERENCES … ON DELETE SET NULL` and `ADD COLUMN … CHECK(…)` without issue. Code is verbatim from the plan.
