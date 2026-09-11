#!/usr/bin/env node
/**
 * MCP over streamable HTTP — for running the server somewhere and pointing a
 * remote client at it.
 *
 * Requires MCP_TOKEN, and refuses to start without one: this endpoint writes to a
 * real shared-expense account, so an unauthenticated port is never the right default.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

const PORT = Number(process.env.MCP_PORT ?? 8791);
const HOST = process.env.MCP_HOST ?? "0.0.0.0";
const TOKEN = process.env.MCP_TOKEN;

if (!TOKEN) {
  console.error("MCP_TOKEN is required: this endpoint can create and delete transactions.");
  process.exit(1);
}

/** Constant-time compare, so a wrong token cannot be found a byte at a time. */
function authorised(header: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  const actual = Buffer.from(header ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * One server for the process.
 *
 * Building it per request would rebuild the client and its cache every time —
 * so `initialize` and `tools/list`, which need no data at all, would each pay
 * for a full read of every group, and the documented five-minute cache would
 * never survive a single request. The transport stays per-request, because a
 * stateless transport is what lets remote clients reconnect freely.
 */
const mcp = createMcpServer();

const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];

  if (path === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
    return;
  }
  if (path !== "/mcp") {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
    return;
  }
  if (!authorised(req.headers.authorization)) {
    res.writeHead(401, { "content-type": "text/plain" }).end("unauthorized\n");
    return;
  }

  void (async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500).end();
    } finally {
      await transport.close();
    }
  })();
});

server.listen(PORT, HOST, () => {
  console.error(`settleup mcp listening on http://${HOST}:${PORT}/mcp`);
});
