/**
 * What every command needs: the client, the parsed flags, and the small
 * helpers that turn strings from a terminal into typed arguments.
 */

import type { SettleUp } from "../client/api.js";
import type { MemberNames } from "./render.js";

export interface Flags {
  json?: boolean;
  group?: string;
  amount?: string;
  purpose?: string;
  category?: string;
  currency?: string;
  date?: string;
  "paid-by"?: string;
  for?: string;
  to?: string;
  from?: string;
  type?: string;
  after?: string;
  before?: string;
  min?: string;
  max?: string;
  limit?: string;
  name?: string;
  members?: string;
  "no-minimize"?: boolean;
  active?: boolean;
  inactive?: boolean;
  force?: boolean;
  sandbox?: boolean;
}

export interface Ctx {
  client: SettleUp;
  flags: Flags;
  /** Positional arguments after the command name. */
  args: string[];
  /** Print JSON or a table, depending on `--json`. */
  show(data: unknown, table?: () => void): void;
  /** Parse a numeric flag, failing with the flag's name. */
  number(value: string | undefined, name: string): number | undefined;
  /** Split a comma-separated list, dropping blanks. */
  list(value: string | undefined): string[] | undefined;
  /** Keep only the keys whose value was actually supplied. */
  defined<T extends object>(input: T): Partial<T>;
  /** The group named by `--group`, failing with a useful message when absent. */
  group(): string;
  memberNames(group: string): Promise<MemberNames>;
}

export type Command = (ctx: Ctx) => Promise<void>;
