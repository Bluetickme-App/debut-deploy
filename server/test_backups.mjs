// Tests for server/backups.js — run: node --test server/test_backups.mjs
// Uses demo mode so no live Coolify needed.

import { test } from "node:test";
import assert from "node:assert/strict";

// Force demo mode before importing the module
process.env.DEMO_MODE = "true";
process.env.COOLIFY_BASE_URL = "http://localhost:9999"; // unused in demo
process.env.COOLIFY_API_TOKEN = "dummy";

const { getBackupConfig, setBackupSchedule, triggerBackup } = await import("./backups.js");

test("getBackupConfig returns { enabled: false } for unconfigured DB in demo", async () => {
  const r = await getBackupConfig("db-unknown");
  assert.deepEqual(r, { enabled: false });
});

test("setBackupSchedule rejects empty frequency with 400", async () => {
  await assert.rejects(
    () => setBackupSchedule("db-postgres", { frequency: "" }),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /frequency is required/);
      return true;
    }
  );
});

test("setBackupSchedule rejects missing frequency with 400", async () => {
  await assert.rejects(
    () => setBackupSchedule("db-postgres", {}),
    (err) => {
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test("setBackupSchedule demo returns ok", async () => {
  const r = await setBackupSchedule("db-postgres", { frequency: "0 2 * * *" });
  assert.deepEqual(r, { ok: true });
});

test("getBackupConfig returns config after setBackupSchedule in demo", async () => {
  await setBackupSchedule("db-postgres", { frequency: "0 3 * * *", s3StorageUuid: "s3-uuid-1" });
  const r = await getBackupConfig("db-postgres");
  assert.equal(r.enabled, true);
  assert.equal(r.frequency, "0 3 * * *");
  assert.equal(r.s3StorageUuid, "s3-uuid-1");
});

test("triggerBackup returns ok in demo", async () => {
  const r = await triggerBackup("db-postgres");
  assert.deepEqual(r, { ok: true });
});
