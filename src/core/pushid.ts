/**
 * Firebase push ids, generated client-side.
 *
 * Normally the server mints these — a POST to a collection returns the key it
 * chose. Creating a group needs the id *before* the first write, because the
 * permission node has to name the group it grants access to, so this
 * reimplements Firebase's own generator.
 *
 * The format is 20 characters: 8 encoding the millisecond timestamp, then 12
 * random. That makes ids sort chronologically as strings, which is what the
 * app relies on to list things in order. Within the same millisecond the
 * random suffix is incremented rather than redrawn, so two ids made in a tight
 * loop still sort in the order they were created.
 */

const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

// -1 rather than 0, so an explicit `pushId(0)` is not mistaken for a repeat of
// the initial state and left with an unfilled random suffix.
let lastTime = -1;
let lastRandom: number[] = [];

export function pushId(now: number = Date.now()): string {
  const duplicateTime = now === lastTime;
  lastTime = now;

  const stamp: string[] = new Array(8);
  let time = now;
  for (let i = 7; i >= 0; i--) {
    stamp[i] = PUSH_CHARS.charAt(time % 64);
    time = Math.floor(time / 64);
  }

  if (!duplicateTime) {
    lastRandom = Array.from({ length: 12 }, () => Math.floor(Math.random() * 64));
  } else {
    // Same millisecond: increment the suffix so the new id still sorts after
    // the previous one. Carry leftwards, as Firebase does.
    let i = 11;
    for (; i >= 0 && lastRandom[i] === 63; i--) lastRandom[i] = 0;
    if (i >= 0) lastRandom[i] = (lastRandom[i] as number) + 1;
  }

  return stamp.join("") + lastRandom.map((n) => PUSH_CHARS.charAt(n)).join("");
}

const LINK_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * The 20-character token in a group's invite URL.
 *
 * Not a push id: the app uses a plain random string here, and a group is
 * rejected without one — see docs/traps.md.
 */
export function inviteHash(): string {
  return Array.from({ length: 20 }, () =>
    LINK_CHARS.charAt(Math.floor(Math.random() * LINK_CHARS.length)),
  ).join("");
}
