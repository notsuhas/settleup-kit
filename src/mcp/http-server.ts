import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { bearerAuthorised } from "./bearer-auth.js";
import type { createMcpRuntime } from "./server.js";

export function createMcpHttpServer(runtime: ReturnType<typeof createMcpRuntime>, token: string) {
  const active = new Set<Promise<void>>();

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const mcp = runtime.createServer();
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
      await mcp.close();
    }
  }

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
    if (!bearerAuthorised(req.headers.authorization, token)) {
      res.writeHead(401, { "content-type": "text/plain" }).end("unauthorized\n");
      return;
    }
    const pending = handleRequest(req, res);
    active.add(pending);
    void pending.finally(() => active.delete(pending)).catch(console.error);
  });

  return {
    server,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await Promise.all([...active]);
      await runtime.close();
    },
  };
}
