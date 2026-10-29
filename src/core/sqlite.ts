import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openPrivateDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (statSync(dirname(path)).mode & 0o022)
    throw new Error("SQLite needs a private directory that is not group/world writable");
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!lstatSync(path).isFile())
      throw new Error("SQLite path must be a regular file, not a symlink");
  }
  chmodSync(path, 0o600);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=100; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function sqlTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function tryLock(path: string): (() => void) | undefined {
  const db = openPrivateDatabase(path);
  db.exec("PRAGMA busy_timeout=0");
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === 5) return undefined;
    throw error;
  }
  return () => {
    try {
      db.exec("ROLLBACK");
    } finally {
      db.close();
    }
  };
}
