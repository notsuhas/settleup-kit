import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Ledger } from "../ledger.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "local-ledger-"));
  const path = join(directory, "ledger.sqlite");
  let now = 1_800_000_000_000;
  return {
    directory,
    path,
    open: () => new Ledger(path, 1000, () => now),
    advance: (ms: number) => {
      now += ms;
    },
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
const data = (amount = 10) => ({ rows: [{ id: "one", amount }], metadata: { currency: "INR" } });

test("SQLite survives restart, serves local reads and atomically reconciles edits/deletions", async () => {
  const f = fixture();
  let ledger = f.open();
  let reads = 0;
  const load = async () => {
    reads++;
    return data();
  };
  try {
    assert.equal((await ledger.read("wallet", load)).sync.source, "api");
    assert.equal((await ledger.read("wallet", load)).sync.source, "ledger");
    assert.equal(reads, 1);
    ledger.close();
    ledger = f.open();
    assert.equal((await ledger.read("wallet", load)).rows[0]?.amount, 10);
    assert.equal(reads, 1);
    assert.equal((await ledger.read("wallet", async () => data(20), true)).rows[0]?.amount, 20);
    await ledger.read("wallet", async () => ({ rows: [], metadata: { currency: "INR" } }), true);
    assert.deepEqual((await ledger.read("wallet", load)).rows, []);
    assert.equal(statSync(f.path).mode & 0o777, 0o600);
    assert.equal(statSync(f.directory).mode & 0o777, 0o700);
  } finally {
    ledger.close();
    f.close();
  }
});

test("stale reads return immediately; failed background refresh retains rows and backs off", async () => {
  const f = fixture();
  const ledger = f.open();
  let reads = 0;
  let reject!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  try {
    await ledger.read("wallet", async () => data());
    f.advance(2000);
    const cached = await ledger.read("wallet", async () => {
      reads++;
      await failure;
      return data();
    });
    assert.equal(cached.sync.stale, true);
    assert.equal(cached.sync.refreshing, true);
    assert.equal(cached.rows[0]?.amount, 10);
    const waiting = ledger.read("wallet", async () => data(30), true);
    reject(new Error("offline"));
    await assert.rejects(waiting, /offline/);
    const retained = await ledger.read("wallet", async () => {
      reads++;
      return data(30);
    });
    assert.equal(retained.rows[0]?.amount, 10);
    assert.equal(retained.sync.lastError, "offline");
    assert.equal(retained.sync.refreshing, false);
    assert.equal(reads, 1);
    assert.equal((await ledger.read("wallet", async () => data(30), true)).rows[0]?.amount, 30);
  } finally {
    ledger.close();
    f.close();
  }
});

test("same-process and separate-connection cold reads share one complete reconciliation", async () => {
  const f = fixture();
  const a = f.open();
  const b = f.open();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = async () => {
    calls++;
    await gate;
    return data();
  };
  try {
    const first = a.read("wallet", load);
    const second = a.read("wallet", load);
    const third = b.read("wallet", load);
    release();
    const results = await Promise.all([first, second, third]);
    assert.equal(calls, 1);
    assert.ok(results.every((result) => result.rows.length === 1));
  } finally {
    a.close();
    b.close();
    f.close();
  }
});

test("a mutation discards an older in-flight refresh and invalidates every scope", async () => {
  const f = fixture();
  const a = f.open();
  const b = f.open();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  try {
    await a.read("other", async () => data());
    const pending = a.read("wallet", async () => {
      const value = ++calls;
      if (value === 1) await gate;
      return data(value);
    });
    b.invalidate();
    release();
    assert.equal((await pending).rows[0]?.amount, 2);
    assert.equal((await a.read("other", async () => data(99))).rows[0]?.amount, 99);
  } finally {
    a.close();
    b.close();
    f.close();
  }
});

test("failed or malformed complete snapshots never replace the previous ledger", async () => {
  const f = fixture();
  const ledger = f.open();
  try {
    await ledger.read("wallet", async () => data());
    await assert.rejects(
      ledger.read("wallet", async () => ({ rows: [{ id: "x" }, { id: "x" }], metadata: {} }), true),
      /duplicate IDs/,
    );
    await assert.rejects(
      ledger.read(
        "wallet",
        async () => {
          throw Error("page two failed");
        },
        true,
      ),
      /page two failed/,
    );
    assert.equal((await ledger.read("wallet", async () => data(99))).rows[0]?.amount, 10);
  } finally {
    ledger.close();
    f.close();
  }
});

test("permission revocation blocks cached results until a fresh authorized snapshot succeeds", async () => {
  const f = fixture();
  const ledger = f.open();
  const denied = async () => {
    throw Object.assign(Error("Permission denied"), { code: 403 });
  };
  try {
    await ledger.read("group", async () => data());
    await assert.rejects(ledger.read("group", denied, true), /Permission denied/);
    await assert.rejects(ledger.read("group", denied), /Permission denied/);
    const offline = async () => {
      throw Error("offline");
    };
    await assert.rejects(ledger.read("group", offline, true), /offline/);
    await assert.rejects(ledger.read("group", offline), /offline/);
    assert.equal(ledger.status()[0]?.blocked, true);
    assert.equal((await ledger.read("group", async () => data(20))).rows[0]?.amount, 20);
  } finally {
    ledger.close();
    f.close();
  }
});

test("clock rollback marks a snapshot stale; schema mismatch and corruption fail closed", async () => {
  const f = fixture();
  const ledger = f.open();
  try {
    await ledger.read("wallet", async () => data());
    f.advance(-1000);
    const cached = await ledger.read("wallet", async () => data());
    assert.equal(cached.sync.stale, true);
    await ledger.read("wallet", async () => data(), true);
  } finally {
    ledger.close();
  }
  const db = new DatabaseSync(f.path);
  db.exec("PRAGMA user_version=99");
  db.close();
  assert.throws(() => f.open(), /newer/);
  f.close();
  const bad = fixture();
  writeFileSync(bad.path, "not SQLite");
  try {
    assert.throws(() => bad.open());
  } finally {
    bad.close();
  }
});

test("SQLite refuses unsafe paths without changing shared directory permissions", async () => {
  const { chmodSync, symlinkSync } = await import("node:fs");
  const f = fixture();
  try {
    chmodSync(f.directory, 0o777);
    assert.throws(() => f.open(), /private directory/);
    assert.equal(statSync(f.directory).mode & 0o777, 0o777);
    chmodSync(f.directory, 0o700);
    const target = join(f.directory, "target");
    writeFileSync(target, "private");
    symlinkSync(target, f.path);
    assert.throws(() => f.open(), /symlink/);
  } finally {
    f.close();
  }
});

test("an explicit ledger path is bound to its original account and environment", async () => {
  const f = fixture();
  const first = new Ledger(f.path, 30_000, Date.now, "account-a-live");
  await first.read("groups", async () => data());
  first.close();
  try {
    assert.throws(
      () => new Ledger(f.path, 30_000, Date.now, "account-b-live"),
      /different account/,
    );
    assert.throws(
      () => new Ledger(f.path, 30_000, Date.now, "account-a-sandbox"),
      /different account/,
    );
    const same = new Ledger(f.path, 30_000, Date.now, "account-a-live");
    try {
      assert.equal(
        (
          await same.read("groups", async () => {
            throw Error("offline");
          })
        ).rows.length,
        1,
      );
    } finally {
      same.close();
    }
  } finally {
    f.close();
  }
});

test("request teardown drains background refresh before closing the database", async () => {
  const f = fixture();
  const ledger = f.open();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await ledger.read("wallet", async () => data());
    f.advance(2000);
    const stale = await ledger.read("wallet", async () => {
      await gate;
      return data(40);
    });
    assert.equal(stale.rows[0]?.amount, 10);
    let done = false;
    const closing = ledger.drain().then(() => {
      done = true;
      ledger.close();
    });
    await Promise.resolve();
    assert.equal(done, false);
    release();
    await closing;
    const reopened = f.open();
    try {
      assert.equal(
        (
          await reopened.read("wallet", async (): Promise<ReturnType<typeof data>> => {
            throw Error("offline");
          })
        ).rows[0]?.amount,
        40,
      );
    } finally {
      reopened.close();
    }
  } finally {
    release();
    ledger.close();
    f.close();
  }
});
