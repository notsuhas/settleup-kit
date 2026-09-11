/**
 * Creating and editing groups and members.
 *
 * Opt-in, behind SETTLEUP_MCP_ALLOW_STRUCTURE=1. These reshape the account
 * rather than record something in it: a new member changes every balance in
 * the group once they appear in a split, and a new group is a whole container
 * that has to be cleaned up by hand if it was not wanted.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SettleUp } from "../../client/api.js";
import { describeMember, json } from "../present.js";

export const structureAllowed = (): boolean => process.env.SETTLEUP_MCP_ALLOW_STRUCTURE === "1";

export function registerStructureTools(server: McpServer, client: SettleUp): void {
  server.registerTool(
    "create_group",
    {
      title: "Create a group",
      description:
        "Make a new group with its members. The first member is the user, and " +
        "is who expenses default to being paid by. There is no undo — a group " +
        "can only be deleted from the app.",
      inputSchema: {
        name: z.string().min(1),
        currencyCode: z.string().describe('ISO code the debts are shown in, e.g. "INR"'),
        members: z.array(z.string()).min(1).describe("Member names. The first one is the user."),
        minimizeDebts: z.boolean().optional().describe("Fewest transfers to settle up"),
      },
    },
    async (input) => {
      const g = await client.createGroup(input);
      return json({
        created: g.id,
        group: { name: g.name, currency: g.currencyCode, members: g.members.map(describeMember) },
      });
    },
  );

  server.registerTool(
    "edit_group",
    {
      title: "Edit a group",
      description:
        "Rename a group, change the currency its debts are shown in, or toggle " +
        "debt minimisation. Transactions are untouched.",
      inputSchema: {
        group: z.string().describe("Group name from list_groups"),
        name: z.string().optional(),
        currencyCode: z.string().optional(),
        minimizeDebts: z.boolean().optional(),
      },
    },
    async ({ group, ...patch }) => {
      const g = await client.editGroup(group, patch);
      return json({ updated: { name: g.name, currency: g.currencyCode } });
    },
  );

  server.registerTool(
    "add_member",
    {
      title: "Add a member to a group",
      description:
        "Add someone to a group. They are active immediately, so new expenses " +
        "split with them included unless forWhom says otherwise.",
      inputSchema: {
        group: z.string().describe("Group name from list_groups"),
        name: z.string(),
        bankAccount: z.string().optional(),
      },
    },
    async ({ group, ...input }) =>
      json({ added: describeMember(await client.addMember(group, input)) }),
  );

  server.registerTool(
    "edit_member",
    {
      title: "Edit a member",
      description:
        "Rename a member, or set them inactive so new expenses stop including " +
        "them by default. Past transactions and debts are untouched.",
      inputSchema: {
        group: z.string().describe("Group name from list_groups"),
        member: z.string().describe("Current member name"),
        name: z.string().optional(),
        active: z.boolean().optional(),
        bankAccount: z.string().optional(),
      },
    },
    async ({ group, member, ...patch }) =>
      json({
        updated: describeMember(await client.editMember(group, member, patch)),
      }),
  );
}
