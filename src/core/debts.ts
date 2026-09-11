/**
 * Turning Settle Up's debt edges into per-member balances.
 *
 * Settle Up computes the settlement itself — `/debts/<groupId>` is a list of
 * `{ from, to, amount }` edges in the group currency, already minimised if the
 * group has that on. This derives each member's net position from those edges,
 * which is what a "who's up, who's down" view wants. It does not recompute the
 * settlement; that is the server's job and it runs on every write.
 */

import type { Balance, Debt, Member } from "./types.js";

/**
 * Net position per member: positive is owed to them, negative is owed by them.
 *
 * Every edge moves `amount` from `from` (who owes) to `to` (who is owed), so a
 * creditor's net rises and a debtor's falls. Members with no edges appear at
 * zero, so the result always covers the whole group.
 */
export function balances(debts: Debt[], members: Member[]): Balance[] {
  const net = new Map<string, number>(members.map((m) => [m.id, 0]));
  for (const { from, to, amount } of debts) {
    const value = Number(amount);
    net.set(from, (net.get(from) ?? 0) - value);
    net.set(to, (net.get(to) ?? 0) + value);
  }
  const name = new Map(members.map((m) => [m.id, m.name]));
  return [...net.entries()]
    .map(([memberId, value]) => ({
      memberId,
      name: name.get(memberId) ?? memberId,
      net: value,
    }))
    .sort((a, b) => b.net - a.net);
}
