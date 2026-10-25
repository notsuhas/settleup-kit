/**
 * What the client can do.
 *
 * Split from the implementation because this is the package's public contract:
 * the CLI and the MCP server are both written against it, and it is the one
 * thing a consumer reads before anything else.
 *
 * Everything is addressed by **group**, because that is how Settle Up is
 * shaped: members, transactions and debts all live under a group id, and the
 * same person is a different member id in each one. Every method that takes a
 * group accepts its name or its id.
 */

import type {
  Account,
  Balance,
  Debt,
  Group,
  GroupPatch,
  Member,
  MemberPatch,
  NewExpense,
  NewGroup,
  NewMember,
  NewTransfer,
  Transaction,
  TransactionPatch,
  TransactionQuery,
} from "../core/types.js";

export interface SettleUp {
  /** Share fresh reads only within one logical operation. */
  withFreshReads<T>(operation: () => Promise<T>): Promise<T>;
  /** The signed-in user. */
  account(): Promise<Account>;
  /** Every group the user belongs to, with members resolved. */
  groups(): Promise<Group[]>;
  /** One group by name or id. */
  group(group: string): Promise<Group>;
  members(group: string): Promise<Member[]>;
  /** Create a group, its members, and the link that makes it visible. */
  createGroup(input: NewGroup): Promise<Group>;
  /** Rename a group, change its currency, or toggle debt minimisation. */
  editGroup(group: string, patch: GroupPatch): Promise<Group>;
  /** Delete a group and every transaction in it. There is no undo. */
  deleteGroup(group: string): Promise<Group>;
  transactions(group: string, query?: TransactionQuery): Promise<Transaction[]>;
  transaction(group: string, id: string): Promise<Transaction>;
  /** The settlement edges Settle Up computed: who owes whom, in the group currency. */
  debts(group: string): Promise<Debt[]>;
  /** Net position per member, derived from the debt edges. */
  balances(group: string): Promise<Balance[]>;

  addExpense(input: NewExpense): Promise<Transaction>;
  addTransfer(input: NewTransfer): Promise<Transaction>;
  editTransaction(group: string, id: string, patch: TransactionPatch): Promise<Transaction>;
  deleteTransaction(group: string, id: string): Promise<Transaction>;

  addMember(group: string, input: NewMember): Promise<Member>;
  editMember(group: string, member: string, patch: MemberPatch): Promise<Member>;

  /** Drop every cached read. */
  refresh(): void;
}
