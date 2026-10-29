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
  const reads: string[] = [];
  let rows: Record<string, unknown> = { receipt: expense(10) };
  let rejectWrite = false;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    reads.push(path);
    if (init?.method === "PUT") {
      if (rejectWrite) return Response.json({ error: "rejected" }, { status: 400 });
      rows.receipt = JSON.parse(String(init.body));
      return Response.json(rows.receipt);
    }
    let data: unknown;
    if (path === "/userGroups/test-user/g_trip.json") return Response.json({ member: "m_alice" });
    if (path === "/userGroups/test-user.json") data = { g_trip: { member: "m_alice" } };
    else if (path === "/groups/g_trip.json") data = { name: "Trip", convertedToCurrency: "INR" };
    else if (path === "/members/g_trip.json")
      data = { m_alice: { name: "Alice", active: true }, m_bob: { name: "Bob", active: true } };
    else if (path === "/transactions/g_trip.json") data = rows;
    else if (path.startsWith("/transactions/g_trip/"))
      data = rows[path.slice("/transactions/g_trip/".length, -".json".length)] ?? null;
    else throw new Error("unexpected API path: " + path);
    return Response.json(data);
  }) as typeof fetch;
  const token =
    "header." +
    Buffer.from(
      JSON.stringify({ sub: "test-user", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url") +
    ".signature";
  const server = createMcpServer({ ledgerPath: false, token });
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
    assert.equal(reads.filter((p) => p.startsWith("/userGroups/test-user")).length, 1);
    rows = { receipt: expense(20) };
    assert.equal((await search()).transactions[0].amount, "20");
    reads.length = 0;
    const single = await caller.callTool({
      name: "edit_transaction",
      arguments: { group: "Trip", id: "missing", purpose: "Edit" },
    });
    assert.equal(single.isError, true);
    assert.ok(
      !reads.includes("/transactions/g_trip.json"),
      "single-row lookup skips group history",
    );
    reads.length = 0;
    const edited = await caller.callTool({
      name: "edit_transaction",
      arguments: {
        group: "Trip",
        id: "receipt",
        purpose: "Changed",
        shares: { Alice: 12, Bob: 8 },
      },
    });
    assert.ok(!edited.isError, JSON.stringify(edited));
    assert.match(JSON.stringify(edited), /Changed/);
    assert.equal(reads.filter((p) => p.startsWith("/userGroups/test-user")).length, 1);
    assert.ok(!reads.includes("/transactions/g_trip.json"));
    assert.equal(
      reads.filter((p) => p === "/transactions/g_trip/receipt.json").length,
      4,
      "before, edit source, write and fresh readback",
    );
    const saved = structuredClone(rows);
    rejectWrite = true;
    const failed = await caller.callTool({
      name: "edit_transaction",
      arguments: { group: "Trip", id: "receipt", purpose: "Rejected" },
    });
    assert.equal(failed.isError, true);
    assert.deepEqual(rows, saved);
    rows = {};
    assert.equal((await search()).matched, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await caller.close();
    await server.close();
  }
});
