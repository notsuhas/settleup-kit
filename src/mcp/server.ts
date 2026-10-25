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
import { registerRecordingTool } from "./tools/recording.js";
import { registerReferenceTools } from "./tools/reference.js";
import { registerStructureTools, structureAllowed } from "./tools/structure.js";
import { registerTransactionTools } from "./tools/transactions.js";

export function createMcpServer(options: ClientOptions = {}): McpServer {
  const client: SettleUp = createClient({
    cacheSeconds: 0,
    ...options,
  });

  const server = new McpServer(
    { name: "settleup", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  registerRecordingTool(server, client);
  registerReferenceTools(server, client);
  registerTransactionTools(server, client);
  if (structureAllowed()) registerStructureTools(server, client);
  if (deletionsAllowed()) registerDeletionTools(server, client);

  return server;
}
