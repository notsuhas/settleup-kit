/**
 * Deleting a group over MCP.
 *
 * Behind its own flag, separate from the other structure tools, because this
 * is the one thing here nothing can walk back: it takes every transaction in
 * the group with it, and Settle Up has no undo. Set
 * SETTLEUP_MCP_ALLOW_DELETE=1 to register it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SettleUp } from "../../client/api.js";
import { json } from "../present.js";

/** Whether the delete tool should be registered at all. */
export const deletionsAllowed = (): boolean => process.env.SETTLEUP_MCP_ALLOW_DELETE === "1";

export function registerDeletionTools(server: McpServer, client: SettleUp): void {
  server.registerTool(
    "delete_group",
    {
      title: "Delete a group",
      description:
        "Delete a group AND every transaction in it. This cannot be undone — " +
        "confirm the group name and what it contains with the user first.",
      inputSchema: { group: z.string().describe("Group name, spelled out") },
    },
    async ({ group }) => {
      const gone = await client.deleteGroup(group);
      return json({ deleted: { name: gone.name, members: gone.members.length } });
    },
  );
}
