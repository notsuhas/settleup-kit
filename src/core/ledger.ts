import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openPrivateDatabase, sqlTransaction, tryLock } from "./sqlite.js";

interface ISnapshot<T, M> {
  rows: T[];
  metadata: M;
  revision: string;
  syncedAt: number;
  epoch: number;
  blocked: boolean;
  failures: number;
  attemptedAt: number;
  error?: string;
}

export interface ILedgerSync {
  source: "api" | "ledger";
  lastSyncedAt: string;
  stale: boolean;
  refreshing: boolean;
  lastError?: string;
}

export class Ledger {
  private readonly db: DatabaseSync;
  private readonly running = new Map<string, Promise<void>>();
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly refreshAfterMs = 30_000,
    private readonly now = Date.now,
    identity?: string,
  ) {
    if (!Number.isFinite(refreshAfterMs) || refreshAfterMs < 0)
      throw new Error("Ledger refresh interval must be finite and nonnegative");
    this.db = openPrivateDatabase(path);
    try {
      const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version);
      if (version > 1) {
        throw new Error("Ledger schema is newer than this client");
      }
      this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS ledger_state (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL) STRICT;
      INSERT OR IGNORE INTO ledger_state VALUES(1,0);
      CREATE TABLE IF NOT EXISTS snapshots (
        scope TEXT PRIMARY KEY, revision TEXT NOT NULL, synced_at INTEGER NOT NULL,
        epoch INTEGER NOT NULL, metadata TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0, attempted_at INTEGER NOT NULL DEFAULT 0, error TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ledger_rows (
        scope TEXT NOT NULL REFERENCES snapshots(scope) ON DELETE CASCADE,
        id TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(scope,id)
      ) STRICT;
      PRAGMA user_version=1;
    `);
      if (identity)
        sqlTransaction(this.db, () => {
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS ledger_identity (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL) STRICT",
          );
          this.db.prepare("INSERT OR IGNORE INTO ledger_identity VALUES(1,?)").run(identity);
          const saved = this.db.prepare("SELECT identity FROM ledger_identity WHERE id=1").get();
          if (saved?.identity !== identity)
            throw new Error("Ledger belongs to a different account or environment");
        });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  invalidate(): void {
    this.db.exec("UPDATE ledger_state SET epoch=epoch+1 WHERE id=1");
  }

  private epoch(): number {
    return Number(this.db.prepare("SELECT epoch FROM ledger_state WHERE id=1").get()?.epoch);
  }

  private snapshot<T, M>(scope: string): ISnapshot<T, M> | undefined {
    this.db.exec("BEGIN");
    try {
      const header = this.db.prepare("SELECT * FROM snapshots WHERE scope=?").get(scope);
      if (!header) return undefined;
      const rows = this.db
        .prepare("SELECT payload FROM ledger_rows WHERE scope=? ORDER BY position")
        .all(scope);
      return {
        rows: rows.map((row) => JSON.parse(String(row.payload)) as T),
        metadata: JSON.parse(String(header.metadata)) as M,
        revision: String(header.revision),
        syncedAt: Number(header.synced_at),
        epoch: Number(header.epoch),
        blocked: Boolean(header.blocked),
        failures: Number(header.failures),
        attemptedAt: Number(header.attempted_at),
        ...(header.error ? { error: String(header.error) } : {}),
      };
    } finally {
      this.db.exec("COMMIT");
    }
  }

  private refresh<T extends { id: string }, M>(
    scope: string,
    load: () => Promise<{ rows: T[]; metadata: M }>,
  ): Promise<void> {
    const existing = this.running.get(scope);
    if (existing) return existing;
    const baseline = this.snapshot<T, M>(scope)?.revision;
    const operation = this.reconcile(scope, baseline, load).finally(() =>
      this.running.delete(scope),
    );
    this.running.set(scope, operation);
    return operation;
  }

  private async reconcile<T extends { id: string }, M>(
    scope: string,
    baseline: string | undefined,
    load: () => Promise<{ rows: T[]; metadata: M }>,
  ): Promise<void> {
    const hash = createHash("sha256").update(scope).digest("hex");
    const deadline = Date.now() + 300_000;
    let unlock: (() => void) | undefined;
    while (!unlock) {
      if (this.closed) throw new Error("Ledger closed");
      unlock = tryLock(`${this.path}.${hash}.refresh.sqlite`);
      if (!unlock) {
        if (Date.now() >= deadline) throw new Error("Ledger reconciliation is busy; retry later");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      const latest = this.snapshot<T, M>(scope);
      if (
        latest &&
        latest.revision !== baseline &&
        !latest.blocked &&
        latest.epoch === this.epoch()
      )
        return;
      for (let attempt = 0; attempt < 3; attempt++) {
        const epoch = this.epoch();
        const data = await load();
        if (this.closed) throw new Error("Ledger closed");
        const ids = data.rows.map((row) => row.id);
        if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
          throw new Error("Ledger snapshot contains missing or duplicate IDs");
        const metadata = JSON.stringify(data.metadata);
        const rows = data.rows.map((row) => JSON.stringify(row));
        const saved = sqlTransaction(this.db, () => {
          if (epoch !== this.epoch()) return false;
          const at = this.now();
          this.db
            .prepare(`INSERT INTO snapshots(scope,revision,synced_at,epoch,metadata) VALUES(?,?,?,?,?)
            ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,synced_at=excluded.synced_at,
            epoch=excluded.epoch,metadata=excluded.metadata,blocked=0,failures=0,attempted_at=0,error=NULL`)
            .run(scope, randomUUID(), at, epoch, metadata);
          this.db.prepare("DELETE FROM ledger_rows WHERE scope=?").run(scope);
          const insert = this.db.prepare("INSERT INTO ledger_rows VALUES(?,?,?,?)");
          data.rows.forEach((row, index) => {
            insert.run(scope, row.id, index, rows[index] ?? "null");
          });
          return true;
        });
        if (saved) return;
      }
      throw new Error("Ledger changed during reconciliation; retry the read");
    } catch (error) {
      if (!this.closed) {
        const code = (error as { code?: number | string }).code;
        const blocked =
          code === 401 ||
          code === 403 ||
          /permission denied|no longer belongs|unauthoriz|forbidden/i.test(String(error));
        this.db
          .prepare(
            `UPDATE snapshots SET error=?,attempted_at=?,failures=failures+1,blocked=MAX(blocked,?) WHERE scope=?`,
          )
          .run(
            error instanceof Error ? error.message : "Reconciliation failed",
            this.now(),
            blocked ? 1 : 0,
            scope,
          );
      }
      throw error;
    } finally {
      unlock();
    }
  }

  async read<T extends { id: string }, M>(
    scope: string,
    load: () => Promise<{ rows: T[]; metadata: M }>,
    fresh = false,
  ): Promise<{ rows: T[]; metadata: M; sync: ILedgerSync }> {
    if (this.closed) throw new Error("Ledger closed");
    let snapshot = this.snapshot<T, M>(scope);
    let source: ILedgerSync["source"] = "ledger";
    if (fresh || !snapshot || snapshot.blocked || snapshot.epoch !== this.epoch()) {
      await this.refresh(scope, load);
      snapshot = this.snapshot<T, M>(scope);
      source = "api";
    }
    if (!snapshot || snapshot.blocked || snapshot.epoch !== this.epoch())
      throw new Error("No complete ledger snapshot");
    const age = this.now() - snapshot.syncedAt;
    const stale = age < 0 || age >= this.refreshAfterMs || Boolean(snapshot.error);
    const retryDelay = Math.min(300_000, this.refreshAfterMs * 2 ** Math.min(snapshot.failures, 4));
    if (!fresh && stale && (!snapshot.error || this.now() - snapshot.attemptedAt >= retryDelay)) {
      void this.refresh(scope, load).catch(() => undefined);
    }
    return {
      rows: snapshot.rows,
      metadata: snapshot.metadata,
      sync: {
        source,
        lastSyncedAt: new Date(snapshot.syncedAt).toISOString(),
        stale,
        refreshing: this.running.has(scope),
        ...(snapshot.error ? { lastError: snapshot.error } : {}),
      },
    };
  }

  async value<T>(
    scope: string,
    load: () => Promise<T>,
    fresh = false,
  ): Promise<{ value: T; sync: ILedgerSync }> {
    const saved = await this.read(
      scope,
      async () => ({ rows: [{ id: "value", value: await load() }], metadata: {} }),
      fresh,
    );
    const row = saved.rows[0];
    if (!row || !("value" in row)) throw new Error("Incomplete ledger value");
    return { value: row.value, sync: saved.sync };
  }

  status(): Record<string, unknown>[] {
    const epoch = this.epoch();
    return this.db
      .prepare("SELECT scope,synced_at,epoch,failures,error,blocked FROM snapshots ORDER BY scope")
      .all()
      .map((row) => ({
        scope: String(row.scope),
        lastSyncedAt: new Date(Number(row.synced_at)).toISOString(),
        invalidated: Number(row.epoch) !== epoch,
        blocked: Boolean(row.blocked),
        refreshing: this.running.has(String(row.scope)),
        ...(row.error ? { lastError: String(row.error) } : {}),
      }));
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.running.values());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
