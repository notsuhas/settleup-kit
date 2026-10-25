import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SettleUp } from "../../client/api.js";
import { buildExpense } from "../../core/build.js";
import { toTransaction } from "../../core/normalise.js";
import { createRecorder } from "../../core/recording.js";
import type { NewExpense, Transaction } from "../../core/types.js";
import { DATE_TIME, json, naming } from "../present.js";

interface IRecording {
  input: NewExpense;
  expected: Transaction;
}

function comparable(row: Transaction): string {
  return JSON.stringify({
    type: row.type,
    purpose: row.purpose,
    currencyCode: row.currencyCode,
    dateTime: row.dateTime,
    timezone: row.timezone,
    category: row.category,
    whoPaid: row.whoPaid,
    items: row.items,
  });
}

export function registerRecordingTool(server: McpServer, client: SettleUp): void {
  const record = createRecorder<IRecording, Transaction>({
    creationIsServerReadback: true,
    directory: async (inputs) => {
      const account = await client.account();
      const key = createHash("sha256")
        .update(`${account.uid}:${inputs[0]?.input.group}`)
        .digest("hex");
      return join(
        process.env.SETTLEUP_CONFIG_DIR ??
          process.env.XDG_CONFIG_HOME ??
          join(homedir(), ".config"),
        "settleup-kit",
        "receipts",
        key,
      );
    },
    list: (inputs) => client.transactions(inputs[0]?.input.group ?? ""),
    identity: (row, input) =>
      (row.purpose === input.expected.purpose ||
        (row.amount === input.expected.amount &&
          row.currencyCode === input.expected.currencyCode)) &&
      row.dateTime === input.expected.dateTime,
    verify: (row, input) => {
      if (comparable(row) !== comparable(input.expected))
        throw new Error("Receipt fields or exact split conflict; no overwrite attempted");
    },
    create: async (inputs) => {
      const rows: Transaction[] = [];
      for (const { input } of inputs) rows.push(await client.addExpense(input));
      return rows;
    },
  });
  server.registerTool(
    "record_expense",
    {
      title: "Record and verify one receipt",
      description:
        "Preferred for a new receipt: checks duplicates, records the full bill with exact payer and split, and verifies saved server data in one call. Reuse receiptId and identical inputs on retries. verified=true includes independent verification; no further search is needed. An uncertain write must be reconciled, never retried with a new ID.",
      inputSchema: {
        original: z
          .object({ amount: z.number().positive(), currency: z.string().length(3) })
          .optional(),
        receiptId: z.string().min(3).max(128),
        group: z.string(),
        amount: z.number().positive(),
        purpose: z.string().min(1).max(128),
        dateTime: DATE_TIME,
        paidBy: z.array(z.string()).min(1).optional(),
        forWhom: z.array(z.string()).min(1).optional(),
        shares: z.record(z.string(), z.union([z.number().nonnegative(), z.string()])).optional(),
        currencyCode: z.string().optional(),
        category: z.string().optional(),
      },
    },
    async ({ receiptId, ...input }) =>
      client.withFreshReads(async () => {
        const group = await client.group(input.group);
        const canonical = { ...input, group: group.id };
        const expected = toTransaction("expected", buildExpense(group, canonical));
        const [row] = await record(receiptId, [{ input: canonical, expected }]);
        if (!row) throw new Error("Receipt verification failed");
        return json({ verified: true, transaction: naming(group)(row) });
      }),
  );
}
