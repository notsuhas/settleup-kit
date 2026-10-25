import { AsyncLocalStorage } from "node:async_hooks";

interface Entry {
  value: Promise<unknown>;
  at: number;
}

export class Cache {
  private readonly entries = new Map<string, Entry>();
  private readonly scopes = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

  constructor(private readonly ttlMs: number) {}

  scope<T>(operation: () => Promise<T>): Promise<T> {
    return this.scopes.getStore() ? operation() : this.scopes.run(new Map(), operation);
  }

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const scoped = this.scopes.getStore();
    if (scoped) {
      const hit = scoped.get(key);
      if (hit) return hit as Promise<T>;
      const value = load();
      scoped.set(key, value);
      void value.catch(() => {
        if (scoped.get(key) === value) scoped.delete(key);
      });
      return value;
    }
    if (this.ttlMs <= 0) return load();
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = load();
    this.entries.set(key, { value, at: Date.now() });
    void value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  invalidate(prefix: string): void {
    for (const entries of [this.entries, this.scopes.getStore()]) {
      if (!entries) continue;
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.scopes.getStore()?.clear();
  }
}
