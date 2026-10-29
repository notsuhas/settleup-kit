# Changelog

## 0.5.1

### Patch Changes

- Finish in-flight ledger reconciliation before request teardown closes SQLite,
  so stateless HTTP reads persist background refreshes after returning their
  cached response.

## 0.5.0

### Minor Changes

- Serve MCP reads from durable SQLite snapshots with explicit freshness metadata
  and fresh audit overrides. Preserve complete snapshots across restarts,
  reconcile edits and deletions, invalidate after all writes, and recover
  receipt locks after process death without replaying uncertain writes. Disable
  automatic retries of uncertain financial mutations.

  BREAKING CHANGE: Node 22.13+ is required. MCP reference lists now return a
  named array plus sync metadata, and read tools default to local snapshots;
  pass fresh=true for current upstream state. Stop older receipt writers before
  upgrading.

## 0.4.2

### Patch Changes

- Resolve known groups with fresh, parallel membership, group and member reads
  instead of reloading every group. Receipt journals use the authenticated user
  ID without downloading the profile. Transaction verification and exact share
  validation remain unchanged.

## 0.4.1

### Patch Changes

- Validate description length before recording or editing transactions.

## 0.4.0

### Minor Changes

- Add record_expense to check duplicate receipts and return the saved,
  independently verified full bill and exact split in one call. Persist private
  idempotency journals and reconcile uncertain writes before permitting retries.

## 0.3.2

### Patch Changes

- Reuse group metadata within each MCP operation and fetch individual
  transactions directly. Keep subsequent operations fresh, invalidate writes,
  and retain server readback verification.

## 0.3.1

### Patch Changes

- Keep custom decimal shares in Settle Up's native decimal-weight format instead
  of multiplying them into large integer weights. Direct equal splits through
  the regular participant list so rounding pennies do not become custom weights.

## 0.3.0

### Minor Changes

- Accept exact custom share amounts in expense creation and single-item expense
  edits. Validate totals without floating-point rounding and expose native split
  weights in MCP readback.

## 0.2.1

### Patch Changes

- 85a41ff: Read current account data on every MCP call instead of retaining
  results for five minutes.

  Preserve recorded exchange rates when correcting a transaction time or
  description.

## 0.2.0

### Minor Changes

- 0ac1a71: Record exact receipt times using an optional dateTime timestamp with
  an explicit UTC offset in MCP tools, the client and CLI. Preserve existing
  timestamps on unrelated edits and return them in tool results.

## 0.1.3 — 2026-09-11

- **Fixes a session that never refreshed.** The client resolved authentication
  once and reused it for the life of the process, so anything long-running — an
  MCP server above all — kept the first ID token it was given. Firebase expires
  those after an hour, and every request after that failed with
  `Permission denied` while a perfectly good refresh token sat unused in the
  cache. The session is resolved per call now.

## 0.1.2 — 2026-09-11

- `deleteGroup`, `settleup rm-group`, and an MCP `delete_group` behind
  `SETTLEUP_MCP_ALLOW_DELETE=1`. It takes every transaction in the group with
  it, which is why it is a flag of its own.
- Corrected the docs, which claimed a group could only be deleted from the app.
  It cannot be deleted in one call, but five deletes in the right order do it —
  `permissions` last, because it authorises the other four. Getting that order
  wrong strands the group where nobody can reach it.

## 0.1.1 — 2026-09-11

- Replaced the real names, group names and live database ids that had been used
  as examples in the README, the docs and the test fixtures. Nothing but the
  documentation changed; the code behaves identically.

## 0.1.0 — 2026-09-11

First release.

- Client for Settle Up's public API, with scriptable email/password sign-in via
  Firebase and an on-disk token cache that renews itself from a refresh token.
- Groups, members, expenses, transfers and debts. An expense defaults to being
  paid by you and split equally between every active member, which is the case
  the app is built around.
- Full transaction CRUD. An edit is rebuilt from the live row, so changing the
  amount leaves the category, the split and any tip or tax lines alone.
- Balances derived from the settlement Settle Up computes, which it recalculates
  on every write.
- CLI (`settleup`) and MCP server over stdio (`settleup-mcp`) and streamable
  HTTP (`settleup-mcp-http`).
- Documented the traps: the empty description that answers "Permission denied",
  the push ids that start with a hyphen and break argument parsing, and the
  exchange rates that divide rather than multiply.
- Group and member management, off by default behind
  `SETTLEUP_MCP_ALLOW_STRUCTURE`. Creating a group needs four writes in a
  specific order and an invite-link hash the rules will not accept a group
  without, so it is done for you.
