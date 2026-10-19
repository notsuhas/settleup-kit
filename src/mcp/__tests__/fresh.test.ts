import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { trip } from "../../core/__tests__/fixtures.js";
import { buildExpense } from "../../core/build.js";
import { createMcpServer } from "../server.js";

test("consecutive MCP reads see server edits and deletions immediately", async () => {
  const originalFetch = globalThis.fetch;
  const expense = (amount: number) =>
    buildExpense(trip, { group: "Trip", amount, purpose: "Coffee", date: "2026-10-19" });
  let rows: Record<string, unknown> = { receipt: expense(10) };
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    let data: unknown;
    if (path === "/userGroups/test-user.json") data = { g_trip: { member: "m_alice" } };
    else if (path === "/groups/g_trip.json") data = { name: "Trip", convertedToCurrency: "INR" };
    else if (path === "/members/g_trip.json")
      data = { m_alice: { name: "Alice", active: true }, m_bob: { name: "Bob", active: true } };
    else if (path === "/transactions/g_trip.json") data = rows;
    else throw new Error("unexpected API path: " + path);
    return Response.json(data);
  }) as typeof fetch;
  const token =
    "header." +
    Buffer.from(
      JSON.stringify({ sub: "test-user", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url") +
    ".signature";
  const server = createMcpServer({ token });
  const caller = new Client({ name: "fresh-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await caller.connect(b);
  const search = async () => {
    const result = await caller.callTool({
      name: "search_transactions",
      arguments: { group: "Trip" },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    const [content] = result.content as { text: string }[];
    assert.ok(content);
    return JSON.parse(content.text);
  };
  try {
    assert.equal((await search()).transactions[0].amount, "10");
    rows = { receipt: expense(20) };
    assert.equal((await search()).transactions[0].amount, "20");
    rows = {};
    assert.equal((await search()).matched, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await caller.close();
    await server.close();
  }
});
