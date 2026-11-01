import { timingSafeEqual } from "node:crypto";

/** Constant-time compare, so a wrong token cannot be found a byte at a time. */
export function bearerAuthorised(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
