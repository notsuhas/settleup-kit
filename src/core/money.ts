/**
 * Money as decimal strings, added without ever touching a float.
 *
 * Settle Up stores amounts as strings ("1200", "406.50") and its currencies
 * have anywhere from zero to three fractional digits. Parsing to `Number` to
 * add them would drift; instead these scale every value to the widest fraction
 * seen, sum as `BigInt`, and format back.
 */

import { SettleUpError } from "./types.js";

/**
 * Split a decimal string into its sign, integer and fractional parts.
 *
 * Coerces rather than assuming a string: Settle Up stores amounts as strings,
 * but an old or third-party row can carry a JSON number, and `.trim()` on one
 * throws a raw TypeError that escapes every `SettleUpError` handler.
 */
function parts(value: string): { sign: bigint; int: string; frac: string } {
  const trimmed = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new SettleUpError(`not a decimal amount: ${JSON.stringify(value)}`);
  return {
    sign: match[1] === "-" ? -1n : 1n,
    int: match[2] as string,
    frac: match[3] ?? "",
  };
}

/** Scale a decimal string to `scale` fractional digits, as a signed BigInt. */
function scaled(value: string, scale: number): bigint {
  const { sign, int, frac } = parts(value);
  const padded = (frac + "0".repeat(scale)).slice(0, scale);
  return sign * BigInt(int + padded);
}

/** Add decimal strings exactly, preserving the widest fraction any input used. */
export function sumAmounts(values: string[]): string {
  if (values.length === 0) return "0";
  const scale = Math.max(...values.map((v) => parts(v).frac.length));
  const total = values.reduce((acc, v) => acc + scaled(v, scale), 0n);
  return format(total, scale);
}

/** Format a scaled BigInt back to a decimal string with `scale` fractional digits. */
function format(total: bigint, scale: number): string {
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = scale ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${int}${frac}`;
}

/**
 * Expand a number's exponential form to plain decimal digits.
 *
 * `String(1e-7)` is `"1e-7"`, which is not a decimal Settle Up will accept.
 * Rounding it instead would be worse: `toFixed(2)` turns it into `"0.00"` and
 * loses the amount silently. This shifts the point and keeps every digit.
 */
function plainDecimal(value: number): string {
  const text = String(value);
  const exponential = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!exponential) return text;

  const sign = exponential[1] as string;
  const int = exponential[2] as string;
  const digits = int + (exponential[3] ?? "");
  const point = int.length + Number(exponential[4]);

  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Normalise a caller's amount (number or string) to a canonical decimal string. */
export function amountString(amount: number | string): string {
  if (typeof amount === "string") {
    parts(amount); // validate
    return amount.trim();
  }
  if (!Number.isFinite(amount)) throw new SettleUpError(`amount is not finite: ${amount}`);
  return plainDecimal(amount);
}

/**
 * An amount for a new expense or transfer, which must be positive.
 *
 * Settle Up carries direction in the kind of row, not the sign — an expense is
 * money spent and a transfer is money moved — so a negative amount has no
 * meaning and would quietly corrupt the group's balances.
 */
export function positiveAmount(amount: number | string): string {
  const text = amountString(amount);
  if (Number(text) <= 0) {
    throw new SettleUpError(`amount must be positive, got ${text}`);
  }
  return text;
}
