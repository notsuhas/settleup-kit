/**
 * settleup-kit — unofficial Settle Up client.
 *
 * ```ts
 * import { createClient } from "@notsuhas/settleup-kit";
 *
 * const su = createClient();                    // SETTLEUP_EMAIL / SETTLEUP_PASSWORD
 * await su.groups();
 * await su.addExpense({ group: "Lisbon", amount: 1200, purpose: "Dinner" });
 * await su.balances("Lisbon");
 * ```
 *
 * The CLI and the MCP server are both thin layers over this, so anything they
 * can do is available here.
 */

export {
  type AuthOptions,
  authenticate,
  type Session,
  tokenLocation,
} from "./api/auth.js";
export { Db } from "./api/db.js";
/** The low-level request layer and the Firebase project config, for endpoints this does not model. */
export { FIREBASE, type RequestOptions, request } from "./api/http.js";
export type { SettleUp } from "./client/api.js";
export {
  type ClientOptions,
  createClient,
} from "./client/index.js";
export {
  buildExpense,
  buildTransfer,
  type TransactionPayload,
} from "./core/build.js";
export { localDay, timezoneAt } from "./core/dates.js";
export { balances } from "./core/debts.js";
export { amountString, positiveAmount, sumAmounts } from "./core/money.js";
export { inviteHash, pushId } from "./core/pushid.js";
export { filterTransactions, findGroup, findMember } from "./core/query.js";
export {
  type Account,
  type Balance,
  type Debt,
  type Group,
  type GroupPatch,
  type Item,
  type Member,
  type MemberPatch,
  type NewExpense,
  type NewGroup,
  type NewMember,
  type NewTransfer,
  type SettleUpEnv,
  SettleUpError,
  type Transaction,
  type TransactionPatch,
  type TransactionQuery,
  type Weighted,
} from "./core/types.js";
export { createMcpServer } from "./mcp/server.js";
