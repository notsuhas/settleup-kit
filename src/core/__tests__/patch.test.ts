import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTransaction } from "../normalise.js";
import { applyPatch } from "../patch.js";
import { SettleUpError } from "../types.js";
import { alice, bob, trip } from "./fixtures.js";

/** A row with a receipt, a tip line and an uneven split — everything an edit could destroy. */
const live: RawTransaction = {
  type: "expense",
  purpose: "Dinner",
  category: "🍽",
  currencyCode: "EUR",
  dateTime: Date.parse("2026-09-10T12:00:00Z"),
  timezone: "+05:30",
  fixedExchangeRate: false,
  exchangeRates: { INR: "1.61" },
  receiptUrl: "https://example.test/receipt.jpg",
  whoPaid: [{ memberId: alice.id, weight: "1" }],
  items: [
    { amount: "3200", forWhom: [{ memberId: alice.id, weight: "1" }] },
    { amount: "300", forWhom: [{ memberId: bob.id, weight: "1" }] },
  ],
};

test("an amount-only edit preserves everything else on the row", () => {
  const next = applyPatch(live, { amount: 4000 }, trip);
  assert.equal(next.items?.[0]?.amount, "4000");
  assert.equal(next.purpose, "Dinner");
  assert.equal(next.category, "🍽");
  assert.equal(next.receiptUrl, live.receiptUrl);
  assert.equal(next.timezone, "+05:30");
  // The split it did not mention survives.
  assert.deepEqual(next.items?.[0]?.forWhom, [{ memberId: alice.id, weight: "1" }]);
});

test("the tip line is left alone when the main amount changes", () => {
  const next = applyPatch(live, { amount: 4000 }, trip);
  assert.equal(next.items?.length, 2);
  assert.deepEqual(next.items?.[1], live.items?.[1]);
});

test("re-splitting keeps the amount, and re-pricing keeps the split", () => {
  const resplit = applyPatch(live, { forWhom: ["Alice", "Bob"] }, trip);
  assert.equal(resplit.items?.[0]?.amount, "3200");
  assert.equal(resplit.items?.[0]?.forWhom?.length, 2);

  const repriced = applyPatch(live, { amount: 1 }, trip);
  assert.deepEqual(repriced.items?.[0]?.forWhom, live.items?.[0]?.forWhom);
});

test("a stale exchange rate is dropped so the server recomputes it", () => {
  assert.ok(!("exchangeRates" in applyPatch(live, { amount: 4000 }, trip)));
});

test("a rate pinned on purpose is kept", () => {
  const pinned = { ...live, fixedExchangeRate: true };
  assert.deepEqual(applyPatch(pinned, { amount: 4000 }, trip).exchangeRates, { INR: "1.61" });
});

test("null clears the category, undefined leaves it", () => {
  assert.ok(!("category" in applyPatch(live, { category: null }, trip)));
  assert.equal(applyPatch(live, { amount: 1 }, trip).category, "🍽");
  assert.equal(applyPatch(live, { category: "🥐" }, trip).category, "🥐");
});

test("the description cannot be edited to empty", () => {
  // Settle Up would answer "Permission denied"; fail with the real reason.
  assert.throws(() => applyPatch(live, { purpose: "" }, trip), SettleUpError);
  assert.throws(() => applyPatch(live, { purpose: "  " }, trip), SettleUpError);
});

test("payers resolve by name and replace the previous list", () => {
  const next = applyPatch(live, { paidBy: ["Bob"] }, trip);
  assert.deepEqual(next.whoPaid, [{ memberId: bob.id, weight: "1" }]);
});

test("an unknown member in a patch fails rather than writing a bad id", () => {
  assert.throws(() => applyPatch(live, { forWhom: ["Ganesh"] }, trip), SettleUpError);
});

test("a bad date is refused", () => {
  assert.throws(() => applyPatch(live, { date: "whenever" }, trip), SettleUpError);
  assert.equal(applyPatch(live, { date: "2026-09-20" }, trip).dateTime, Date.parse("2026-09-20"));
});

test("the live row is not mutated", () => {
  const snapshot = JSON.stringify(live);
  applyPatch(live, { amount: 9999, forWhom: ["Bob"], category: null }, trip);
  assert.equal(JSON.stringify(live), snapshot);
});

test("an edit cannot sneak past the rules the add path enforces", () => {
  // An empty list here would write a row paid by nobody or owed by nobody,
  // which breaks the server's settlement for the whole group.
  assert.throws(() => applyPatch(live, { forWhom: [] }, trip), SettleUpError);
  assert.throws(() => applyPatch(live, { paidBy: [] }, trip), SettleUpError);
  assert.throws(() => applyPatch(live, { amount: -100 }, trip), SettleUpError);
  assert.throws(() => applyPatch(live, { amount: 0 }, trip), SettleUpError);
});

test("timestamp and description edits preserve the recorded exchange rates", () => {
  for (const patch of [{ dateTime: "2026-10-19T11:10:00+09:00" }, { purpose: "Orange ice bars" }]) {
    assert.deepEqual(applyPatch(live, patch, trip).exchangeRates, live.exchangeRates);
  }
});

test("description edits reject overlong text while preserving existing descriptions", () => {
  assert.equal(applyPatch(live, { purpose: "x".repeat(128) }, trip).purpose?.length, 128);
  assert.throws(
    () => applyPatch(live, { purpose: "x".repeat(129) }, trip),
    /at most 128 characters/,
  );
  assert.equal(applyPatch(live, { amount: 4000 }, trip).purpose, live.purpose);
});
