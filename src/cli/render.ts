/**
 * Terminal output. Separate from the command dispatch because presentation
 * changes for entirely different reasons than behaviour does, and because
 * every command wants `--json` to bypass all of it.
 */

import { localDay } from "../core/dates.js";
import type { Balance, Debt, Group, Member, Transaction } from "../core/types.js";

/** Member id to name, so rows show someone the user recognises. */
export type MemberNames = Map<string, string>;

export const memberNames = (members: Member[]): MemberNames =>
  new Map(members.map((m) => [m.id, m.name]));

/** `--json` wins over any table; a command with no table is always JSON. */
export function output(json: boolean, data: unknown, table?: () => void): void {
  if (json || !table) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  table();
}

const who = (list: { memberId: string }[], names: MemberNames) =>
  list.map((w) => names.get(w.memberId) ?? "?").join(", ");

export function transactions(rows: Transaction[], names: MemberNames): void {
  if (rows.length === 0) {
    console.log("no matching transactions");
    return;
  }
  for (const t of rows) {
    const forWhom = [...new Set(t.items.flatMap((i) => (i.forWhom ?? []).map((f) => f.memberId)))];
    console.log(
      [
        localDay(t.dateTime),
        `${t.amount} ${t.currencyCode}`.padStart(14),
        (t.category ?? (t.type === "transfer" ? "→" : "·")).padEnd(3),
        (t.purpose || "—").padEnd(28),
        `paid by ${who(t.whoPaid, names)}`,
        `for ${who(
          forWhom.map((memberId) => ({ memberId })),
          names,
        )}`,
      ].join("  "),
    );
    console.log(`${" ".repeat(12)}id ${t.id}`);
  }
  console.log(`\n${rows.length} transaction(s)`);
}

export function groups(rows: Group[]): void {
  for (const g of rows) {
    const me = g.members.find((m) => m.id === g.meMemberId)?.name;
    console.log(
      `${g.name.padEnd(24)} ${g.currencyCode.padEnd(5)} ${String(g.members.length).padStart(2)} members` +
        `${me ? `   you are ${me}` : ""}`,
    );
    console.log(`${" ".repeat(24)} ${g.members.map((m) => m.name).join(", ")}`);
  }
}

export function members(rows: Member[]): void {
  for (const m of rows) {
    console.log(`${m.name.padEnd(24)} ${m.active ? "active" : "inactive"}   ${m.id}`);
  }
}

export function settlement(
  rows: Balance[],
  debts: Debt[],
  names: MemberNames,
  currency: string,
): void {
  if (rows.every((r) => r.net === 0)) {
    console.log("all settled up");
    return;
  }
  for (const b of rows) {
    const sign = b.net > 0 ? "+" : "";
    console.log(`${b.name.padEnd(24)} ${sign}${b.net.toFixed(2)} ${currency}`);
  }
  if (debts.length) {
    console.log("\nto settle:");
    for (const d of debts) {
      console.log(
        `  ${names.get(d.from) ?? d.from} pays ${names.get(d.to) ?? d.to} ` +
          `${Number(d.amount).toFixed(2)} ${currency}`,
      );
    }
  }
}
