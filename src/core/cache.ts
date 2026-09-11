/**
 * A tiny TTL cache for reads.
 *
 * Reads here are whole documents — every transaction in a group, every member —
 * so a CLI run or an MCP tool call would otherwise fetch the same list several
 * times to resolve names. Writes invalidate the group they touched, so a stale
 * row is never served after a change this process made; the only staleness is a
 * change made elsewhere, which is what the TTL bounds.
 */

interface Entry {
  value: Promise<unknown>;
  at: number;
}

export class Cache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ttlMs: number) {}

  /** Run `load` unless a fresh result for `key` is already in flight or held. */
  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as Promise<T>;

    const value = load().catch((err) => {
      // A failed read must not be cached, or one blip poisons the TTL window.
      this.entries.delete(key);
      throw err;
    });
    this.entries.set(key, { value, at: Date.now() });
    return value;
  }

  /** Drop every key that starts with `prefix`; used to invalidate one group. */
  invalidate(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
