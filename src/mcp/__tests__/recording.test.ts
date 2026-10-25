import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server.js";

test("receipt tool returns verified exact shares with one duplicate scan and survives retry", async () => {
  const fetchBefore = globalThis.fetch;
  const beforeDirectory = process.env.SETTLEUP_CONFIG_DIR;
  const directory = mkdtempSync(join(tmpdir(), "receipt-mcp-"));
  process.env.SETTLEUP_CONFIG_DIR = directory;
  let writes = 0;
  let scans = 0;
  let row: unknown;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    let data: unknown;
    if (path === "/userGroups/test-user.json") data = { group: { member: "alice" } };
    else if (path === "/users/test-user.json") data = { email: "test@example.com" };
    else if (path === "/groups/group.json") data = { name: "Trip", convertedToCurrency: "INR" };
    else if (path === "/members/group.json")
      data = { alice: { name: "Alice", active: true }, bob: { name: "Bob", active: true } };
    else if (path === "/transactions/group.json" && init?.method === "POST") {
      writes++;
      row = JSON.parse(String(init.body));
      data = { name: "receipt" };
    } else if (path === "/transactions/group.json") {
      scans++;
      data = row ? { receipt: row } : {};
    } else if (path === "/transactions/group/receipt.json") data = row;
    else throw new Error(`Unexpected path ${path}`);
    return Response.json(data);
  }) as typeof fetch;
  const token = `header.${Buffer.from(JSON.stringify({ sub: "test-user", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
  const server = createMcpServer({ token });
  const caller = new Client({ name: "receipt-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await caller.connect(b);
  try {
    const args = {
      receiptId: "receipt-123",
      group: "Trip",
      amount: 100,
      purpose: "Lunch",
      dateTime: "2026-10-20T12:00:00+09:00",
      paidBy: ["Bob"],
      shares: { Alice: 60, Bob: 40 },
    };
    const call = (input = args) => caller.callTool({ name: "record_expense", arguments: input });
    const result = await call();
    assert.ok(!result.isError, JSON.stringify(result));
    assert.match(JSON.stringify(result), /verified/);
    assert.equal(writes, 1);
    assert.equal(scans, 1);
    assert.ok(!(await call()).isError);
    assert.equal(writes, 1);
    assert.equal(scans, 2);
    assert.equal((await call({ ...args, shares: { Alice: 50, Bob: 50 } })).isError, true);
    assert.equal(writes, 1);
  } finally {
    await caller.close();
    await server.close();
    globalThis.fetch = fetchBefore;
    if (beforeDirectory === undefined) delete process.env.SETTLEUP_CONFIG_DIR;
    else process.env.SETTLEUP_CONFIG_DIR = beforeDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
});
