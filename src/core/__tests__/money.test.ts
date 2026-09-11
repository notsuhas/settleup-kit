import assert from "node:assert/strict";
import { test } from "node:test";
import { amountString, positiveAmount, sumAmounts } from "../money.js";
import { SettleUpError } from "../types.js";

test("sums integers without a decimal point", () => {
  assert.equal(sumAmounts(["1200", "406", "408"]), "2014");
});

test("keeps the widest fraction any input used", () => {
  assert.equal(sumAmounts(["10", "0.50"]), "10.50");
  assert.equal(sumAmounts(["1.5", "2.25"]), "3.75");
});

test("adds exactly where floats would drift", () => {
  // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
  assert.equal(sumAmounts(["0.1", "0.2"]), "0.3");
  // A hundred 0.01s is the classic accumulation error.
  assert.equal(sumAmounts(Array(100).fill("0.01")), "1.00");
});

test("handles the empty list and negatives", () => {
  assert.equal(sumAmounts([]), "0");
  assert.equal(sumAmounts(["10.00", "-2.50"]), "7.50");
  assert.equal(sumAmounts(["-5", "5"]), "0");
});

test("rejects anything that is not a decimal", () => {
  assert.throws(() => sumAmounts(["12abc"]), SettleUpError);
  assert.throws(() => sumAmounts([""]), SettleUpError);
});

test("amountString passes a valid string through untouched", () => {
  // The string form is authoritative: reformatting "1200.00" to "1200" would
  // change what the app displays.
  assert.equal(amountString("1200.00"), "1200.00");
  assert.equal(amountString(" 42 "), "42");
});

test("amountString renders numbers without exponent notation", () => {
  assert.equal(amountString(3200), "3200");
  assert.equal(amountString(12.5), "12.5");
});

test("amountString expands exponential form exactly, never rounding it away", () => {
  // Rounding these to two decimals returned "0.00" and lost the amount silently.
  assert.equal(amountString(1e-7), "0.0000001");
  assert.equal(amountString(1.5e-7), "0.00000015");
  assert.equal(amountString(-2.5e-8), "-0.000000025");
  assert.equal(amountString(1e21), "1000000000000000000000");
});

test("an expanded amount is still a valid amount", () => {
  // The old rounding produced "1e+21", which sumAmounts then rejected.
  assert.equal(sumAmounts([amountString(1e21), "0"]), "1000000000000000000000");
  assert.equal(sumAmounts([amountString(1e-7), amountString(1e-7)]), "0.0000002");
});

test("positiveAmount rejects zero and negatives", () => {
  assert.equal(positiveAmount(3200), "3200");
  assert.equal(positiveAmount("12.50"), "12.50");
  assert.throws(() => positiveAmount(0), SettleUpError);
  assert.throws(() => positiveAmount(-100), SettleUpError);
  assert.throws(() => positiveAmount("-0.01"), SettleUpError);
});

test("amountString rejects a non-finite number", () => {
  assert.throws(() => amountString(Number.NaN), SettleUpError);
  assert.throws(() => amountString(Number.POSITIVE_INFINITY), SettleUpError);
});

test("a row storing its amount as a number is read, not crashed on", () => {
  // Settle Up stores amounts as strings, but an old row can carry a JSON
  // number, and `.trim()` on one threw a raw TypeError past every handler.
  assert.equal(sumAmounts([1200 as unknown as string, "406"]), "1606");
});
