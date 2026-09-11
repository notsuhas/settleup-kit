/**
 * The MCP tool surface.
 *
 * Reading groups and balances, and transaction CRUD, are always available.
 * Creating and editing **groups and members** is opt-in behind
 * SETTLEUP_MCP_ALLOW_STRUCTURE=1, because those reshape the account rather
 * than record something in it. Deleting a group is a flag again,
 * SETTLEUP_MCP_ALLOW_DELETE=1, because it is the only thing here that takes
 * data with it and cannot be walked back.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SettleUp } from "../client/api.js";
import { type ClientOptions, createClient } from "../client/index.js";
import { INSTRUCTIONS } from "./present.js";
import { deletionsAllowed, registerDeletionTools } from "./tools/deletions.js";
import { registerReferenceTools } from "./tools/reference.js";
import { registerStructureTools, structureAllowed } from "./tools/structure.js";
import { registerTransactionTools } from "./tools/transactions.js";

/**
 * How long the MCP server reuses a read.
 *
 * Longer than the library default because this process is long-lived and the
 * group list barely changes. Writes invalidate the group they touched, so a
 * stale row is not a risk; the cost is that a change made in the phone app
 * takes a few minutes to show up.
 */
const CACHE_SECONDS = 300;

export function createMcpServer(options: ClientOptions = {}): McpServer {
  const client: SettleUp = createClient({
    cacheSeconds: CACHE_SECONDS,
    ...options,
  });

  // Warm the group list off the critical path, so the first tool call does not
  // pay for the login too. Failures are ignored: the real call reports properly.
  void client.groups().catch(() => {});

  const server = new McpServer(
    { name: "settleup", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  registerReferenceTools(server, client);
  registerTransactionTools(server, client);
  if (structureAllowed()) registerStructureTools(server, client);
  if (deletionsAllowed()) registerDeletionTools(server, client);

  return server;
}
