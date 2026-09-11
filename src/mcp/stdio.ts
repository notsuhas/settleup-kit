#!/usr/bin/env node
/**
 * MCP over stdio — for Claude Desktop, Claude Code, Cursor, and anything else
 * that spawns a local server. Configuration comes from the environment; see
 * docs/mcp.md.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

const server = createMcpServer();
await server.connect(new StdioServerTransport());
