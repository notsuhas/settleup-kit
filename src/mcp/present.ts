/**
 * How tool results are shaped for a model, and the input pieces every tool
 * group shares. Kept apart from the tool definitions so the wording of a result
 * can change without touching what the tools do.
 */

import { z } from "zod";
import { recordedTime } from "../core/dates.js";
import type { Group, Member, Transaction } from "../core/types.js";

export const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .describe("YYYY-MM-DD");

export const DATE_TIME = z.iso
  .datetime({ offset: true })
  .describe(
    "ISO timestamp with Z or UTC offset, e.g. 2026-10-19T11:10:00+09:00. Do not combine with date.",
  );

export const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }],
});

/** Resolves member ids to the names a person would actually use. */
export type Naming = (transaction: Transaction) => Record<string, unknown>;

export function naming(group: Group): Naming {
  const name = (id: string) => group.members.find((m) => m.id === id)?.name ?? id;
  const who = (list: { memberId: string }[]) => list.map((w) => name(w.memberId));

  return (t) => ({
    id: t.id,
    date: recordedTime(t.dateTime, t.timezone).slice(0, 10),
    dateTime: recordedTime(t.dateTime, t.timezone),
    type: t.type,
    amount: t.amount,
    currency: t.currencyCode,
    purpose: t.purpose,
    ...(t.category ? { category: t.category } : {}),
    paidBy: who(t.whoPaid),
    // Flattened across items: a model wants "who is this for", not the tip line.
    forWhom: [...new Set(t.items.flatMap((i) => who(i.forWhom ?? [])))],
    split: t.items.map((item) => ({
      amount: item.amount,
      forWhom: (item.forWhom ?? []).map((member) => ({
        member: name(member.memberId),
        weight: member.weight,
      })),
    })),
    ...(t.items.length > 1 ? { items: t.items.length } : {}),
  });
}

export const describeMember = (m: Member) => ({
  name: m.name,
  id: m.id,
  active: m.active,
});

export const INSTRUCTIONS = `Read and write shared expenses in a live Settle Up account.

MCP read tools use persistent SQLite snapshots and include sync metadata. Treat
lastSyncedAt as the as-of time. Pass fresh=true for audits, current balances and
settlement decisions. Cached results are not independent write verification.
Stale reads return immediately and trigger background reconciliation; writes
invalidate snapshots, and receipt verification always reads upstream directly.

For new receipts prefer record_expense: it checks duplicates and returns the saved,
independently verified full bill and exact split in one call. Keep a stable receiptId.
After verified=true, do not repeat search_transactions. Reuse loaded schemas and
known group/member IDs; run independent apps in parallel.

Settle Up is organised by **group**. Members, transactions and debts all belong
to one, and the same person is a different member in each group — so every call
names a group, and members are named within it. list_groups shows both.

Amounts are always positive. Direction comes from the kind of row:
- add_expense records money someone spent for the group. It defaults to being
  paid by you and split equally between every active member. Pass shares as
  exact amounts by member name or id for an unequal split in one expense.
- add_transfer records one member paying another back, which settles a debt.

Splitting is the point of the app: if the user records a shared cost without
saying who it was for, the default is an even split across the group. When it
is ambiguous whether a cost was shared or personal, ask before writing.
Custom shares must sum exactly to the total and cannot be combined with forWhom.
For equal splits use forWhom and let Settle Up round. Never turn rounding pennies
into custom weights. Settle Up stores custom allocations as weights internally;
there is no separately persisted exact-amount mode.
Readback includes each item's amount and member weights so its split can be verified.

Debts are computed by Settle Up itself and recalculated on every write, so
group_balances after a write reflects the change. Deleting cannot be undone;
confirm with the user first.`;
