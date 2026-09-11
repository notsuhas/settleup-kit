# The Settle Up API

Settle Up is a Firebase project. There is no bespoke REST API — you authenticate
with Google Identity Toolkit and then read and write the Realtime Database
directly, subject to its security rules.

Step Up Labs document this at [api.settleup.io](https://api.settleup.io/), which
is the authoritative source for the data model. This page covers what the kit
actually does with it, and fills in the parts the official docs leave out.

## Projects

|         | API key                                   | Database                                   |
| ------- | ----------------------------------------- | ------------------------------------------ |
| live    | `AIzaSyDbf9JS-Mrtbcd25Hff4Pj0yTsg844JovE` | `https://settle-up-live.firebaseio.com`    |
| sandbox | `AIzaSyCBsW4lveImpcB92c-cnNg2VQgx9JdijU8` | `https://settle-up-sandbox.firebaseio.com` |

The live config is served publicly at
`https://settleup.app/__/firebase/init.json`. A Firebase web API key is an
identifier, not a credential — see [traps.md](traps.md).

## Authentication

Sign in with email and password:

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<apiKey>
{ "email": "…", "password": "…", "returnSecureToken": true }
```

The response carries `idToken` (a JWT, valid one hour), `refreshToken`, and
`localId` — your user id, which every read below is keyed on.

Renew without signing in again:

```
POST https://securetoken.googleapis.com/v1/token?key=<apiKey>
grant_type=refresh_token&refresh_token=<refreshToken>
```

Both the ID token and the refresh token rotate. There is no device limit, so
this chain continues indefinitely.

Google sign-in also works on the account, but email/password is the only flow
worth scripting.

## Reading and writing

Every node is a JSON document at `<databaseURL>/<path>.json?auth=<idToken>`.
Verbs map the obvious way: `GET` reads, `PUT` replaces, `PATCH` merges, `POST`
appends a new push-id child and returns `{"name": "<pushId>"}`, `DELETE`
removes.

An empty or absent node answers `null` with HTTP 200.

## Paths

| Path                              | What                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `users/<uid>`                     | name, email, photo, locale                                |
| `userGroups/<uid>`                | `{ <groupId>: { member, order, color } }` — start here    |
| `groups/<groupId>`                | name, `convertedToCurrency`, `minimizeDebts`, invite link |
| `members/<groupId>`               | `{ <memberId>: { name, active, defaultWeight, … } }`      |
| `transactions/<groupId>`          | `{ <txId>: <transaction> }`                               |
| `debts/<groupId>`                 | `[{ from, to, amount }]` — server-computed, read-only     |
| `permissions/<groupId>/<uid>`     | `level`: 30 owner, 20 read/write, 10 read-only            |
| `groupCategories/<groupId>`       | emoji to custom category name                             |
| `changes/<groupId>`               | the activity feed the app shows                           |
| `recurringTransactions/<groupId>` | templates and their recurrence rules                      |

`userGroups` is the entry point: it tells you which groups you can see _and_
which member you are in each.

## A transaction

```json
{
  "type": "expense",
  "purpose": "Dinner in Alfama",
  "category": "🍽",
  "currencyCode": "JPY",
  "dateTime": 1789114693430,
  "timezone": "+05:30",
  "fixedExchangeRate": false,
  "whoPaid": [{ "memberId": "-Nq7xR2…", "weight": "1" }],
  "items": [
    {
      "amount": "3200",
      "forWhom": [
        { "memberId": "-Nq7xR2…", "weight": "1" },
        { "memberId": "-Nq7xS5…", "weight": "1" }
      ]
    }
  ]
}
```

- `type` is `expense` or `transfer`. A transfer is one payer, one recipient, one
  item, and no category.
- Amounts are **strings**, and live per item. There is no top-level total.
- `weight` is the share: `"1"` each is an even split, `"2"` gives double.
- `dateTime` is milliseconds since epoch.
- `purpose` may not be empty.

On write the server adds `exchangeRates` (and `migrated`), then recalculates
`/debts/<groupId>`.

## What this kit does not cover

Receipts (Cloud Storage), recurring transactions, the `changes` activity feed,
and permission changes. All are reachable through the exported `Db` class if
you need them:

```ts
import { createClient, Db } from "@notsuhas/settleup-kit";
```

Deleting a group **is** covered, but the order matters: `permissions` must go
last, because it is what authorises every other delete. See
[traps.md](traps.md).
