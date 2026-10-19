/**
 * Applying an edit to an existing transaction.
 *
 * A Realtime Database PUT replaces the node, so an edit has to start from the
 * live row and change only what was asked. Anything left out of the patch —
 * the receipt, the timezone, a tip line, the half of the split you did not
 * mention — has to survive, and that is what makes this worth isolating and
 * testing rather than inlining into the client.
 */

import { transactionTime, when } from "./dates.js";
import { positiveAmount } from "./money.js";
import type { RawTransaction } from "./normalise.js";
import { findMember } from "./query.js";
import type { Group, TransactionPatch, Weighted } from "./types.js";
import { SettleUpError } from "./types.js";

const weigh = (group: Group, names: string[]): Weighted[] =>
  names.map((n) => ({ memberId: findMember(group.members, n).id, weight: "1" }));

/** Rebuild a row with the patch applied. Pure: the caller does the writing. */
export function applyPatch(
  before: RawTransaction,
  patch: TransactionPatch,
  group: Group,
): RawTransaction {
  const next: RawTransaction = { ...before };

  if (patch.purpose !== undefined) {
    if (!patch.purpose.trim()) {
      throw new SettleUpError("purpose cannot be cleared: Settle Up rejects an empty description");
    }
    next.purpose = patch.purpose;
  }

  // `null` clears the category; `undefined` leaves it alone. Without the
  // distinction there would be no way to un-categorise a row.
  if (patch.category !== undefined) {
    if (patch.category === null) delete next.category;
    else next.category = patch.category;
  }

  if (patch.currencyCode !== undefined) next.currencyCode = patch.currencyCode;

  if (patch.dateTime !== undefined) Object.assign(next, transactionTime(patch));
  else if (patch.date !== undefined) next.dateTime = when(patch.date);

  // An empty list would leave the row paid by nobody or owed by nobody, which
  // breaks the server's settlement for the whole group. The add path refuses
  // this; an edit must not be the way around it.
  if (patch.paidBy?.length === 0) {
    throw new SettleUpError("paidBy cannot be empty — someone has to have paid");
  }
  if (patch.forWhom?.length === 0) {
    throw new SettleUpError("forWhom cannot be empty — an expense needs someone to be for");
  }

  if (patch.paidBy !== undefined) {
    next.whoPaid = weigh(group, Array.isArray(patch.paidBy) ? patch.paidBy : [patch.paidBy]);
  }

  if (patch.amount !== undefined || patch.forWhom !== undefined) {
    const items = [...(before.items ?? [])];
    const first = items[0];
    // Both apply to the main item; a tip or tax line further down is left alone.
    items[0] = {
      amount: patch.amount !== undefined ? positiveAmount(patch.amount) : (first?.amount ?? "0"),
      forWhom: patch.forWhom ? weigh(group, patch.forWhom) : (first?.forWhom ?? []),
    };
    next.items = items;
  }

  // The server recomputes the rate on write. Keeping the old one would pin a
  // stale rate to a changed amount or currency — unless it was pinned on
  // purpose, which `fixedExchangeRate` records.
  if (!before.fixedExchangeRate) delete next.exchangeRates;

  return next;
}
