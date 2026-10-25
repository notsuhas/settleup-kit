/** Expense and transfer CRUD. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SettleUp } from "../../client/api.js";
import { DATE, DATE_TIME, json, naming } from "../present.js";

const GROUP = z.string().describe("Group name from list_groups");
const SHARES = z
  .record(z.string(), z.union([z.number().nonnegative(), z.string()]))
  .optional()
  .describe(
    "Exact amounts for genuinely unequal shares, summing to the full expense amount. For equal splits use forWhom and let Settle Up round; do not encode rounding pennies as custom shares. Do not combine with forWhom.",
  );

export function registerTransactionTools(server: McpServer, client: SettleUp): void {
  /** Names are resolved against the group, because member ids mean nothing to a model. */
  const show = async (group: string, rows: Awaited<ReturnType<SettleUp["transactions"]>>) => {
    const name = naming(await client.group(group));
    return rows.map(name);
  };

  server.registerTool(
    "search_transactions",
    {
      title: "Search transactions",
      description:
        "Find transactions in a group, or get an id for editing or deleting. " +
        "Every filter but the group is optional and they combine; newest first.",
      inputSchema: {
        group: GROUP,
        purpose: z.string().optional().describe("Case-insensitive substring of the description"),
        type: z.enum(["expense", "transfer"]).optional(),
        from: DATE.optional().describe("Earliest date, inclusive"),
        to: DATE.optional().describe("Latest date, inclusive"),
        minAmount: z.number().optional(),
        maxAmount: z.number().optional(),
        limit: z.number().int().min(1).max(200).default(25),
      },
    },
    async ({ group, limit, ...query }) => {
      const all = await client.transactions(group, query);
      return json({
        matched: all.length,
        returned: Math.min(all.length, limit),
        transactions: await show(group, all.slice(0, limit)),
      });
    },
  );

  server.registerTool(
    "add_expense",
    {
      title: "Add a shared expense",
      description:
        "Record money spent for the group. By default it is paid by the user and " +
        "split equally between every active member — pass forWhom to split it " +
        "between only some of them, shares for exact unequal amounts, or paidBy if someone else paid.",
      inputSchema: {
        group: GROUP,
        amount: z.number().positive().describe("Total spent, positive"),
        shares: SHARES,
        purpose: z.string().min(1).describe("What it was for. Settle Up rejects an empty one."),
        paidBy: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("Member names who paid. Defaults to the user."),
        forWhom: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("Member names to split between. Defaults to every active member."),
        category: z.string().optional().describe("An emoji, as Settle Up uses for categories"),
        currencyCode: z.string().optional().describe("ISO code. Defaults to the group currency."),
        date: DATE.optional().describe("Defaults to now"),
        dateTime: DATE_TIME.optional(),
      },
    },
    async ({ group, ...input }) => {
      const created = await client.addExpense({ group, ...input });
      return json({
        created: created.id,
        transaction: (await show(group, [created]))[0],
      });
    },
  );

  server.registerTool(
    "add_transfer",
    {
      title: "Record a payment between members",
      description:
        "Record one member paying another back, which settles part of a debt. " +
        "This is not a shared expense — it moves money between two people.",
      inputSchema: {
        group: GROUP,
        amount: z.number().positive(),
        to: z.string().describe("Member name being paid"),
        from: z.string().optional().describe("Member name paying. Defaults to the user."),
        purpose: z.string().optional().describe('Defaults to "Debt settlement"'),
        currencyCode: z.string().optional(),
        date: DATE.optional(),
        dateTime: DATE_TIME.optional(),
      },
    },
    async ({ group, ...input }) => {
      const created = await client.addTransfer({ group, ...input });
      return json({
        created: created.id,
        transaction: (await show(group, [created]))[0],
      });
    },
  );

  server.registerTool(
    "edit_transaction",
    {
      title: "Edit a transaction",
      description:
        "Change only the fields you pass. Everything else on the row — the receipt, " +
        "extra item lines, the split you did not mention — is preserved.",
      inputSchema: {
        group: GROUP,
        id: z.string().describe("Transaction id from search_transactions"),
        amount: z.number().positive().optional(),
        shares: SHARES.describe(
          "Exact unequal amounts for a single-item expense. Replaces its split; sums to its amount. For equal splits use forWhom and let Settle Up round. Do not combine with forWhom.",
        ),
        purpose: z.string().optional(),
        category: z.string().nullable().optional().describe("null clears the category"),
        paidBy: z.array(z.string()).min(1).optional().describe("Replaces the existing payers"),
        forWhom: z.array(z.string()).min(1).optional().describe("Replaces the existing split"),
        currencyCode: z.string().optional(),
        date: DATE.optional(),
        dateTime: DATE_TIME.optional(),
      },
    },
    async ({ group, id, ...patch }) => {
      if (Object.values(patch).every((v) => v === undefined)) {
        throw new Error("nothing to change — pass at least one field");
      }
      const before = await client.transaction(group, id);
      const after = await client.editTransaction(group, id, patch);
      const rendered = await show(group, [before, after]);
      return json({ before: rendered[0], after: rendered[1] });
    },
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "Delete a transaction",
      description: "Permanently delete one transaction. There is no undo — confirm first.",
      inputSchema: {
        group: GROUP,
        id: z.string().describe("Id from search_transactions"),
      },
    },
    async ({ group, id }) =>
      json({
        deleted: (await show(group, [await client.deleteTransaction(group, id)]))[0],
      }),
  );
}
