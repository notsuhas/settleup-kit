import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRecorder } from "../recording.js";

interface IRow {
  id: string;
  name: string;
  amount: number;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "recording-test-"));
  let rows: IRow[] = [];
  let writes = 0;
  let reads = 0;
  let outcome: "ok" | "committed-timeout" | "unknown" | "partial" = "ok";
  const config = {
    directory: async () => directory,
    list: async () => {
      reads++;
      return structuredClone(rows);
    },
    identity: (row: IRow, input: Omit<IRow, "id">) => row.name === input.name,
    verify: (row: IRow, input: Omit<IRow, "id">) => {
      assert.equal(row.amount, input.amount);
    },
    create: async (inputs: Omit<IRow, "id">[]) => {
      writes++;
      if (outcome === "unknown") throw new Error("timeout");
      const made = inputs.map((input, index) => ({ ...input, id: `${writes}-${index}` }));
      rows.push(...(outcome === "partial" ? made.slice(0, 1) : made));
      if (outcome !== "ok") throw new Error("timeout");
      return made;
    },
  };
  return {
    make: () => createRecorder(config),
    rows: (value: IRow[]) => {
      rows = value;
    },
    outcome: (value: typeof outcome) => {
      outcome = value;
    },
    counts: () => ({ reads, writes }),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const inputs = [
  { name: "own", amount: -60 },
  { name: "lend", amount: -40 },
];

test("one batch verifies fresh data; retries survive restart and concurrent calls share work", async () => {
  const f = fixture();
  try {
    const record = f.make();
    const [first, concurrent] = await Promise.all([
      record("receipt", inputs),
      record("receipt", inputs),
    ]);
    assert.deepEqual(first, concurrent);
    assert.deepEqual(f.counts(), { reads: 2, writes: 1 });
    assert.deepEqual(await f.make()("receipt", inputs), first);
    assert.deepEqual(f.counts(), { reads: 3, writes: 1 });
    await assert.rejects(f.make()("receipt", [{ name: "own", amount: -99 }]), /conflicting/);
    f.rows([]);
    await assert.rejects(f.make()("receipt", inputs), /missing or uncertain/);
    assert.equal(f.counts().writes, 1);
  } finally {
    f.close();
  }
});

test("a committed timeout is reconciled through fresh reads without another write", async () => {
  const f = fixture();
  try {
    f.outcome("committed-timeout");
    await assert.rejects(f.make()("receipt", inputs), /timeout/);
    assert.equal((await f.make()("receipt", inputs)).length, 2);
    assert.equal(f.counts().writes, 1);
  } finally {
    f.close();
  }
});

for (const outcome of ["unknown", "partial"] as const)
  test(`${outcome} writes never retry missing entries automatically`, async () => {
    const f = fixture();
    try {
      f.outcome(outcome);
      await assert.rejects(f.make()("receipt", inputs), /timeout/);
      await assert.rejects(f.make()("receipt", inputs), /missing or uncertain/);
      assert.equal(f.counts().writes, 1);
    } finally {
      f.close();
    }
  });

test("duplicate and conflicting server rows stop before any mutation", async () => {
  const f = fixture();
  try {
    f.rows([
      { id: "one", name: "own", amount: -60 },
      { id: "two", name: "own", amount: -60 },
    ]);
    await assert.rejects(f.make()("receipt", inputs), /Ambiguous duplicate/);
    f.rows([{ id: "one", name: "own", amount: -99 }]);
    await assert.rejects(f.make()("receipt", inputs));
    assert.equal(f.counts().writes, 0);
  } finally {
    f.close();
  }
});
