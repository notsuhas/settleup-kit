/**
 * A thin typed wrapper over the Firebase Realtime Database REST API.
 *
 * Every path is a JSON document reachable at `<databaseURL>/<path>.json`, with
 * the ID token passed as an `auth` query parameter. The four writes map onto
 * REST verbs: PUT replaces a node, PATCH merges into one, POST appends a new
 * push-id child, DELETE removes it. A POST returns `{ name: "<pushId>" }` — the
 * key the new child was written under.
 */

import type { SettleUpEnv } from "../core/types.js";
import type { Session } from "./auth.js";
import { FIREBASE, request } from "./http.js";

export class Db {
  constructor(
    private readonly env: SettleUpEnv,
    private readonly session: Session,
  ) {}

  private url(path: string): string {
    return `${FIREBASE[this.env].databaseURL}/${path}.json?auth=${this.session.idToken}`;
  }

  /** Read a node. Firebase answers a missing or empty node with `null`. */
  get<T>(path: string): Promise<T | null> {
    return request<T | null>(this.url(path));
  }

  /** Replace a node wholesale. */
  put<T>(path: string, value: T): Promise<T> {
    return request<T>(this.url(path), { method: "PUT", body: value });
  }

  /** Merge fields into a node, leaving the rest intact. */
  patch<T>(path: string, value: Partial<T>): Promise<void> {
    return request<void>(this.url(path), { method: "PATCH", body: value });
  }

  /** Append a new push-id child; returns the generated key. */
  async push(path: string, value: unknown): Promise<string> {
    const res = await request<{ name: string }>(this.url(path), {
      method: "POST",
      body: value,
    });
    return res.name;
  }

  /** Remove a node. */
  delete(path: string): Promise<void> {
    return request<void>(this.url(path), { method: "DELETE" });
  }
}
