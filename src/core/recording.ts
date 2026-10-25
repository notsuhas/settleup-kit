import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

interface IState<I> {
  inputs: I[];
  fingerprint: string;
  ids: (string | null)[];
  pending: number[];
}

export function createRecorder<I, O extends { id: string }>(config: {
  directory(inputs: I[]): Promise<string>;
  list(inputs: I[]): Promise<O[]>;
  identity(row: O, input: I): boolean;
  verify(row: O, input: I): void;
  create(inputs: I[]): Promise<O[]>;
  creationIsServerReadback?: boolean;
  validate?(inputs: I[], rows: O[]): Promise<void>;
}) {
  const running = new Map<string, { fingerprint: string; result: Promise<O[]> }>();
  return function record(receiptId: string, inputs: I[]): Promise<O[]> {
    const fingerprint = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
    const current = running.get(receiptId);
    if (current) {
      if (current.fingerprint !== fingerprint)
        return Promise.reject(new Error("Receipt ID has conflicting input"));
      return current.result;
    }
    const result = execute(receiptId, inputs, fingerprint).finally(() => running.delete(receiptId));
    running.set(receiptId, { fingerprint, result });
    return result;
  };

  async function execute(receiptId: string, inputs: I[], fingerprint: string): Promise<O[]> {
    const directory = await config.directory(inputs);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const key = createHash("sha256").update(receiptId).digest("hex");
    const path = join(directory, `${key}.json`);
    const lock = join(directory, "writer.lock");
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      throw new Error("Receipt is locked by another process; reconcile before retrying");
    }
    try {
      let state: IState<I>;
      try {
        state = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        state = { inputs, fingerprint, ids: inputs.map(() => null), pending: [] };
      }
      if (state.fingerprint !== fingerprint || state.ids.length !== inputs.length)
        throw new Error("Receipt ID has conflicting input");
      const save = () => {
        const temporary = `${path}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flush: true });
        renameSync(temporary, path);
        const descriptor = openSync(directory, "r");
        try {
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      };
      const select = (all: O[], input: I, index: number): O | undefined => {
        const candidates = all.filter(
          (row) => config.identity(row, input) || row.id === state.ids[index],
        );
        if (candidates.length > 1)
          throw new Error("Ambiguous duplicate receipt; no write attempted");
        const row = candidates[0];
        if (row) config.verify(row, input);
        if (!row && (state.ids[index] || state.pending.includes(index)))
          throw new Error("Previous write is missing or uncertain; reconcile before retrying");
        if (row && state.ids[index] && row.id !== state.ids[index])
          throw new Error("Indexed receipt changed identity; reconcile before retrying");
        return row;
      };
      const before = await config.list(inputs);
      const existing = inputs.map((input, index) => select(before, input, index));
      const identities = existing.filter((row): row is O => Boolean(row)).map((row) => row.id);
      if (new Set(identities).size !== identities.length)
        throw new Error("Repeated entries in receipt");
      const missing = inputs.flatMap((input, index) => {
        const row = existing[index];
        if (row) state.ids[index] = row.id;
        return row ? [] : [{ input, index }];
      });
      await config.validate?.(
        missing.map((item) => item.input),
        before,
      );
      state.pending = missing.map((item) => item.index);
      save();
      let written: O[] = [];
      if (missing.length) {
        const created = await config.create(missing.map((item) => item.input));
        if (created.length !== missing.length || created.some((row) => !row.id))
          throw new Error("Write returned incomplete IDs; reconcile before retrying");
        for (const [index, row] of created.entries()) {
          const target = missing[index];
          if (!target) throw new Error("Incomplete batch response");
          state.ids[target.index] = row.id;
        }
        written = created;
        state.pending = [];
        save();
      }
      const final = missing.length
        ? config.creationIsServerReadback
          ? [...before, ...written]
          : await config.list(inputs)
        : before;
      return inputs.map((input, index) => {
        const row = select(final, input, index);
        if (!row) throw new Error("Receipt verification failed");
        return row;
      });
    } finally {
      rmSync(lock, { recursive: true });
    }
  }
}
