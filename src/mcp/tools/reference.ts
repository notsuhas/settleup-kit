import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SettleUp } from "../../client/api.js";
import type { createLocalReads } from "../ledger.js";
import { describeMember, json } from "../present.js";

export function registerReferenceTools(
  server: McpServer,
  client: SettleUp,
  reads: ReturnType<typeof createLocalReads>,
): void {
  server.registerTool(
    "list_groups",
    {
      title: "List groups",
      description:
        "Local group/member snapshot with sync freshness. Pass fresh=true to reconcile with Settle Up.",
      inputSchema: { fresh: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    async ({ fresh }) => {
      const saved = await reads.value(
        "reference:groups",
        async () =>
          (await client.groups()).map((g) => ({
            name: g.name,
            id: g.id,
            currency: g.currencyCode,
            you: g.members.find((m) => m.id === g.meMemberId)?.name,
            members: g.members.map(describeMember),
          })),
        fresh,
      );
      return json({ groups: saved.value, sync: saved.sync });
    },
  );
  server.registerTool(
    "group_balances",
    {
      title: "Who owes whom",
      description:
        "Local settlement snapshot with sync freshness. Positive net means the member is owed money. Pass fresh=true for reconciliation before settling or auditing.",
      inputSchema: { group: z.string(), fresh: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    async ({ group, fresh }) => {
      const saved = await reads.value(
        `reference:balances:${group}`,
        async () => {
          const [g, balances, debts] = await Promise.all([
            client.group(group),
            client.balances(group),
            client.debts(group),
          ]);
          const name = (id: string) => g.members.find((m) => m.id === id)?.name ?? id;
          return {
            group: g.name,
            currency: g.currencyCode,
            balances: balances.map((b) => ({ member: b.name, net: Number(b.net.toFixed(2)) })),
            settleWith: debts.map((d) => ({
              from: name(d.from),
              to: name(d.to),
              amount: Number(Number(d.amount).toFixed(2)),
            })),
          };
        },
        fresh,
      );
      return json({ ...saved.value, sync: saved.sync });
    },
  );
}
