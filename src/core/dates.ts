/**
 * Dates, in the reader's own timezone.
 *
 * Settle Up stores an instant (`dateTime`, in milliseconds) plus the offset the
 * creator was in. Everything here converts between that and the calendar day a
 * person actually means.
 */

import { SettleUpError } from "./types.js";

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

/**
 * The calendar day a timestamp falls on, locally.
 *
 * `toISOString().slice(0, 10)` is UTC, which shows an evening expense on
 * tomorrow's date for anyone west of Greenwich.
 */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The local UTC offset at a given moment, in the `+05:30` form Settle Up records.
 *
 * Taken from the transaction's own date rather than now, so a row backdated
 * across a daylight-saving change records the offset that was in force then.
 */
export function timezoneAt(ms: number): string {
  const offset = -new Date(ms).getTimezoneOffset();
  return `${offset < 0 ? "-" : "+"}${pad(Math.abs(offset) / 60)}:${pad(Math.abs(offset) % 60)}`;
}

/** Milliseconds for a date the caller gave, or now. Accepts YYYY-MM-DD or a full ISO stamp. */
export function when(date?: string): number {
  if (!date) return Date.now();
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) throw new SettleUpError(`not a date: ${JSON.stringify(date)}`);
  return parsed;
}

/** Explicit receipt time takes precedence only when no date was supplied. */
export function transactionTime(input: { date?: string; dateTime?: string }): {
  dateTime: number;
  timezone: string;
} {
  if (input.dateTime !== undefined) {
    if (input.date !== undefined) throw new SettleUpError("pass date or dateTime, not both");
    const value = input.dateTime;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw new SettleUpError("dateTime must be an ISO timestamp with Z or a UTC offset");
    }
    const at = when(value);
    const zone = value.endsWith("Z") ? "+00:00" : value.slice(-6);
    if (
      Math.abs(Number(zone.slice(1, 3))) > 23 ||
      Number(zone.slice(4)) > 59 ||
      new Date(at + offsetMinutes(zone) * 60000).toISOString().slice(0, 19) !== value.slice(0, 19)
    ) {
      throw new SettleUpError("dateTime is not a valid calendar timestamp");
    }
    return { dateTime: at, timezone: zone };
  }
  const at = when(input.date);
  return { dateTime: at, timezone: timezoneAt(at) };
}

function offsetMinutes(zone: string): number {
  return (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4))) * (zone[0] === "-" ? -1 : 1);
}

/** Present the instant in the offset saved by its creator, independent of the server. */
export function recordedTime(ms: number, zone?: string): string {
  if (!zone || !/^[+-]\d{2}:\d{2}$/.test(zone)) return new Date(ms).toISOString();
  return new Date(ms + offsetMinutes(zone) * 60000).toISOString().slice(0, -1) + zone;
}

/** True for a bare `YYYY-MM-DD`, which names a whole day rather than an instant. */
export const isBareDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The last millisecond of a day. */
export const END_OF_DAY = 86_399_999;
