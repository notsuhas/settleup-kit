import assert from "node:assert/strict";
import { test } from "node:test";
import { fromMap, type RawTransaction, toMember, toTransaction } from "../normalise.js";

test("a map becomes an array carrying its keys as ids", () => {
  const out = fromMap({ a: { name: "Alice" }, b: { name: "Bob" } }, toMember);
  assert.deepEqual(
    out.map((m) => [m.id, m.name]),
    [
      ["a", "Alice"],
      ["b", "Bob"],
    ],
  );
});

test("a missing collection is empty, not a crash", () => {
  assert.deepEqual(fromMap(null, toMember), []);
});

test("null holes Firebase leaves behind are dropped", () => {
  const out = fromMap({ a: { name: "Alice" }, b: null as never }, toMember);
  assert.equal(out.length, 1);
});

test("a member defaults to active with weight 1", () => {
  const m = toMember("m1", { name: "Alice" });
  assert.equal(m.active, true);
  assert.equal(m.defaultWeight, "1");
  // Absent optionals stay absent rather than becoming undefined keys.
  assert.ok(!("photoUrl" in m));
});

test("the total is summed across every item", () => {
  // Settle Up stores the main expense, the tip and the tax as separate items.
  const raw: RawTransaction = {
    type: "expense",
    purpose: "Dinner",
    currencyCode: "EUR",
    dateTime: 1,
    items: [
      { amount: "1000", forWhom: [] },
      { amount: "120.50", forWhom: [] },
    ],
  };
  assert.equal(toTransaction("t1", raw).amount, "1120.50");
});

test("a transaction with no items totals zero rather than NaN", () => {
  assert.equal(toTransaction("t1", {}).amount, "0");
});

test("defaults fill in for a row missing its optional fields", () => {
  const t = toTransaction("t1", {});
  assert.equal(t.type, "expense");
  assert.equal(t.purpose, "");
  assert.equal(t.fixedExchangeRate, false);
  assert.deepEqual(t.whoPaid, []);
});
