/** Reading the shape of the account: groups, members, debts and balances. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SettleUp } from "../../client/api.js";
import { describeMember, json } from "../present.js";

export function registerReferenceTools(server: McpServer, client: SettleUp): void {
  server.registerTool(
    "list_groups",
    {
      title: "List groups",
      description:
        "Every group the user is in, with its members and currency. Start here: " +
        "members are named per group, and the other tools take those names.",
      inputSchema: {},
    },
    async () =>
      client.withFreshReads(async () =>
        json(
          (await client.groups()).map((g) => ({
            name: g.name,
            id: g.id,
            currency: g.currencyCode,
            you: g.members.find((m) => m.id === g.meMemberId)?.name,
            members: g.members.map(describeMember),
          })),
        ),
      ),
  );

  server.registerTool(
    "group_balances",
    {
      title: "Who owes whom",
      description:
        "The settlement for one group: each member's net position, and the " +
        "transfers that would clear it. Positive net means the member is owed money.",
      inputSchema: {
        group: z.string().describe("Group name from list_groups"),
      },
    },
    async ({ group }) =>
      client.withFreshReads(async () => {
        const [g, balances, debts] = await Promise.all([
          client.group(group),
          client.balances(group),
          client.debts(group),
        ]);
        const name = (id: string) => g.members.find((m) => m.id === id)?.name ?? id;
        return json({
          group: g.name,
          currency: g.currencyCode,
          balances: balances.map((b) => ({
            member: b.name,
            net: Number(b.net.toFixed(2)),
          })),
          settleWith: debts.map((d) => ({
            from: name(d.from),
            to: name(d.to),
            amount: Number(Number(d.amount).toFixed(2)),
          })),
        });
      }),
  );
}
