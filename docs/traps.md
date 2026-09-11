# Traps

Everything here cost real time to work out, and each was verified against a live
account rather than inferred from the docs.

## An empty description is rejected as "Permission denied"

A transaction whose `purpose` is `""` is refused by the database's security
rules. The error is a bare `Permission denied` with HTTP 401 — which reads like
an expired token, not a validation failure, so it sends you off debugging auth.

Verified on both types: an expense and a transfer with a non-empty `purpose`
both succeed at the same moment the empty ones fail.

This kit refuses an empty description before the request goes out. A transfer
defaults to `"Debt settlement"`, which is the wording the app itself writes.

## Push ids start with a hyphen

Firebase push ids look like `-Nq7xR2vK9mBpL4dTfWc`. That leading `-` means any
argument parser reads a transaction id as an option and aborts, so
`settleup rm <id>` cannot work without help. The CLI pulls push-id-shaped
arguments out of `argv` before parsing, rather than making you write
`rm -- <id>`.

The same bites shell scripts and anything building a URL path by concatenation.

## Exchange rates divide, they don't multiply

The server fills in `exchangeRates` on write, keyed by the _other_ currency.
Read `{ INR: "1.61" }` on a JPY row as **1 INR = 1.61 JPY** — so converting the
row into INR means dividing.

Getting this backwards is easy and silent, because both directions produce a
plausible-looking number. Verified arithmetically: a 4000 JPY expense split two
ways moved the group balance by exactly 4000 / 1.61416 / 2 = 1239.03 INR.

## Debts are computed by the server, and you cannot trigger it

`/debts/<groupId>` is recalculated server-side on every transaction write. You
read it; you never write it.

The public docs mention a `calculateGroupsDebts` server task at
`/serverTasks/<taskName>`. Posting to it as a normal user answers
`Permission denied` — it is not a client-callable endpoint. You do not need it:
a write to `/transactions/<groupId>` triggers the recalculation on its own, and
`/debts` reflects it within about a second.

## The amount is not where you would look for it

There is no top-level amount. Money lives in `items[].amount`, as a **string**,
and an expense can have several items — Settle Up uses the second and third for
tip and tax. The total is the sum across items, which is why this kit derives
`amount` rather than passing one through.

`whoPaid` is top-level, but `forWhom` is **per item**, so a tip can be split
differently from the meal.

## A write replaces the whole node

The Realtime Database has no patch-one-field-of-an-array semantics that survive
a PUT. Writing a hand-built transaction object destroys anything you left out —
the receipt URL, the timezone, the extra item lines, the split.

`editTransaction` reads the live row, applies only what you asked for, and
writes the result back, for exactly this reason.

One field is deliberately dropped on edit: `exchangeRates`, unless
`fixedExchangeRate` is set. Keeping a stale rate against a changed amount or
currency would be worse than letting the server recompute it.

## Empty and missing are the same thing

Firebase answers `null` with HTTP 200 for a node that is empty _and_ for one
that does not exist. A group with no transactions and a group id that never
existed are indistinguishable at the transport level, so an empty result is not
proof that you asked the right question.

## Member ids are per group

The same person is a different member id in every group they belong to — Bob
is `-Nq7xS5wM1nCqR6eUgXd` in one group and something else in another. There is
no global person id, so a member id is meaningless without its group.

Which member _you_ are comes from `userGroups/<uid>/<groupId>/member`. A user
can be in a group without being mapped to a member, in which case "who paid"
cannot be inferred and has to be given.

## There is no device limit

Unlike some services, Firebase does not ration sessions. A refresh token renews
the ID token indefinitely, and signing in again costs nothing and evicts
nothing. So the token cache here is an optimisation, not a safety measure, and
`settleup login --force` is harmless.

ID tokens last one hour. The kit refreshes automatically; you should not need to
think about it.

## The API key is not a secret

`FIREBASE.live.apiKey` is checked into this repo. That is correct: a Firebase
web API key identifies a project, it does not authorise anything. It is served
publicly at `settleup.app/__/firebase/init.json` and is embedded in every copy
of the web and mobile apps. Access is controlled entirely by the ID token and
the database's security rules.

Your **password** is a secret. The token cache is written `0600` for that
reason.

## Sandbox and live are separate accounts

Settle Up runs a sandbox project with its own API key, its own database and its
own users. Your live login does not work there — you have to register a sandbox
user through their sandbox web app.

`--sandbox` (or `SETTLEUP_ENV=sandbox`) points the kit at it. It is the right
place to test a bulk edit, but it is not a copy of your data.

## Fields the server adds behind you

A freshly written transaction comes back with `exchangeRates` and `migrated: 1`
that you did not send. Don't treat a round-tripped row as equal to what you
wrote, and don't send `migrated` yourself.

## A group is refused without an invite link

Creating a group answers `Permission denied` — the same misleading 401 as
above — until the write includes `inviteLinkHash`. It is a *validation* rule,
not a permission one: the field is what the join-by-link flow keys on, and the
rules will not accept a group that can never be joined.

The full create is four writes, in this order:

1. `permissions/<id>/<uid>` = `{ level: 30 }` — the caller has to be able to
   write the group before the group exists. Nothing else is accepted first.
2. `groups/<id>` — with `inviteLinkHash`, `inviteLink` and `inviteLinkActive`
   alongside the name and currency.
3. `members/<id>/…` — one per person.
4. `userGroups/<uid>/<id>` — makes it visible in the app, and records which
   member you are.

Because step 1 needs the id before anything exists, the id has to be generated
client-side with Firebase's own push-id algorithm rather than by a POST.

Two things that mislead while working this out. Writing a *member* first makes
the server create `groups/<id>` holding only a `lastChanged`, so the node
appears to exist while still rejecting every write. And once you delete your
own `permissions` node you lose read access to the rest, so a half-built group
becomes unreachable rather than cleanable — build it in the right order or not
at all.

**Editing** an existing group needs none of this: a `PATCH` on `groups/<id>`
with a name, `convertedToCurrency` or `minimizeDebts` works with level 30, and
shows up in the app immediately. Use `PATCH`, not `PUT` — `lastChanged` is
server-managed and a replace would drop the invite link and the premium fields.

## The ID token goes in the query string, and has to

Every database request carries `?auth=<idToken>`. A query parameter is the part
of an HTTPS request most likely to end up in a proxy log or an APM trace, so
the obvious hardening is to move it to an `Authorization: Bearer` header.

That does not work. Firebase RTDB accepts a Bearer header only for an OAuth2
*access* token; handed a Firebase **ID** token it answers
`{"error": "Unauthorized request."}`, while the same token in `?auth=` succeeds.
Verified against the live database.

So the token stays in the URL. Nothing here logs a URL — errors carry only the
response body and the status — but anything you build on top should keep it
that way.
