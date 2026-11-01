import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMcpHttpServer } from "../http-server.js";
import { createMcpRuntime } from "../server.js";

test("HTTP isolates overlapping transports, retains the ledger and drains active tools on shutdown", {
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "http-mcp-"));
  const runtime = createMcpRuntime({ ledgerPath: join(directory, "ledger.sqlite") });
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let disposed = false;
  const http = createMcpHttpServer(
    {
      createServer: () => {
        const server = runtime.createServer();
        server.registerTool("wait", { inputSchema: {} }, async () => {
          enter();
          await pending;
          return { content: [{ type: "text", text: "finished" }] };
        });
        return server;
      },
      close: async () => {
        await runtime.close();
        disposed = true;
      },
    },
    "test-token",
  );
  http.server.listen(0, "127.0.0.1");
  await once(http.server, "listening");
  const address = http.server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const headers = {
    authorization: "Bearer test-token",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const send = (method: string, id: number, params: object = {}) =>
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  const slow = request(url, { method: "POST", headers });
  slow.on("error", () => {});
  const slowResponse = new Promise<number | undefined>((resolve) => {
    slow.on("response", (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
  });
  let closing: Promise<void> | undefined;
  const slowStarted = once(http.server, "request");
  slow.write('{"jsonrpc":"2.0",');
  await slowStarted;
  try {
    const initialized = await send("initialize", 2, {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.equal(initialized.status, 200);
    assert.ok(JSON.parse(await initialized.text()).result.serverInfo.version);
    slow.end('"id":1,"method":"tools/list","params":{}}');
    assert.equal(await slowResponse, 200);
    const status = await send("tools/call", 3, { name: "ledger_status", arguments: {} });
    assert.equal(status.status, 200);
    assert.ok(!JSON.parse(await status.text()).result.isError);
    assert.equal(
      (await fetch(url, { method: "POST", headers: { ...headers, authorization: "Bearer wrong" } }))
        .status,
      401,
    );
    const waiting = send("tools/call", 4, { name: "wait", arguments: {} });
    await entered;
    closing = http.close();
    assert.equal(disposed, false);
    release();
    const completed = await waiting;
    assert.equal(completed.status, 200);
    assert.equal(JSON.parse(await completed.text()).result.content[0].text, "finished");
    await closing;
    assert.equal(disposed, true);
  } finally {
    release();
    slow.destroy();
    await (closing ?? http.close());
    rmSync(directory, { recursive: true, force: true });
  }
});
