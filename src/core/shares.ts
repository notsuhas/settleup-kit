import { amountString, positiveAmount } from "./money.js";
import { findMember } from "./query.js";
import { type Group, SettleUpError, type Weighted } from "./types.js";

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

export function customShares(
  group: Group,
  amount: number | string,
  shares: Record<string, number | string>,
): Weighted[] {
  const total = positiveAmount(amount);
  const members = new Set<string>();
  const entries = Object.entries(shares).map(([name, value]) => {
    const memberId = findMember(group.members, name).id;
    if (members.has(memberId)) throw new SettleUpError("duplicate member in shares");
    members.add(memberId);
    const text = amountString(value);
    if (text.startsWith("-")) throw new SettleUpError("shares must be nonnegative");
    return { memberId, text };
  });
  const scale = Math.max(
    ...[total, ...entries.map((entry) => entry.text)].map(
      (text) => text.split(".")[1]?.length ?? 0,
    ),
  );
  const units = (text: string): bigint => {
    const [integer = "0", fraction = ""] = text.split(".");
    return BigInt(integer + fraction.padEnd(scale, "0"));
  };
  const values = entries.map((entry) => ({ ...entry, units: units(entry.text) }));
  if (values.reduce((sum, value) => sum + value.units, 0n) !== units(total)) {
    throw new SettleUpError("shares must sum exactly to the expense amount");
  }
  const divisor = values.reduce((result, value) => gcd(result, value.units), 0n);
  const reduce = divisor >= 10n ** BigInt(scale);
  return values
    .filter((value) => value.units > 0n)
    .map((value) => ({
      memberId: value.memberId,
      weight: reduce ? String(value.units / divisor) : value.text,
    }));
}
