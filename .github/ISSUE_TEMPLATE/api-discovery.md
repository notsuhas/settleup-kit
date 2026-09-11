---
name: API discovery or correction
about: An endpoint, field or behaviour that the docs get wrong or miss
labels: docs, api
---

**Which path** — e.g. `transactions/<groupId>`, `debts/<groupId>`:

**What the docs say now** (link to the line in `docs/api.md` or `docs/traps.md`,
or say "not covered"). Settle Up's own docs are at https://api.settleup.io/ and
are explicitly incomplete, so "not covered there either" is useful to know:

**What you observed** — request and response, with tokens, member ids and
personal amounts removed:

```
POST /...
{...}

-> {...}
```

**How you confirmed it** — e.g. ran it twice, watched the app do it, checked the
group afterwards:
