/**
 * Exit with a message.
 *
 * A module-level function declaration rather than a method on the command
 * context, because TypeScript only narrows types through a `never`-returning
 * call when it can see the declaration — a destructured property doesn't
 * narrow, which would force a redundant `return` after every guard.
 */
export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
