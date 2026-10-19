#!/usr/bin/env node
/**
 * Argument parsing and dispatch. Every command lives in `commands/` and
 * receives a context, so this file stays a table rather than a switch that
 * grows with the surface.
 */

import { parseArgs } from "node:util";
import { authenticate, tokenLocation } from "../api/auth.js";
import { createClient } from "../client/index.js";
import { type SettleUpEnv, SettleUpError } from "../core/types.js";
import * as read from "./commands/read.js";
import * as write from "./commands/write.js";
import type { Command, Ctx, Flags } from "./context.js";
import { fail } from "./fail.js";
import * as render from "./render.js";
import { USAGE } from "./usage.js";

const options = {
  help: { type: "boolean" },
  json: { type: "boolean" },
  sandbox: { type: "boolean" },
  group: { type: "string" },
  amount: { type: "string" },
  purpose: { type: "string" },
  category: { type: "string" },
  currency: { type: "string" },
  date: { type: "string" },
  "date-time": { type: "string" },
  "paid-by": { type: "string" },
  for: { type: "string" },
  to: { type: "string" },
  from: { type: "string" },
  type: { type: "string" },
  after: { type: "string" },
  before: { type: "string" },
  min: { type: "string" },
  max: { type: "string" },
  limit: { type: "string" },
  name: { type: "string" },
  members: { type: "string" },
  "no-minimize": { type: "boolean" },
  active: { type: "boolean" },
  inactive: { type: "boolean" },
  force: { type: "boolean" },
} as const;

/**
 * A Firebase push id, which is 20 characters and **starts with a hyphen** —
 * `-Nq7xR2vK9mBpL4dTfWc`.
 *
 * That leading hyphen makes `parseArgs` read every transaction id as an unknown
 * option and abort, so `settleup rm <id>` could never work. Pulling ids out of
 * the argument list before parsing, rather than making the user write
 * `rm -- <id>`, keeps the obvious command line the working one.
 */
const PUSH_ID = /^-[A-Za-z0-9_-]{19}$/;

const argv = process.argv.slice(2);
const ids = argv.filter((a) => PUSH_ID.test(a));

/**
 * `parseArgs` throws on an unknown option, and a negative number reads as one —
 * `--amount -5` aborts with a stack trace before any validation runs. Turn that
 * into the sentence the user needs.
 */
function parse() {
  try {
    return parseArgs({
      args: argv.filter((a) => !PUSH_ID.test(a)),
      options,
      allowPositionals: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "ambiguous" is what a negative number looks like to parseArgs.
    fail(
      message.includes("ambiguous")
        ? `${message} Amounts are always positive — direction comes from \`add\` versus \`pay\`.`
        : message,
    );
  }
}

const { values, positionals } = parse();

const flags = values as Flags & { help?: boolean };
const [command = "help", ...rest] = positionals;
const args = [...rest, ...ids];

const environment = (): SettleUpEnv =>
  flags.sandbox ? "sandbox" : ((process.env.SETTLEUP_ENV as SettleUpEnv | undefined) ?? "live");

/** Minting a token is not a client operation, so it sits outside the table. */
const login: Command = async ({ flags: f }) => {
  const email = process.env.SETTLEUP_EMAIL;
  if (!email) fail("set SETTLEUP_EMAIL and SETTLEUP_PASSWORD first");
  const env = environment();
  await authenticate({ env, force: Boolean(f.force) });
  console.log(`cached ${env} token at ${tokenLocation(env, email)}`);
};

const COMMANDS: Record<string, Command> = {
  login,
  whoami: read.whoami,
  groups: read.listGroups,
  members: read.listMembers,
  list: read.listTransactions,
  balances: read.balances,

  add: write.addExpense,
  pay: write.addTransfer,
  edit: write.edit,
  rm: write.remove,

  "new-group": write.newGroup,
  "edit-group": write.editGroup,
  "rm-group": write.removeGroup,
  "add-member": write.addMember,
  "edit-member": write.editMember,
};

function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function buildContext(): Ctx {
  const client = createClient({ env: environment() });
  return {
    client,
    flags,
    args,
    show: (data, table) => render.output(Boolean(flags.json), data, table),
    number(value, name) {
      if (value === undefined) return undefined;
      const n = Number(value);
      if (Number.isNaN(n)) fail(`--${name} must be a number, got ${JSON.stringify(value)}`);
      return n;
    },
    list(value) {
      if (value === undefined) return undefined;
      const items = value
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      // `--for ""` parses to an empty list, which would otherwise be sent as
      // "split this between nobody" rather than rejected.
      if (items.length === 0) fail(`expected a comma-separated list, got ${JSON.stringify(value)}`);
      return items;
    },
    defined,
    group() {
      // Everything in Settle Up hangs off a group, so this is the one flag with
      // no sensible default — naming the groups beats "missing --group".
      if (!flags.group) fail("--group is required. `settleup groups` lists them.");
      return flags.group;
    },
    memberNames: async (group) => render.memberNames(await client.members(group)),
  };
}

async function main(): Promise<void> {
  if (flags.help || command === "help") {
    console.log(USAGE);
    return;
  }
  const run = COMMANDS[command];
  if (!run) fail(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
  await run(buildContext());
}

try {
  await main();
} catch (error) {
  if (error instanceof SettleUpError) fail(error.message);
  throw error;
}
