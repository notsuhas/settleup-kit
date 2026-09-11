# The MCP server

Seven tools over a live Settle Up account: `list_groups`, `group_balances`,
`search_transactions`, `add_expense`, `add_transfer`, `edit_transaction`,
`delete_transaction`.

Structure — `create_group`, `edit_group`, `add_member`, `edit_member` — is
opt-in behind `SETTLEUP_MCP_ALLOW_STRUCTURE=1`. Adding someone to a group
shifts every balance in it, which is a different kind of act from recording a
meal.

`delete_group` is a flag again, `SETTLEUP_MCP_ALLOW_DELETE=1`. It takes every
transaction in the group with it and Settle Up has no undo, so it is the one
thing here that cannot be walked back.

## Local (Claude Desktop, Claude Code, Cursor)

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

Claude Code, from the repo:

```bash
claude mcp add settleup -s user \
  -e SETTLEUP_EMAIL=you@example.com -e SETTLEUP_PASSWORD=… \
  -- node /path/to/settleup-kit/dist/mcp/stdio.js
```

## Remote, over HTTP

```bash
MCP_TOKEN=$(openssl rand -hex 32) settleup-mcp-http    # POST /mcp, GET /health
```

It refuses to start without `MCP_TOKEN`. This endpoint can create and delete
transactions in a real account, so an unauthenticated port is never right.

`MCP_PORT` (default 8791) and `MCP_HOST` move it.

## Keeping an agent from doing something irreversible

Deleting a transaction cannot be undone — there is no trash and no history to
restore from. The tool description says to confirm first, but a description is a
suggestion, not a guarantee.

If that matters, run against `SETTLEUP_ENV=sandbox` while you are working out
what the agent should do, and switch to live once the shape is settled.

Editing is safe in the sense that it preserves what you did not mention, but it
has no undo either.

## What the model sees

Tool results name members rather than returning ids, because a member id is
meaningless without its group and a model will otherwise echo them at the user.
`list_groups` is the entry point: it gives the group names, the member names,
and which member you are.

Amounts are always positive. Direction comes from the tool — `add_expense` for
money spent for the group, `add_transfer` for one person paying another back.
There is no signed-amount convention to get wrong.

## Caching

Reads are cached for five minutes. Writes invalidate the group they touched, so
a balance read straight after a write is correct. A change made on someone's
phone can take up to five minutes to show up.

Both transports share one server for the life of the process, so the cache
survives across requests. The HTTP transport is still stateless per request —
there is no session table to lose on a restart.
