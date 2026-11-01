import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server.js";

test("MCP server advertises the published package version", async () => {
  const { version } = createRequire(import.meta.url)("@notsuhas/settleup-kit/package.json") as {
    version: string;
  };
  const server = createMcpServer({ ledgerPath: false });
  const caller = new Client({ name: "version-test", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(local);
  await caller.connect(remote);
  assert.equal(caller.getServerVersion()?.version, version);
  await server.close();
});
