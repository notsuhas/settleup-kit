# settleup-kit

Unofficial [Settle Up](https://settleup.app) client, CLI and MCP server. Groups,
members, expenses, transfers and debts — from your email and password, with
nothing else to set up.

Not affiliated with Settle Up or Step Up Labs. Settle Up publishes a
[public API](https://api.settleup.io/); this is a typed client for it.

## Why this exists

Settle Up's API is a raw Firebase Realtime Database. That is a fine thing to
publish, but it means every caller re-derives the same handful of facts: that
the amount lives inside `items[]` rather than on the transaction, that member
ids are per-group, that an empty description is refused as `Permission denied`,
and that exchange rates divide rather than multiply.

This wraps that into named operations — "split 3200 yen between everyone" — and
writes down what cost time to work out. See [docs/traps.md](docs/traps.md).

## Install

```bash
npm install -g @notsuhas/settleup-kit
```

From source:

```bash
git clone https://github.com/notsuhas/settleup-kit && cd settleup-kit
npm ci && npm run build && npm install -g .
```

Then:

```bash
export SETTLEUP_EMAIL="you@example.com"
export SETTLEUP_PASSWORD="…"
```

## CLI

```bash
settleup login                    # once — signs in and caches the token
settleup groups                   # every group, with its members
settleup balances --group Lisbon   # who owes whom
```

Recording a shared cost. It defaults to you paying, split equally between every
active member:

```bash
settleup add --group Lisbon --amount 3200 --purpose "Dinner" --currency EUR --category 🍽
```

```
added
2026-09-11        3200 EUR  🍽   Dinner        paid by Alice  for Alice, Bob
            id -Nq7xR2vK9mBpL4dTfWc
```

Override either side when it wasn't an even split:

```bash
settleup add --group Lisbon --amount 8000 --purpose "Hotel" --paid-by Bob
settleup add --group Lisbon --amount 1400 --purpose "Taxi"  --for "Alice,Bob"
```

Paying someone back, which settles a debt rather than adding a shared cost:

```bash
settleup pay --group Lisbon --amount 1000 --to Alice --from Bob
```

Editing and deleting take the id printed under each row:

```bash
settleup edit -Nq7xR2vK9mBpL4dTfWc --group Lisbon --amount 2900
settleup rm   -Nq7xR2vK9mBpL4dTfWc --group Lisbon
```

An edit changes only what you pass. The category, the split and any tip or tax
lines survive an amount-only edit.

Groups and members:

```bash
settleup new-group --name "Lisbon 2026" --currency EUR --members "Alice,Bob"
settleup add-member --group "Lisbon 2026" --name Carol
settleup edit-group --group "Lisbon 2026" --name "Lisbon trip"
settleup rm-group   --group "Lisbon 2026"   # and every transaction in it
```

The first member is you — it is the one expenses default to being paid by.

`--json` on any command gives machine-readable output. `--sandbox` points at
Settle Up's sandbox project instead of your real account.

## MCP server

Seven tools: `list_groups`, `group_balances`, `search_transactions`,
`add_expense`, `add_transfer`, `edit_transaction`, `delete_transaction`.
Creating groups and members is opt-in behind `SETTLEUP_MCP_ALLOW_STRUCTURE=1`;
`delete_group` needs `SETTLEUP_MCP_ALLOW_DELETE=1` on top, because it takes
every transaction in the group with it.

```json
{
  "mcpServers": {
    "settleup": {
      "command": "npx",
      "args": ["-y", "-p", "@notsuhas/settleup-kit", "settleup-mcp"],
      "env": {
        "SETTLEUP_EMAIL": "you@example.com",
        "SETTLEUP_PASSWORD": "…"
      }
    }
  }
}
```

There is an HTTP transport too, for running it somewhere and pointing a client
at it. It requires `MCP_TOKEN` and refuses to start without one.

Full notes: [docs/mcp.md](docs/mcp.md).

## Library

```ts
import { createClient } from "@notsuhas/settleup-kit";

const su = createClient();

await su.groups();
await su.addExpense({
  group: "Lisbon",
  amount: 3200,
  purpose: "Dinner",
  currencyCode: "EUR",
});
await su.addTransfer({
  group: "Lisbon",
  amount: 1000,
  to: "Alice",
  from: "Bob",
});
await su.balances("Lisbon");
```

The CLI and the MCP server are both thin layers over this, so they cannot do
anything the library can't.

## Everything hangs off a group

Settle Up has no global notion of a person. Members, transactions and debts all
belong to one group, and the same friend is a different member id in each — so
every call names a group, and members are named within it.

Which member _you_ are is read from the account, which is what lets "who paid"
default to you.

## Money

Amounts are always positive. Direction comes from the operation: `add` records
money spent for the group, `pay` records one member paying another back.

A row carries its own currency, which need not be the group's. Settle Up
converts on the server and reports debts in the group currency. Totals are
summed as decimal strings rather than floats, because an expense splits into
items and repeated float addition drifts.

## The one thing to know before you start

**A description is required.** Settle Up's security rules reject a transaction
whose `purpose` is empty, and the error is a bare `Permission denied` with HTTP
401 — which reads like an auth problem and sends you debugging the wrong thing.

This kit refuses an empty description locally, before the request goes out.

## Environment

|                                        |                                      |
| -------------------------------------- | ------------------------------------ |
| `SETTLEUP_EMAIL` · `SETTLEUP_PASSWORD` | credentials                          |
| `SETTLEUP_ID_TOKEN`                    | use this token instead of signing in |
| `SETTLEUP_ENV`                         | `live` (default) or `sandbox`        |
| `SETTLEUP_CONFIG_DIR`                  | where the token cache lives          |
| `MCP_TOKEN` · `MCP_PORT` · `MCP_HOST`  | HTTP MCP transport                   |
| `SETTLEUP_MCP_ALLOW_STRUCTURE`         | MCP: group and member writes         |
| `SETTLEUP_MCP_ALLOW_DELETE`            | MCP: `delete_group`                  |

The token cache is written `0600` under `~/.config/settleup-kit/`.

## Docs

- [docs/api.md](docs/api.md) — auth, paths, the transaction shape
- [docs/traps.md](docs/traps.md) — everything that cost time to work out
- [docs/mcp.md](docs/mcp.md) — wiring the MCP server into a client

## Licence

MIT. Use it against your own account.

## Transaction times

Write tools accept optional `dateTime` instead of `date`, for example
`"2026-10-19T11:10:00+09:00"` for a receipt printed at 11:10 in Japan. Use a
full ISO timestamp with seconds and either `Z` or an explicit UTC offset. Do not
send both fields. Date-only calls keep their existing behavior; omitted fields
on edits preserve the saved time. The CLI equivalent is
`--date-time '2026-10-19T11:10:00+09:00'`. MCP transaction results include
`dateTime` when a timestamp is available.

### npm trusted publishing setup

The release workflow uses GitHub OIDC rather than `NPM_TOKEN`. Configure a
trusted publisher on the npm package for this exact GitHub repository and
`release.yml`, with direct publishing allowed and no environment restriction.
Keep `repository.url` aligned with the repository. A newly configured publisher
must complete a successful publish within two days or npm expires it.

If publishing returns E404 while package reads work, check the package's trusted
publisher configuration and repository metadata before replacing tokens. Passing
CI does not verify npm publish authorization; verify the release job itself.
