/** Reading: the account, groups, members, transactions and balances. */

import type { Command } from "../context.js";
import * as render from "../render.js";

export const whoami: Command = async ({ client, show }) => {
  const [account, groups] = await Promise.all([client.account(), client.groups()]);
  show({ ...account, groups: groups.map((g) => g.name) }, () => {
    console.log(`${account.name ?? account.email} <${account.email}>`);
    console.log(`${groups.length} group(s): ${groups.map((g) => g.name).join(", ")}`);
  });
};

export const listGroups: Command = async ({ client, show }) => {
  const groups = await client.groups();
  show(groups, () => render.groups(groups));
};

export const listMembers: Command = async ({ client, show, group }) => {
  const members = await client.members(group());
  show(members, () => render.members(members));
};

export const listTransactions: Command = async (ctx) => {
  const { client, flags, show, number, group } = ctx;
  const name = group();
  const rows = await client.transactions(
    name,
    ctx.defined({
      purpose: flags.purpose,
      type: flags.type as "expense" | "transfer" | undefined,
      from: flags.after,
      to: flags.before,
      minAmount: number(flags.min, "min"),
      maxAmount: number(flags.max, "max"),
      limit: number(flags.limit, "limit"),
    }),
  );
  const names = await ctx.memberNames(name);
  show(rows, () => render.transactions(rows, names));
};

export const balances: Command = async (ctx) => {
  const { client, show, group } = ctx;
  const name = group();
  const [g, balances, debts] = await Promise.all([
    client.group(name),
    client.balances(name),
    client.debts(name),
  ]);
  show({ group: g.name, currency: g.currencyCode, balances, debts }, () =>
    render.settlement(balances, debts, render.memberNames(g.members), g.currencyCode),
  );
};
