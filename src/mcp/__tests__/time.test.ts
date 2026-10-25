import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SettleUp } from "../../client/api.js";
import { trip } from "../../core/__tests__/fixtures.js";
import { buildExpense, buildTransfer } from "../../core/build.js";
import { type RawTransaction, toTransaction } from "../../core/normalise.js";
import { applyPatch } from "../../core/patch.js";
import type { NewExpense, NewTransfer, TransactionPatch } from "../../core/types.js";
import { registerTransactionTools } from "../tools/transactions.js";

test("MCP accepts receipt times on expenses, transfers and edits and rejects ambiguous times", async () => {
  let row: RawTransaction = {};
  const client = {
    withFreshReads: <T>(operation: () => Promise<T>) => operation(),
    group: async () => trip,
    addExpense: async (input: NewExpense) => {
      row = buildExpense(trip, input);
      return toTransaction("receipt", row);
    },
    addTransfer: async (input: NewTransfer) => {
      row = buildTransfer(trip, input);
      return toTransaction("receipt", row);
    },
    transaction: async () => toTransaction("receipt", row),
    editTransaction: async (_group: string, _id: string, patch: TransactionPatch) => {
      row = applyPatch(row, patch, trip);
      return toTransaction("receipt", row);
    },
  } as unknown as SettleUp;
  const server = new McpServer({ name: "test", version: "1" });
  registerTransactionTools(server, client);
  const caller = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await caller.connect(b);
  try {
    const dateTime = "2026-10-19T00:10:00+09:00";
    for (const [name, args] of [
      ["add_expense", { group: "Trip", amount: 800, purpose: "Ice bars", dateTime }],
      ["add_transfer", { group: "Trip", amount: 400, to: "Bob", dateTime }],
      ["edit_transaction", { group: "Trip", id: "receipt", dateTime }],
      ["edit_transaction", { group: "Trip", id: "receipt", purpose: "Updated" }],
    ] as const) {
      const result = await caller.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.match(JSON.stringify(result), /2026-10-19T00:10:00.000\+09:00/);
    }
    const bad = await caller.callTool({
      name: "add_expense",
      arguments: { group: "Trip", amount: 800, purpose: "Bad", dateTime: "2026-10-19T11:10:00" },
    });
    assert.equal(bad.isError, true);
    assert.equal(row.purpose, "Updated");
    const custom = await caller.callTool({
      name: "add_expense",
      arguments: {
        group: "Trip",
        amount: 1212,
        purpose: "Desserts",
        paidBy: ["Bob"],
        shares: { Alice: 508, Bob: 704 },
        dateTime,
      },
    });
    assert.ok(!custom.isError, JSON.stringify(custom));
    const [content] = custom.content as { text: string }[];
    assert.ok(content);
    const saved = JSON.parse(content.text).transaction;
    assert.equal(saved.amount, "1212");
    assert.equal(saved.split.length, 1);
    assert.deepEqual(saved.split[0].forWhom, [
      { member: "Alice", weight: "127" },
      { member: "Bob", weight: "176" },
    ]);
    const edit = await caller.callTool({
      name: "edit_transaction",
      arguments: { group: "Trip", id: "receipt", shares: { Alice: 500, Bob: 712 } },
    });
    assert.ok(!edit.isError, JSON.stringify(edit));
    const snapshot = structuredClone(row);
    const invalid = await caller.callTool({
      name: "edit_transaction",
      arguments: { group: "Trip", id: "receipt", shares: { Alice: 500, Bob: 711 } },
    });
    assert.equal(invalid.isError, true);
    assert.deepEqual(row, snapshot);
  } finally {
    await caller.close();
    await server.close();
  }
});
