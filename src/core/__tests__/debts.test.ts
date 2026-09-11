import assert from "node:assert/strict";
import { test } from "node:test";
import { balances } from "../debts.js";
import { alice, bob, trip } from "./fixtures.js";

test("a debt edge lifts the creditor and drops the debtor by the same amount", () => {
  const rows = balances([{ from: bob.id, to: alice.id, amount: "743.42" }], trip.members);
  assert.equal(rows.find((r) => r.name === "Alice")?.net, 743.42);
  assert.equal(rows.find((r) => r.name === "Bob")?.net, -743.42);
});

test("every member appears, including those with no debts", () => {
  const rows = balances([], trip.members);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.net === 0));
});

test("edges accumulate and net out across members", () => {
  const rows = balances(
    [
      { from: bob.id, to: alice.id, amount: "100" },
      { from: "m_carol", to: alice.id, amount: "50" },
      { from: alice.id, to: bob.id, amount: "30" },
    ],
    trip.members,
  );
  assert.equal(rows.find((r) => r.name === "Alice")?.net, 120);
  assert.equal(rows.find((r) => r.name === "Bob")?.net, -70);
  assert.equal(rows.find((r) => r.name === "Carol")?.net, -50);
});

test("the settlement sums to zero", () => {
  const rows = balances(
    [
      { from: bob.id, to: alice.id, amount: "743.42" },
      { from: "m_carol", to: alice.id, amount: "12.5" },
    ],
    trip.members,
  );
  assert.equal(
    rows.reduce((sum, r) => sum + r.net, 0),
    0,
  );
});

test("creditors sort before debtors", () => {
  const rows = balances([{ from: alice.id, to: bob.id, amount: "10" }], trip.members);
  assert.equal(rows[0]?.name, "Bob");
  assert.equal(rows.at(-1)?.name, "Alice");
});

test("a debt naming someone outside the member list still appears", () => {
  // A member removed after settling leaves edges behind; dropping them would
  // silently unbalance the group.
  const rows = balances([{ from: "m_ghost", to: alice.id, amount: "20" }], trip.members);
  assert.equal(rows.find((r) => r.memberId === "m_ghost")?.net, -20);
});
