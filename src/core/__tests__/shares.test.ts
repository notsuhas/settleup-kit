import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpense } from "../build.js";
import { applyPatch } from "../patch.js";
import { SettleUpError } from "../types.js";
import { alice, bob, trip } from "./fixtures.js";

test("exact shares create one weighted expense and edits preserve unrelated fields", () => {
  const base = { group: "Trip", amount: 1212, purpose: "Desserts", paidBy: "Bob" };
  const expense = buildExpense(trip, { ...base, shares: { Alice: 508, Bob: 704, Carol: 0 } });
  assert.equal(expense.items.length, 1);
  assert.deepEqual(expense.whoPaid, [{ memberId: bob.id, weight: "1" }]);
  assert.deepEqual(expense.items[0]?.forWhom, [
    { memberId: alice.id, weight: "127" },
    { memberId: bob.id, weight: "176" },
  ]);
  const before = { ...expense, receiptUrl: "keep", exchangeRates: { EUR: "2" } };
  const snapshot = structuredClone(before);
  const edited = applyPatch(before, { shares: { Alice: 500, Bob: 712 } }, trip);
  assert.deepEqual(edited.items?.[0]?.forWhom, [
    { memberId: alice.id, weight: "125" },
    { memberId: bob.id, weight: "178" },
  ]);
  assert.deepEqual(edited.exchangeRates, before.exchangeRates);
  assert.equal(edited.receiptUrl, "keep");
  assert.deepEqual(before, snapshot);
  const decimal = buildExpense(trip, {
    ...base,
    amount: "0.30",
    shares: { Alice: "0.10", Bob: 0.2 },
  });
  assert.deepEqual(
    decimal.items[0]?.forWhom.map((member) => member.weight),
    ["1", "2"],
  );
  const invalidShares: Record<string, number>[] = [
    {},
    { Alice: 508, Bob: 703 },
    { Alice: -1, Bob: 1213 },
    { Nobody: 1212 },
    { Alice: 508, [alice.id]: 704 },
  ];
  for (const shares of invalidShares) {
    assert.throws(() => buildExpense(trip, { ...base, shares }), SettleUpError);
  }
  assert.throws(
    () => buildExpense(trip, { ...base, shares: { Alice: 1212 }, forWhom: ["Alice"] }),
    SettleUpError,
  );
  assert.throws(
    () => applyPatch(before, { shares: { Alice: 1212 }, forWhom: ["Alice"] }, trip),
    SettleUpError,
  );
  assert.throws(
    () => applyPatch({ ...before, type: "transfer" }, { shares: { Alice: 1212 } }, trip),
    SettleUpError,
  );
  assert.throws(
    () =>
      applyPatch(
        { ...before, items: [...expense.items, ...expense.items] },
        { shares: { Alice: 2424 } },
        trip,
      ),
    SettleUpError,
  );
});
