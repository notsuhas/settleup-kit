/** Writing: expenses, transfers, edits, deletions and members. */

import { SettleUpError } from "../../core/types.js";
import type { Command } from "../context.js";
import { fail } from "../fail.js";
import * as render from "../render.js";

/** Every write prints the resulting row, so the effect is visible without a second command. */
async function showRow(
  ctx: Parameters<Command>[0],
  group: string,
  row: Awaited<ReturnType<typeof ctx.client.addExpense>>,
  label: string,
): Promise<void> {
  const names = await ctx.memberNames(group);
  ctx.show(row, () => {
    console.log(label);
    render.transactions([row], names);
  });
}

/** The group and amount both `add` and `pay` need, resolved and validated once. */
function target(ctx: Parameters<Command>[0]): { name: string; amount: number } {
  const name = ctx.group();
  const amount = ctx.number(ctx.flags.amount, "amount");
  if (amount === undefined) fail("--amount is required");
  return { name, amount };
}

export const addExpense: Command = async (ctx) => {
  const { client, flags } = ctx;
  const { name, amount } = target(ctx);
  if (!flags.purpose) fail("--purpose is required: Settle Up rejects an empty description");

  const row = await client.addExpense({
    group: name,
    amount,
    purpose: flags.purpose,
    ...ctx.defined({
      paidBy: ctx.list(flags["paid-by"]),
      forWhom: ctx.list(flags.for),
      category: flags.category,
      currencyCode: flags.currency,
      dateTime: flags["date-time"],
      date: flags.date,
    }),
  });
  await showRow(ctx, name, row, "added");
};

export const addTransfer: Command = async (ctx) => {
  const { client, flags } = ctx;
  const { name, amount } = target(ctx);
  if (!flags.to) fail("--to is required: who is being paid");

  const row = await client.addTransfer({
    group: name,
    amount,
    to: flags.to,
    ...ctx.defined({
      from: flags.from,
      purpose: flags.purpose,
      currencyCode: flags.currency,
      dateTime: flags["date-time"],
      date: flags.date,
    }),
  });
  await showRow(ctx, name, row, "recorded");
};

export const edit: Command = async (ctx) => {
  const { client, flags, number, group, args } = ctx;
  const name = group();
  const [id] = args;
  if (!id) fail("usage: settleup edit <id> --group <name> [--amount …] [--purpose …]");

  const patch = ctx.defined({
    amount: number(flags.amount, "amount"),
    purpose: flags.purpose,
    category: flags.category,
    paidBy: ctx.list(flags["paid-by"]),
    forWhom: ctx.list(flags.for),
    currencyCode: flags.currency,
    dateTime: flags["date-time"],
    date: flags.date,
  });
  if (Object.keys(patch).length === 0) fail("nothing to change — pass at least one field");

  const row = await client.editTransaction(name, id, patch);
  await showRow(ctx, name, row, "updated");
};

export const remove: Command = async (ctx) => {
  const { client, group, args } = ctx;
  const name = group();
  const [id] = args;
  if (!id) fail("usage: settleup rm <id> --group <name>");
  const row = await client.deleteTransaction(name, id);
  await showRow(ctx, name, row, "deleted");
};

export const newGroup: Command = async (ctx) => {
  const { client, flags, show } = ctx;
  if (!flags.name) fail("--name is required");
  if (!flags.currency) fail("--currency is required, e.g. --currency INR");
  const members = ctx.list(flags.members) ?? ["Me"];
  const g = await client.createGroup({
    name: flags.name,
    currencyCode: flags.currency,
    members,
    ...ctx.defined({ minimizeDebts: flags["no-minimize"] ? false : undefined }),
  });
  show(g, () => {
    console.log(`created ${g.name} (${g.id})`);
    render.groups([g]);
  });
};

export const editGroup: Command = async (ctx) => {
  const { client, flags, show, group } = ctx;
  const patch = ctx.defined({
    name: flags.name,
    currencyCode: flags.currency,
    minimizeDebts: flags["no-minimize"] ? false : undefined,
  });
  if (Object.keys(patch).length === 0) {
    fail("nothing to change — pass --name, --currency or --no-minimize");
  }
  const g = await client.editGroup(group(), patch);
  show(g, () => console.log(`updated ${g.name} (${g.currencyCode})`));
};

export const removeGroup: Command = async (ctx) => {
  const { client, show, group } = ctx;
  const name = group();
  // Counted before the delete, so the summary can say what actually went.
  const count = (await client.transactions(name)).length;
  const gone = await client.deleteGroup(name);
  show({ deleted: gone, transactions: count }, () =>
    console.log(
      `deleted group ${gone.name} — ${count} transaction(s) and ` +
        `${gone.members.length} member(s) went with it`,
    ),
  );
};

export const addMember: Command = async (ctx) => {
  const { client, flags, group, show } = ctx;
  if (!flags.name) fail("--name is required");
  const member = await client.addMember(group(), { name: flags.name });
  show(member, () => console.log(`added ${member.name} (${member.id})`));
};

export const editMember: Command = async (ctx) => {
  const { client, flags, group, show, args } = ctx;
  const [who] = args;
  if (!who) fail("usage: settleup edit-member <name> --group <name> [--name …] [--inactive]");
  if (flags.active && flags.inactive) {
    throw new SettleUpError("--active and --inactive contradict each other");
  }
  const patch = ctx.defined({
    name: flags.name,
    active: flags.inactive ? false : flags.active ? true : undefined,
  });
  if (Object.keys(patch).length === 0)
    fail("nothing to change — pass --name, --active or --inactive");
  const member = await client.editMember(group(), who, patch);
  show(member, () => console.log(`updated ${member.name}`));
};
