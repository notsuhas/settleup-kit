import assert from "node:assert/strict";
import { once } from "node:events";
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

test("legacy uncertain journals migrate without retrying a missing write", async () => {
  const { createHash } = await import("node:crypto");
  const { writeFileSync } = await import("node:fs");
  const directory = mkdtempSync(join(tmpdir(), "legacy-receipt-"));
  const input = [{ name: "own", amount: -60 }];
  const key = createHash("sha256").update("legacy").digest("hex");
  writeFileSync(
    join(directory, `${key}.json`),
    JSON.stringify({
      inputs: input,
      fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      ids: [null],
      pending: [0],
    }),
  );
  let creates = 0;
  let rows: IRow[] = [];
  const record = createRecorder({
    directory: async () => directory,
    list: async () => rows,
    identity: (row: IRow, value: Omit<IRow, "id">) => row.name === value.name,
    verify: () => {},
    create: async () => {
      creates++;
      return [];
    },
  });
  try {
    await assert.rejects(record("legacy", input), /missing or uncertain/);
    rows = [{ id: "saved", name: "own", amount: -60 }];
    assert.equal((await record("legacy", input))[0]?.id, "saved");
    assert.equal(creates, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("process death releases the writer lock while preserving pending receipt state", async () => {
  const { spawn } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "crashed-receipt-"));
  const moduleUrl = new URL("../recording.js", import.meta.url).href;
  const script = `import {createRecorder} from ${JSON.stringify(moduleUrl)}; const record=createRecorder({directory:async()=>${JSON.stringify(directory)},list:async()=>[],identity:()=>false,verify:()=>{},create:async()=>{process.send('pending');await new Promise(()=>{});return[];}}); setInterval(()=>{},1000); await record('crash',[{name:'own',amount:-60}]);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let created = 0;
  try {
    await once(child, "message", { signal: AbortSignal.timeout(10_000) });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const record = createRecorder({
      directory: async () => directory,
      list: async () => [],
      identity: () => false,
      verify: () => {},
      create: async () => {
        created++;
        return [];
      },
    });
    await assert.rejects(record("crash", [{ name: "own", amount: -60 }]), /missing or uncertain/);
    assert.equal(created, 0);
  } finally {
    child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});
