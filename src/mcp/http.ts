#!/usr/bin/env node
import { createMcpHttpServer } from "./http-server.js";
import { createMcpRuntime } from "./server.js";

const PORT = Number(process.env.MCP_PORT ?? 8791);
const HOST = process.env.MCP_HOST ?? "0.0.0.0";
const TOKEN = process.env.MCP_TOKEN;

if (!TOKEN) {
  console.error("MCP_TOKEN is required: this endpoint can create and delete transactions.");
  process.exit(1);
}

const http = createMcpHttpServer(createMcpRuntime(), TOKEN);
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void http
      .close()
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  });
}

http.server.listen(PORT, HOST, () => {
  console.error(`settleup mcp listening on http://${HOST}:${PORT}/mcp`);
});
