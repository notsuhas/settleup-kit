/**
 * Raw Realtime Database rows in, normalised shapes out.
 *
 * The database keys collections by push id and stores an entity's own id only
 * as that key, so every normaliser takes `(id, raw)`. Missing optional fields
 * are common — a fresh member has no `photoUrl`, a transfer no `category` — so
 * the shapes lean on optionals rather than filling in defaults that would lie.
 */

import { sumAmounts } from "./money.js";
import type { Group, Item, Member, Transaction, Weighted } from "./types.js";

export interface RawMember {
  name?: string;
  active?: boolean;
  defaultWeight?: string;
  photoUrl?: string;
  bankAccount?: string;
}

export interface RawGroup {
  name?: string;
  convertedToCurrency?: string;
  minimizeDebts?: boolean;
  inviteLink?: string;
}

export interface RawTransaction {
  type?: "expense" | "transfer";
  purpose?: string;
  category?: string;
  currencyCode?: string;
  dateTime?: number;
  timezone?: string;
  fixedExchangeRate?: boolean;
  exchangeRates?: Record<string, string>;
  receiptUrl?: string;
  whoPaid?: Weighted[];
  items?: Item[];
}

/** A `{ pushId: raw }` map into an array, dropping any null holes Firebase left. */
export function fromMap<Raw, Out>(
  map: Record<string, Raw> | null,
  make: (id: string, raw: Raw) => Out,
): Out[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, raw]) => raw != null)
    .map(([id, raw]) => make(id, raw));
}

export function toMember(id: string, raw: RawMember): Member {
  return {
    id,
    name: raw.name ?? "",
    active: raw.active ?? true,
    defaultWeight: raw.defaultWeight ?? "1",
    ...(raw.photoUrl ? { photoUrl: raw.photoUrl } : {}),
    ...(raw.bankAccount ? { bankAccount: raw.bankAccount } : {}),
  };
}

export function toGroup(id: string, raw: RawGroup, members: Member[], meMemberId?: string): Group {
  return {
    id,
    name: raw.name ?? "",
    currencyCode: raw.convertedToCurrency ?? "",
    minimizeDebts: raw.minimizeDebts ?? false,
    ...(raw.inviteLink ? { inviteLink: raw.inviteLink } : {}),
    members,
    ...(meMemberId ? { meMemberId } : {}),
  };
}

export function toTransaction(id: string, raw: RawTransaction): Transaction {
  const items = raw.items ?? [];
  return {
    id,
    type: raw.type ?? "expense",
    purpose: raw.purpose ?? "",
    ...(raw.category ? { category: raw.category } : {}),
    currencyCode: raw.currencyCode ?? "",
    dateTime: raw.dateTime ?? 0,
    whoPaid: raw.whoPaid ?? [],
    items,
    amount: sumAmounts(items.map((i) => i.amount ?? "0")),
    ...(raw.exchangeRates ? { exchangeRates: raw.exchangeRates } : {}),
    fixedExchangeRate: raw.fixedExchangeRate ?? false,
    ...(raw.receiptUrl ? { receiptUrl: raw.receiptUrl } : {}),
    ...(raw.timezone ? { timezone: raw.timezone } : {}),
  };
}
