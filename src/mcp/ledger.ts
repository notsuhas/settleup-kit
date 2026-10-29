import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SettleUp } from "../client/api.js";
import type { ClientOptions } from "../client/index.js";
import { Ledger } from "../core/ledger.js";
import { filterTransactions } from "../core/query.js";
import type { Group, Transaction, TransactionQuery } from "../core/types.js";
import { naming } from "./present.js";

export interface ILedgerOptions extends ClientOptions {
  ledgerPath?: string | false;
}
interface IRow {
  id: string;
  raw: Transaction;
  view: Record<string, unknown>;
}

export function createLedger(options: ILedgerOptions): Ledger | undefined {
  if (options.ledgerPath === false) return undefined;
  const email = options.email ?? process.env.SETTLEUP_EMAIL;
  const token = options.token ?? process.env.SETTLEUP_ID_TOKEN;
  const path = options.ledgerPath ?? process.env.SETTLEUP_LEDGER_PATH;
  if (!path && !email && !token) return undefined;
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        options.env ?? process.env.SETTLEUP_ENV ?? "live",
        email?.toLowerCase(),
        token,
      ]),
    )
    .digest("hex");
  return new Ledger(
    path ??
      join(
        process.env.SETTLEUP_CONFIG_DIR ??
          process.env.XDG_CONFIG_HOME ??
          join(homedir(), ".config"),
        "settleup-kit",
        "ledgers",
        `${key}.sqlite`,
      ),
    30_000,
    Date.now,
    key,
  );
}

export function observeWrites(client: SettleUp, ledger?: Ledger): SettleUp {
  if (!ledger) return client;
  const writes = new Set<keyof SettleUp>([
    "addExpense",
    "addTransfer",
    "editTransaction",
    "deleteTransaction",
    "createGroup",
    "editGroup",
    "deleteGroup",
    "addMember",
    "editMember",
    "refresh",
  ]);
  return new Proxy(client, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || !writes.has(key as keyof SettleUp)) return value;
      return async (...args: unknown[]) => {
        ledger.invalidate();
        try {
          return await Reflect.apply(value, target, args);
        } finally {
          ledger.invalidate();
        }
      };
    },
  });
}

export function createLocalReads(client: SettleUp, ledger?: Ledger) {
  async function snapshot(group: string, fresh: boolean) {
    const load = () =>
      client.withFreshReads(async () => {
        const g = await client.group(group);
        const rows = await client.transactions(g.id);
        const name = naming(g);
        return {
          rows: rows.map((raw) => ({ id: raw.id, raw, view: name(raw) })),
          metadata: { group: g },
        };
      });
    if (ledger) return ledger.read<IRow, { group: Group }>(`group:${group}`, load, fresh);
    return {
      ...(await load()),
      sync: {
        source: "api" as const,
        lastSyncedAt: new Date().toISOString(),
        stale: false,
        refreshing: false,
      },
    };
  }
  return {
    async value<T>(scope: string, load: () => Promise<T>, fresh: boolean) {
      if (ledger) return ledger.value(scope, () => client.withFreshReads(load), fresh);
      return {
        value: await client.withFreshReads(load),
        sync: {
          source: "api" as const,
          lastSyncedAt: new Date().toISOString(),
          stale: false,
          refreshing: false,
        },
      };
    },
    async search(group: string, query: TransactionQuery, limit: number, fresh: boolean) {
      const saved = await snapshot(group, fresh);
      const rows = filterTransactions(
        saved.rows.map((row) => row.raw),
        query,
      );
      const views = new Map(saved.rows.map((row) => [row.id, row.view]));
      return {
        matched: rows.length,
        returned: Math.min(rows.length, limit),
        transactions: rows.slice(0, limit).map((row) => views.get(row.id)),
        sync: saved.sync,
      };
    },
    async get(group: string, id: string, fresh: boolean) {
      if (!ledger)
        return client.withFreshReads(async () => ({
          transaction: naming(await client.group(group))(await client.transaction(group, id)),
          sync: {
            source: "api" as const,
            lastSyncedAt: new Date().toISOString(),
            stale: false,
            refreshing: false,
          },
        }));
      let saved = await snapshot(group, fresh);
      if (!fresh && saved.sync.source === "ledger" && !saved.rows.some((row) => row.id === id))
        saved = await snapshot(group, true);
      const row = saved.rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`No transaction ${id} in the requested group`);
      return { transaction: row.view, sync: saved.sync };
    },
  };
}
