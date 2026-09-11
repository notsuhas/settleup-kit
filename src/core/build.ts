/**
 * Building the wire payload for a write.
 *
 * A Settle Up transaction is the same shape whether it is an expense or a
 * transfer: `whoPaid` is a weighted list of payers, and `items` is a list of
 * amounts each split across a weighted `forWhom`. A transfer is simply the
 * degenerate case — one payer, one recipient, one item, no category.
 *
 * Two things are deliberately **not** computed here. `exchangeRates` is filled
 * in by the server on write, from the row's currency to the group's; sending
 * our own would pin a rate we have no business choosing. And the debts are
 * recalculated server-side on every write, so nothing here touches `/debts`.
 */

import { timezoneAt, when } from "./dates.js";
import { positiveAmount } from "./money.js";
import { findMember } from "./query.js";
import type { Group, Member, NewExpense, NewTransfer, Weighted } from "./types.js";
import { SettleUpError } from "./types.js";

/** The raw row as Settle Up stores it. */
export interface TransactionPayload {
  type: "expense" | "transfer";
  purpose: string;
  category?: string;
  currencyCode: string;
  dateTime: number;
  timezone: string;
  fixedExchangeRate: boolean;
  whoPaid: Weighted[];
  items: { amount: string; forWhom: Weighted[] }[];
}

/** Equal weights — the overwhelmingly common case, and what the app defaults to. */
const evenly = (members: Member[]): Weighted[] =>
  members.map((m) => ({ memberId: m.id, weight: "1" }));

/**
 * The signed-in user's member in this group.
 *
 * `userGroups/<uid>/<groupId>/member` is the mapping, so a user who is in the
 * group without being a member — a spectator on someone else's group — has
 * none, and "who paid" then has to be given explicitly.
 */
function me(group: Group): Member {
  if (!group.meMemberId) {
    throw new SettleUpError(
      `You are not mapped to a member of ${JSON.stringify(group.name)}, so who paid ` +
        "cannot be inferred. Pass it explicitly.",
    );
  }
  return findMember(group.members, group.meMemberId);
}

/** Resolve a name, an id, or a list of them, to members of this group. */
function resolve(group: Group, who: string | string[]): Member[] {
  const list = Array.isArray(who) ? who : [who];
  if (list.length === 0) throw new SettleUpError("empty member list");
  return list.map((value) => findMember(group.members, value));
}

/**
 * Settle Up's own default description for a settling-up payment. Matching the
 * app's wording means a transfer written here is indistinguishable from one
 * made on the phone.
 */
const DEBT_SETTLEMENT = "Debt settlement";

/**
 * Require a description.
 *
 * The database's security rules reject a transaction whose `purpose` is the
 * empty string — with a bare "Permission denied" that reads like an auth
 * failure rather than a validation one. Catching it here turns a confusing
 * 401 into the actual problem.
 */
function purpose(value: string | undefined, fallback?: string): string {
  const text = value?.trim() || fallback;
  if (!text) {
    throw new SettleUpError(
      "purpose is required: Settle Up rejects a transaction with an empty " +
        'description, answering "Permission denied".',
    );
  }
  return text;
}

export function buildExpense(group: Group, input: NewExpense): TransactionPayload {
  const payers = input.paidBy ? resolve(group, input.paidBy) : [me(group)];
  const beneficiaries = input.forWhom
    ? resolve(group, input.forWhom)
    : group.members.filter((m) => m.active);

  if (beneficiaries.length === 0) {
    throw new SettleUpError(
      `${JSON.stringify(group.name)} has no active members to split between.`,
    );
  }

  const at = when(input.date);
  return {
    type: "expense",
    purpose: purpose(input.purpose),
    ...(input.category ? { category: input.category } : {}),
    currencyCode: input.currencyCode ?? group.currencyCode,
    dateTime: at,
    timezone: timezoneAt(at),
    fixedExchangeRate: false,
    whoPaid: evenly(payers),
    items: [{ amount: positiveAmount(input.amount), forWhom: evenly(beneficiaries) }],
  };
}

export function buildTransfer(group: Group, input: NewTransfer): TransactionPayload {
  const [from] = input.from ? resolve(group, input.from) : [me(group)];
  const [to] = resolve(group, input.to);
  if (!from || !to) throw new SettleUpError("a transfer needs both a payer and a recipient");
  if (from.id === to.id) throw new SettleUpError("a transfer needs two different members");

  const at = when(input.date);
  return {
    type: "transfer",
    purpose: purpose(input.purpose, DEBT_SETTLEMENT),
    currencyCode: input.currencyCode ?? group.currencyCode,
    dateTime: at,
    timezone: timezoneAt(at),
    fixedExchangeRate: false,
    whoPaid: [{ memberId: from.id, weight: "1" }],
    items: [
      {
        amount: positiveAmount(input.amount),
        forWhom: [{ memberId: to.id, weight: "1" }],
      },
    ],
  };
}
