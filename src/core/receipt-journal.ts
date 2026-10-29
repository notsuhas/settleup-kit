import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openPrivateDatabase, tryLock } from "./sqlite.js";

export function openReceiptJournal<T>(
  directory: string,
  key: string,
): {
  read(): T | undefined;
  save(state: T): void;
  close(): void;
} {
  if (existsSync(join(directory, "writer.lock")))
    throw new Error(
      "Legacy receipt writer lock exists; stop old writers and reconcile before removing it",
    );
  const unlock = tryLock(join(directory, "writer.sqlite"));
  if (!unlock) throw new Error("Receipt is locked by another process; reconcile before retrying");
  let db: ReturnType<typeof openPrivateDatabase> | undefined;
  try {
    db = openPrivateDatabase(join(directory, "journal.sqlite"));
    const journal = db;
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, state TEXT NOT NULL) STRICT;",
    );
    return {
      read() {
        const stored = journal.prepare("SELECT state FROM receipts WHERE key=?").get(key);
        if (stored) return JSON.parse(String(stored.state)) as T;
        const legacy = join(directory, `${key}.json`);
        if (!existsSync(legacy)) return undefined;
        const state = JSON.parse(readFileSync(legacy, "utf8")) as T;
        journal.prepare("INSERT INTO receipts VALUES(?,?)").run(key, JSON.stringify(state));
        return state;
      },
      save(state) {
        journal
          .prepare(
            "INSERT INTO receipts VALUES(?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state",
          )
          .run(key, JSON.stringify(state));
      },
      close() {
        try {
          journal.close();
        } finally {
          unlock();
        }
      },
    };
  } catch (error) {
    db?.close();
    unlock();
    throw error;
  }
}
