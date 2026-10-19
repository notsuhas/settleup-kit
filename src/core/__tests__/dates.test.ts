import assert from "node:assert/strict";
import { test } from "node:test";
import { naming } from "../../mcp/present.js";
import { buildExpense, buildTransfer } from "../build.js";
import { recordedTime, transactionTime } from "../dates.js";
import { toTransaction } from "../normalise.js";
import { applyPatch } from "../patch.js";
import { trip } from "./fixtures.js";

const stamp = "2026-10-19T00:10:00+09:00";
const base = { group: "Trip", amount: 800, purpose: "Ice bars", dateTime: stamp };

test("receipt time round-trips through expenses, transfers, edits and MCP presentation", () => {
  const expense = buildExpense(trip, base);
  const expected = Date.parse(stamp);
  assert.equal(expense.dateTime, expected);
  assert.equal(expense.timezone, "+09:00");
  assert.equal(buildTransfer(trip, { ...base, to: "Bob" }).dateTime, expected);
  const edited = applyPatch({ ...expense, timezone: "+05:30" }, { dateTime: stamp }, trip);
  assert.equal(edited.timezone, "+09:00");
  assert.equal(applyPatch(edited, { purpose: "Orange bars" }, trip).dateTime, expected);
  const shown = naming(trip)(toTransaction("receipt", edited));
  assert.equal(shown.date, "2026-10-19");
  assert.equal(shown.dateTime, "2026-10-19T00:10:00.000+09:00");
  assert.equal(recordedTime(expected, "-04:00"), "2026-10-18T11:10:00.000-04:00");
});

test("ambiguous, contradictory and impossible receipt times fail before a write", () => {
  for (const dateTime of [
    "2026-10-19T11:10:00",
    "2026-02-30T11:10:00Z",
    "2026-10-19T25:10:00Z",
    "garbage",
  ]) {
    assert.throws(() => transactionTime({ dateTime }));
  }
  assert.throws(() => transactionTime({ date: "2026-10-19", dateTime: stamp }));
  assert.equal(transactionTime({ date: "2026-10-19" }).dateTime, Date.parse("2026-10-19"));
});
