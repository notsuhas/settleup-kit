/**
 * The composition root: one object over auth, the database and the pure layer.
 *
 * The CLI and the MCP server are both thin layers over this, so neither can do
 * anything the library cannot.
 *
 * Everything is addressed by **group**, because that is how Settle Up is
 * shaped: members, transactions and debts all live under a group id, and the
 * same person is a different member id in each one. Every method that takes a
 * group accepts its name or its id.
 */

import { type AuthOptions, authenticate, type Session } from "../api/auth.js";
import { Db } from "../api/db.js";
import { buildExpense, buildTransfer, type TransactionPayload } from "../core/build.js";
import { Cache } from "../core/cache.js";
import { balances as computeBalances } from "../core/debts.js";
import {
  fromMap,
  type RawGroup,
  type RawMember,
  type RawTransaction,
  toGroup,
  toMember,
  toTransaction,
} from "../core/normalise.js";
import { applyPatch } from "../core/patch.js";
import { filterTransactions, findGroup } from "../core/query.js";
import type { Account, Debt, Group, SettleUpEnv, Transaction } from "../core/types.js";
import { SettleUpError } from "../core/types.js";
import type { SettleUp } from "./api.js";
import { createGroupApi } from "./groups.js";
import { createMemberApi } from "./members.js";

export interface ClientOptions extends Partial<AuthOptions> {
  /** How long a read is reused, in seconds. Default 30. */
  cacheSeconds?: number;
}

/** What `userGroups/<uid>` stores: which groups the user is in, and as whom. */
interface RawUserGroup {
  member?: string;
  order?: number;
  color?: string;
}

export function createClient(options: ClientOptions = {}): SettleUp {
  const env: SettleUpEnv =
    options.env ?? ((process.env.SETTLEUP_ENV as SettleUpEnv | undefined) || "live");
  const cache = new Cache((options.cacheSeconds ?? 30) * 1000);

  /**
   * Resolve the session per call, never once per client.
   *
   * A `Db` captures the ID token it was built with, and a Firebase ID token
   * lasts an hour. Memoising this made a long-running process — an MCP server,
   * exactly what this is for — keep using the first token it ever got, and
   * every request an hour later came back "Permission denied". It survived
   * every test because a test process is short-lived.
   *
   * The cost is a cached-file read: `authenticate` returns immediately when the
   * token is still good, refreshes only when it is not, and shares one
   * in-flight renewal between concurrent callers.
   */
  async function connect(): Promise<{ db: Db; session: Session }> {
    const s = await authenticate({ ...options, env });
    return { db: new Db(env, s), session: s };
  }

  async function loadGroups(): Promise<Group[]> {
    const { db, session: s } = await connect();
    const mine = await db.get<Record<string, RawUserGroup>>(`userGroups/${s.uid}`);
    if (!mine) return [];

    // Each group's document and member list are separate nodes, so this is a
    // fan-out rather than one read. Groups are few; members are not paginated.
    return Promise.all(
      Object.entries(mine).map(async ([groupId, link]) => {
        const [raw, members] = await Promise.all([
          db.get<RawGroup>(`groups/${groupId}`),
          db.get<Record<string, RawMember>>(`members/${groupId}`),
        ]);
        return toGroup(groupId, raw ?? {}, fromMap(members, toMember), link?.member);
      }),
    );
  }

  const groups = () => cache.get("groups", loadGroups);

  const group = async (value: string) => findGroup(await groups(), value);

  async function transactionsOf(groupId: string): Promise<Transaction[]> {
    return cache.get(`tx:${groupId}`, async () => {
      const { db } = await connect();
      const raw = await db.get<Record<string, RawTransaction>>(`transactions/${groupId}`);
      return fromMap(raw, toTransaction);
    });
  }

  /** A write changed this group: its transactions and debts must be re-read. */
  function invalidate(groupId: string): void {
    cache.invalidate(`tx:${groupId}`);
    cache.invalidate(`debts:${groupId}`);
  }

  /** Read back what was written, so callers get the server's own view of the row. */
  async function readBack(groupId: string, id: string): Promise<Transaction> {
    const { db } = await connect();
    const raw = await db.get<RawTransaction>(`transactions/${groupId}/${id}`);
    if (!raw) throw new SettleUpError(`transaction ${id} not found after writing it`);
    return toTransaction(id, raw);
  }

  /** Named rather than inline so the returned object never depends on `this`. */
  async function debtsOf(value: string): Promise<Debt[]> {
    const g = await group(value);
    return cache.get(`debts:${g.id}`, async () => {
      const { db } = await connect();
      // Firebase stores this as an array, and a sparse one arrives with holes.
      return ((await db.get<(Debt | null)[]>(`debts/${g.id}`)) ?? []).filter(
        (d): d is Debt => d != null,
      );
    });
  }

  async function transactionOf(value: string, id: string): Promise<Transaction> {
    const g = await group(value);
    const { db } = await connect();
    const hit = await db.get<RawTransaction>(`transactions/${g.id}/${id}`);
    if (!hit) throw new SettleUpError(`no transaction ${id} in ${JSON.stringify(g.name)}`);
    return toTransaction(id, hit);
  }

  async function write(g: Group, payload: TransactionPayload): Promise<Transaction> {
    const { db } = await connect();
    const id = await db.push(`transactions/${g.id}`, payload);
    invalidate(g.id);
    return readBack(g.id, id);
  }

  const groupApi = createGroupApi({
    db: async () => (await connect()).db,
    uid: async () => (await connect()).session.uid,
    cache,
    group,
  });

  const members = createMemberApi({
    db: async () => (await connect()).db,
    cache,
    group,
  });

  return {
    withFreshReads: (operation) => cache.scope(operation),

    async account(): Promise<Account> {
      const { db, session: s } = await connect();
      const user = await db.get<{ email?: string; name?: string }>(`users/${s.uid}`);
      return {
        uid: s.uid,
        email: user?.email ?? "",
        ...(user?.name ? { name: user.name } : {}),
      };
    },

    groups,
    group,

    async members(value) {
      return (await group(value)).members;
    },

    async transactions(value, query) {
      const g = await group(value);
      return filterTransactions(await transactionsOf(g.id), query);
    },

    transaction: transactionOf,

    debts: debtsOf,

    async balances(value) {
      const g = await group(value);
      return computeBalances(await debtsOf(value), g.members);
    },

    async addExpense(input) {
      const g = await group(input.group);
      return write(g, buildExpense(g, input));
    },

    async addTransfer(input) {
      const g = await group(input.group);
      return write(g, buildTransfer(g, input));
    },

    /**
     * Edit by rebuilding the whole row from the live one — see `applyPatch`.
     */
    async editTransaction(value, id, patch) {
      const g = await group(value);
      const { db } = await connect();
      const before = await db.get<RawTransaction>(`transactions/${g.id}/${id}`);
      if (!before) throw new SettleUpError(`no transaction ${id} in ${JSON.stringify(g.name)}`);

      await db.put(`transactions/${g.id}/${id}`, applyPatch(before, patch, g));
      invalidate(g.id);
      return readBack(g.id, id);
    },

    async deleteTransaction(value, id) {
      const g = await group(value);
      const doomed = await transactionOf(value, id);
      const { db } = await connect();
      await db.delete(`transactions/${g.id}/${id}`);
      invalidate(g.id);
      return doomed;
    },

    ...groupApi,
    ...members,

    refresh: () => cache.clear(),
  };
}
