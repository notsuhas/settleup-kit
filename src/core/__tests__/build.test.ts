import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpense, buildTransfer } from "../build.js";
import { SettleUpError } from "../types.js";
import { alice, bob, spectated, trip } from "./fixtures.js";

const base = { group: "Trip", amount: 1000, purpose: "Dinner" };

test("an expense defaults to the user paying, split across active members only", () => {
  const payload = buildExpense(trip, base);
  assert.equal(payload.type, "expense");
  assert.deepEqual(payload.whoPaid, [{ memberId: alice.id, weight: "1" }]);
  // Carol is inactive, so she is not in the default split.
  assert.deepEqual(payload.items[0]?.forWhom, [
    { memberId: alice.id, weight: "1" },
    { memberId: bob.id, weight: "1" },
  ]);
});

test("an explicit split overrides the active-member default, inactive included", () => {
  const payload = buildExpense(trip, { ...base, forWhom: ["Carol"] });
  assert.deepEqual(payload.items[0]?.forWhom, [{ memberId: "m_carol", weight: "1" }]);
});

test("members resolve by name or by id, case-insensitively", () => {
  const byName = buildExpense(trip, { ...base, paidBy: "bOb" });
  const byId = buildExpense(trip, { ...base, paidBy: bob.id });
  assert.deepEqual(byName.whoPaid, byId.whoPaid);
});

test("the currency defaults to the group's but can be overridden per row", () => {
  assert.equal(buildExpense(trip, base).currencyCode, "INR");
  assert.equal(buildExpense(trip, { ...base, currencyCode: "EUR" }).currencyCode, "EUR");
});

test("an empty description is refused before the server can answer Permission denied", () => {
  assert.throws(() => buildExpense(trip, { ...base, purpose: "" }), SettleUpError);
  assert.throws(() => buildExpense(trip, { ...base, purpose: "   " }), SettleUpError);
});

test("a category is omitted entirely rather than written as undefined", () => {
  assert.ok(!("category" in buildExpense(trip, base)));
  assert.equal(buildExpense(trip, { ...base, category: "🍽" }).category, "🍽");
});

test("an unknown member names the ones that exist", () => {
  assert.throws(
    () => buildExpense(trip, { ...base, paidBy: "Nobody" }),
    (err: Error) => err instanceof SettleUpError && err.message.includes("Bob"),
  );
});

test("a spectator cannot infer who paid", () => {
  assert.throws(() => buildExpense(spectated, base), SettleUpError);
  // ... but naming the payer explicitly still works.
  assert.doesNotThrow(() => buildExpense(spectated, { ...base, paidBy: "Bob" }));
});

test("a transfer moves from one member to one other, and defaults its description", () => {
  const payload = buildTransfer(trip, {
    group: "Trip",
    amount: 500,
    to: "Alice",
    from: "Bob",
  });
  assert.equal(payload.type, "transfer");
  assert.equal(payload.purpose, "Debt settlement");
  assert.deepEqual(payload.whoPaid, [{ memberId: bob.id, weight: "1" }]);
  assert.deepEqual(payload.items, [
    { amount: "500", forWhom: [{ memberId: alice.id, weight: "1" }] },
  ]);
  // A transfer is never categorised.
  assert.ok(!("category" in payload));
});

test("a transfer to yourself is refused", () => {
  assert.throws(
    () =>
      buildTransfer(trip, {
        group: "Trip",
        amount: 500,
        to: "Alice",
        from: "Alice",
      }),
    SettleUpError,
  );
});

test("a bad date is refused rather than silently becoming now", () => {
  assert.throws(() => buildExpense(trip, { ...base, date: "last tuesday" }), SettleUpError);
});

test("a negative or zero amount is refused", () => {
  // Direction comes from expense-vs-transfer, so a sign here is meaningless
  // and would corrupt the group's balances.
  assert.throws(() => buildExpense(trip, { ...base, amount: -100 }), SettleUpError);
  assert.throws(() => buildExpense(trip, { ...base, amount: 0 }), SettleUpError);
  assert.throws(() => buildTransfer(trip, { group: "Trip", amount: -5, to: "Bob" }), SettleUpError);
});

test("the timezone recorded is the one in force on the transaction's own date", () => {
  const offsetOf = (date: string) => buildExpense(trip, { ...base, date }).timezone;
  // Whatever this machine's zone is, a backdated row must not silently borrow
  // today's offset across a DST boundary.
  const expected = (iso: string) => {
    const mins = -new Date(Date.parse(iso)).getTimezoneOffset();
    const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
    return `${mins < 0 ? "-" : "+"}${pad(Math.abs(mins) / 60)}:${pad(Math.abs(mins) % 60)}`;
  };
  assert.equal(offsetOf("2026-01-15"), expected("2026-01-15"));
  assert.equal(offsetOf("2026-07-15"), expected("2026-07-15"));
});

test("description limit matches the native editor for expenses and transfers", () => {
  for (const length of [128, 129]) {
    const input = { ...base, purpose: "x".repeat(length) };
    const build = () => [
      buildExpense(trip, input),
      buildTransfer(trip, { ...input, from: "Alice", to: "Bob" }),
    ];
    if (length === 128) assert.doesNotThrow(build);
    else assert.throws(build, /at most 128 characters/);
  }
});
