import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openPrivateDatabase, sqlTransaction } from "../sqlite.js";

test("sqlTransaction rethrows the original error when rollback fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "settleup-sqlite-"));
  try {
    const db = openPrivateDatabase(join(directory, "ledger.sqlite"));
    const originalExec = db.exec.bind(db);
    db.exec = ((sql: string) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return originalExec(sql);
    }) as typeof db.exec;
    const original = new Error("operation failed");
    assert.throws(
      () =>
        sqlTransaction(db, () => {
          throw original;
        }),
      (error: unknown) => error === original,
    );
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
