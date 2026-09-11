# Changelog

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
