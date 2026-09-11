/**
 * Resolving names to entities, and filtering transaction lists.
 *
 * Everything the caller passes — a group, a member, a payer — may be a name or
 * an id, so these match either. Names are matched case-insensitively; ids
 * exactly. A member lookup is scoped to one group, because the same person is
 * a different member id in every group they belong to.
 */

import { END_OF_DAY, isBareDate } from "./dates.js";
import type { Group, Member, Transaction, TransactionQuery } from "./types.js";
import { SettleUpError } from "./types.js";

function matches(value: string, name: string, id: string): boolean {
  return value === id || value.toLowerCase() === name.toLowerCase();
}

export function findGroup(groups: Group[], value: string): Group {
  const hit = groups.find((g) => matches(value, g.name, g.id));
  if (!hit) throw new SettleUpError(`no group ${JSON.stringify(value)}`);
  return hit;
}

export function findMember(members: Member[], value: string): Member {
  const hit = members.find((m) => matches(value, m.name, m.id));
  if (!hit) {
    const known = members.map((m) => m.name).join(", ");
    throw new SettleUpError(`no member ${JSON.stringify(value)} in this group. Members: ${known}`);
  }
  return hit;
}

/**
 * Parse a date bound, failing loudly on nonsense.
 *
 * `Date.parse` answers NaN rather than throwing, and every comparison with NaN
 * is false — so an unparseable bound would silently return everything, which
 * reads as "the filter matched" rather than "the filter was ignored".
 */
function day(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new SettleUpError(`${flag} is not a date: ${value}`);
  return parsed;
}

/** Apply a query to a transaction list. Newest first. */
export function filterTransactions(
  transactions: Transaction[],
  query: TransactionQuery = {},
): Transaction[] {
  const needle = query.purpose?.toLowerCase();
  const from = day(query.from, "from");
  // A bare date names a whole day, so the upper bound runs to its last
  // millisecond. A full timestamp means exactly that instant.
  const to = day(query.to, "to");
  const toEnd = to !== undefined && isBareDate(query.to as string) ? to + END_OF_DAY : to;
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new SettleUpError(`limit must be a positive whole number, got ${query.limit}`);
  }

  const hits = transactions.filter((t) => {
    if (query.type && t.type !== query.type) return false;
    if (needle && !t.purpose.toLowerCase().includes(needle)) return false;
    if (from !== undefined && t.dateTime < from) return false;
    if (toEnd !== undefined && t.dateTime > toEnd) return false;
    const size = Math.abs(Number(t.amount));
    if (query.minAmount !== undefined && size < query.minAmount) return false;
    if (query.maxAmount !== undefined && size > query.maxAmount) return false;
    return true;
  });
  hits.sort((a, b) =>
    a.dateTime === b.dateTime ? a.id.localeCompare(b.id) : b.dateTime - a.dateTime,
  );
  return query.limit ? hits.slice(0, query.limit) : hits;
}
