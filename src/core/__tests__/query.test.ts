import assert from "node:assert/strict";
import { test } from "node:test";
import { filterTransactions, findGroup, findMember } from "../query.js";
import type { Transaction } from "../types.js";
import { SettleUpError } from "../types.js";
import { trip } from "./fixtures.js";

const at = (date: string): number => Date.parse(`${date}T09:00:00Z`);

const row = (
  id: string,
  date: string,
  amount: string,
  over: Partial<Transaction> = {},
): Transaction => ({
  id,
  type: "expense",
  purpose: "Dinner",
  currencyCode: "EUR",
  dateTime: at(date),
  whoPaid: [],
  items: [],
  amount,
  fixedExchangeRate: false,
  ...over,
});

const rows: Transaction[] = [
  row("a", "2026-09-01", "1000"),
  row("b", "2026-09-10", "2500", { purpose: "Train tickets" }),
  row("c", "2026-09-20", "500", {
    type: "transfer",
    purpose: "Debt settlement",
  }),
];

test("finds a group by name case-insensitively, or by id", () => {
  assert.equal(findGroup([trip], "TRIP").id, "g_trip");
  assert.equal(findGroup([trip], "g_trip").id, "g_trip");
});

test("an unknown group or member fails rather than returning undefined", () => {
  assert.throws(() => findGroup([trip], "Korea"), SettleUpError);
  assert.throws(() => findMember(trip.members, "Nobody"), SettleUpError);
});

test("finds a member by name or id", () => {
  assert.equal(findMember(trip.members, "BOB").id, "m_bob");
  assert.equal(findMember(trip.members, "m_bob").name, "Bob");
});

test("no query returns everything, newest first", () => {
  assert.deepEqual(
    filterTransactions(rows).map((t) => t.id),
    ["c", "b", "a"],
  );
});

test("purpose matches a case-insensitive substring", () => {
  assert.deepEqual(
    filterTransactions(rows, { purpose: "TICKETS" }).map((t) => t.id),
    ["b"],
  );
});

test("type narrows to expenses or transfers", () => {
  assert.deepEqual(
    filterTransactions(rows, { type: "transfer" }).map((t) => t.id),
    ["c"],
  );
});

test("a date range is inclusive at both ends", () => {
  // `to` names a day, so a row timestamped later that same day must survive.
  assert.deepEqual(
    filterTransactions(rows, { from: "2026-09-01", to: "2026-09-10" }).map((t) => t.id),
    ["b", "a"],
  );
});

test("amount bounds compare the total", () => {
  assert.deepEqual(
    filterTransactions(rows, { minAmount: 600, maxAmount: 2000 }).map((t) => t.id),
    ["a"],
  );
});

test("filters combine, and the limit applies after sorting", () => {
  assert.deepEqual(
    filterTransactions(rows, { type: "expense", limit: 1 }).map((t) => t.id),
    ["b"],
  );
});

test("an unparseable date bound fails instead of silently matching everything", () => {
  // Date.parse answers NaN, and every comparison with NaN is false — so this
  // used to return the whole list and look like a successful filter.
  assert.throws(() => filterTransactions(rows, { from: "last tuesday" }), SettleUpError);
  assert.throws(() => filterTransactions(rows, { to: "" }), SettleUpError);
});

test("a limit that is not a positive whole number is refused", () => {
  // `slice(0, -1)` quietly dropped the newest row.
  assert.throws(() => filterTransactions(rows, { limit: -1 }), SettleUpError);
  assert.throws(() => filterTransactions(rows, { limit: 0 }), SettleUpError);
  assert.throws(() => filterTransactions(rows, { limit: 1.5 }), SettleUpError);
});

test("a bare date bound covers the whole day, a timestamp means that instant", () => {
  const sameDay = [row("x", "2026-09-10", "10")];
  // "2026-09-10" includes a row timestamped later that same day...
  assert.equal(filterTransactions(sameDay, { to: "2026-09-10" }).length, 1);
  // ...but an explicit instant before it does not.
  assert.equal(filterTransactions(sameDay, { to: "2026-09-10T00:00:00Z" }).length, 0);
});
