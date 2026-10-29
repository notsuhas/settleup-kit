import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { trip } from "../../core/__tests__/fixtures.js";
import { buildExpense } from "../../core/build.js";
import { createMcpServer } from "../server.js";

test("group ledger survives restart, preserves exact splits and invalidates after a failed edit", async () => {
  const original = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "group-ledger-"));
  let calls = 0;
  let writes = 0;
  let offline = false;
  const expense = buildExpense(trip, {
    group: "Trip",
    amount: 100,
    purpose: "Coffee",
    shares: { Alice: 60, Bob: 40 },
    date: "2026-10-28",
  });
  let rows: Record<string, unknown> = { receipt: expense };
  globalThis.fetch = (async (input, init) => {
    calls++;
    const path = new URL(String(input)).pathname;
    if (offline) return Response.json({ error: "offline" }, { status: 400 });
    if (init?.method === "PUT") {
      writes++;
      rows.receipt = JSON.parse(String(init.body));
      return Response.json({ error: "response lost after commit" }, { status: 503 });
    }
    if (path === "/userGroups/test-user.json")
      return Response.json({ g_trip: { member: "m_alice" } });
    if (path === "/userGroups/test-user/g_trip.json") return Response.json({ member: "m_alice" });
    if (path === "/groups/g_trip.json")
      return Response.json({ name: "Trip", convertedToCurrency: "INR" });
    if (path === "/members/g_trip.json")
      return Response.json({ m_alice: { name: "Alice" }, m_bob: { name: "Bob" } });
    if (path === "/transactions/g_trip.json") return Response.json(rows);
    if (path === "/transactions/g_trip/receipt.json") return Response.json(rows.receipt ?? null);
    throw Error(`Unexpected path ${path}`);
  }) as typeof fetch;
  const token = `header.${Buffer.from(JSON.stringify({ sub: "test-user", exp: Date.now() / 1000 + 3600 })).toString("base64url")}.signature`;
  const start = async () => {
    const server = createMcpServer({ token, ledgerPath: join(directory, "ledger.sqlite") });
    const caller = new Client({ name: "local-ledger-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await caller.connect(b);
    return {
      caller,
      close: async () => {
        await caller.close();
        await server.close();
      },
    };
  };
  let session = await start();
  const search = async (args: Record<string, unknown> = {}) => {
    const r = await session.caller.callTool({
      name: "search_transactions",
      arguments: { group: "Trip", ...args },
    });
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content as { text: string }[])[0]?.text ?? "{}");
  };
  try {
    const first = await search();
    assert.equal(first.sync.source, "api");
    const count = calls;
    assert.equal((await search({ purpose: "Coffee" })).matched, 1);
    assert.equal(calls, count);
    await session.close();
    session = await start();
    offline = true;
    assert.deepEqual((await search()).transactions[0].split, first.transactions[0].split);
    assert.equal(calls, count);
    const fresh = await session.caller.callTool({
      name: "search_transactions",
      arguments: { group: "Trip", fresh: true },
    });
    assert.equal(fresh.isError, true);
    offline = false;
    const edited = await session.caller.callTool({
      name: "edit_transaction",
      arguments: { group: "Trip", id: "receipt", purpose: "Tea" },
    });
    assert.equal(edited.isError, true);
    assert.equal(writes, 1);
    assert.equal((await search()).transactions[0].purpose, "Tea");
    rows = {};
    assert.equal((await search({ fresh: true })).matched, 0);
    assert.equal((await search()).matched, 0);
  } finally {
    await session.close();
    globalThis.fetch = original;
    rmSync(directory, { recursive: true, force: true });
  }
});
