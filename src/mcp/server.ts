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
import { createClient } from "../client/index.js";
import type { Ledger } from "../core/ledger.js";
import { createLedger, createLocalReads, type ILedgerOptions, observeWrites } from "./ledger.js";
import { INSTRUCTIONS, json } from "./present.js";
import { deletionsAllowed, registerDeletionTools } from "./tools/deletions.js";
import { registerRecordingTool } from "./tools/recording.js";
import { registerReferenceTools } from "./tools/reference.js";
import { registerStructureTools, structureAllowed } from "./tools/structure.js";
import { registerTransactionTools } from "./tools/transactions.js";

export function createMcpServer(options: ILedgerOptions = {}): McpServer {
  const ledger: Ledger | undefined = createLedger(options);
  const client: SettleUp = observeWrites(
    createClient({
      cacheSeconds: 0,
      ...options,
    }),
    ledger,
  );

  const server = new McpServer(
    { name: "settleup", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  const reads = createLocalReads(client, ledger);
  const close = server.close.bind(server);
  server.close = async () => {
    try {
      await close();
    } finally {
      await ledger?.drain();
      ledger?.close();
    }
  };
  if (ledger)
    server.registerTool(
      "ledger_status",
      {
        title: "Local ledger sync status",
        annotations: { readOnlyHint: true },
        description:
          "Local snapshot timestamps, invalidation and reconciliation errors. No provider calls. Use fresh=true for an API audit.",
        inputSchema: {},
      },
      async () => json({ snapshots: ledger.status() }),
    );
  registerRecordingTool(server, client);
  registerReferenceTools(server, client, reads);
  registerTransactionTools(server, client, reads);
  if (structureAllowed()) registerStructureTools(server, client);
  if (deletionsAllowed()) registerDeletionTools(server, client);

  return server;
}
