# Changelog

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
