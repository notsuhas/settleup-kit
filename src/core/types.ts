/**
 * Normalised shapes for the Settle Up data model.
 *
 * Settle Up is a Firebase Realtime Database. The wire rows are keyed by push id
 * and store money as strings; these types are what the client hands back, with
 * the raw shapes kept out of every call site.
 */

/** Which backend project to talk to. `live` is the real app; `sandbox` is theirs for testing. */
export type SettleUpEnv = "live" | "sandbox";

/**
 * A member and their share weight, as stored in `whoPaid` and `forWhom`.
 * Weight is a string on the wire ("1", "2", …); "0" means unchecked.
 */
export interface Weighted {
  memberId: string;
  weight: string;
}

/**
 * One line of an expense. The first item is the main expense; Settle Up uses
 * later items for tip and tax. Each item is split across its own `forWhom`.
 */
export interface Item {
  /** Money as a decimal string, in the transaction's `currencyCode`. */
  amount: string;
  forWhom: Weighted[];
}

export interface Transaction {
  id: string;
  /** `expense` moves money to a shared pot; `transfer` settles a debt between two members. */
  type: "expense" | "transfer";
  /** Free-text description. Always set — Settle Up rejects an empty one. */
  purpose: string;
  /** Emoji or custom category name. Absent on transfers and uncategorised expenses. */
  category?: string;
  /** ISO 4217 code — "INR", "JPY". Not the group currency; a row can be in any. */
  currencyCode: string;
  /** Milliseconds since epoch, as Settle Up stores it. */
  dateTime: number;
  /** Who paid, and in what proportion. */
  whoPaid: Weighted[];
  /** The expense split into one or more items. A transfer has a single item. */
  items: Item[];
  /**
   * Total across every item, as a decimal string. Derived, not stored — Settle
   * Up keeps the amount per item, and a caller almost always wants the sum.
   */
  amount: string;
  /**
   * Rates the server fills in on write, keyed by the *other* currency.
   *
   * Read it as "one unit of the key buys this many of `currencyCode`" — so on a
   * JPY row, `{ INR: "1.61" }` means 1 INR = 1.61 JPY, and converting the row
   * into INR means **dividing** by it. Verified against a live group: a 4000 JPY
   * expense split two ways moved the balance by 4000 / 1.61416 / 2 = 1239.03 INR.
   */
  exchangeRates?: Record<string, string>;
  /** Whether the rate was pinned by hand rather than fetched. */
  fixedExchangeRate: boolean;
  receiptUrl?: string;
  timezone?: string;
}

export interface Member {
  id: string;
  name: string;
  /** Whether the member is included in new transactions by default. */
  active: boolean;
  /** Default share weight when a new expense is created. "0" means unchecked. */
  defaultWeight: string;
  photoUrl?: string;
  bankAccount?: string;
}

export interface Group {
  id: string;
  name: string;
  /** The currency debts are shown in — Settle Up's `convertedToCurrency`. */
  currencyCode: string;
  /** Whether the group simplifies debts (fewest transfers to settle up). */
  minimizeDebts: boolean;
  inviteLink?: string;
  members: Member[];
  /**
   * The signed-in user's own member id in this group, from `userGroups`. This
   * is who "I paid" defaults to. Absent if the user is in the group but not
   * mapped to a member (a spectator).
   */
  meMemberId?: string;
}

/** One edge of the settlement: `from` owes `to` this much, in the group currency. */
export interface Debt {
  from: string;
  to: string;
  amount: string;
}

/**
 * A member's net position in the group currency: positive means they are owed,
 * negative means they owe. Derived from the debt edges.
 */
export interface Balance {
  memberId: string;
  name: string;
  net: number;
}

export interface NewExpense {
  /** Group name or id. */
  group: string;
  /** Total amount, positive. A decimal string keeps it exact; a number is accepted. */
  amount: number | string;
  /**
   * What it was for. Required: Settle Up's security rules reject an empty
   * description with a bare "Permission denied".
   */
  purpose: string;
  /**
   * Who paid, by member name or id. A string, or a list for a split payment.
   * Defaults to the signed-in user's member in the group.
   */
  paidBy?: string | string[];
  /**
   * Who the expense is for, by member name or id. Defaults to every active
   * member, split equally — the usual "split this evenly" case.
   */
  forWhom?: string[];
  /** Emoji or category name. */
  category?: string;
  /** ISO 4217 code. Defaults to the group currency. */
  currencyCode?: string;
  /** ISO date or YYYY-MM-DD. Defaults to now. */
  date?: string;
  /** ISO timestamp with Z or an explicit UTC offset; mutually exclusive with date. */
  dateTime?: string;
}

export interface NewTransfer {
  /** Group name or id. */
  group: string;
  amount: number | string;
  /** Who is paying, by member name or id. Defaults to the signed-in user's member. */
  from?: string;
  /** Who is being paid, by member name or id. Required. */
  to: string;
  /** Defaults to "Debt settlement", which is what the app itself writes. */
  purpose?: string;
  currencyCode?: string;
  date?: string;
  /** ISO timestamp with Z or an explicit UTC offset; mutually exclusive with date. */
  dateTime?: string;
}

/** A change to an existing transaction. Omitted fields are carried over from the live row. */
export interface TransactionPatch {
  purpose?: string;
  category?: string | null;
  amount?: number | string;
  paidBy?: string | string[];
  forWhom?: string[];
  currencyCode?: string;
  date?: string;
  /** ISO timestamp with Z or an explicit UTC offset; mutually exclusive with date. */
  dateTime?: string;
}

export interface TransactionQuery {
  purpose?: string;
  type?: "expense" | "transfer";
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
}

export interface NewGroup {
  name: string;
  /** ISO 4217 code the group's debts are shown in — "INR", "JPY". */
  currencyCode: string;
  /**
   * Member names to create, in order. The **first is you**: it becomes the
   * member "who paid" defaults to. Defaults to a single member called "Me".
   */
  members?: string[];
  /** Fewest transfers to settle up. Defaults to on, as the app does. */
  minimizeDebts?: boolean;
  /** Your colour for the group, as `#RRGGBB`. */
  color?: string;
}

export interface GroupPatch {
  name?: string;
  currencyCode?: string;
  minimizeDebts?: boolean;
}

export interface NewMember {
  name: string;
  defaultWeight?: string;
  bankAccount?: string;
}

export interface MemberPatch {
  name?: string;
  active?: boolean;
  defaultWeight?: string;
  bankAccount?: string;
}

export interface Account {
  uid: string;
  email: string;
  name?: string;
}

export class SettleUpError extends Error {
  constructor(
    message: string,
    readonly code?: number | string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "SettleUpError";
  }
}
