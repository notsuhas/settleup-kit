# Contributing

```bash
npm install
npm run verify        # typecheck, lint, format, tests, health
```

`npm run verify` is what CI runs. If it passes locally it passes there.

## The tooling, and who owns what

One tool per job, so nothing is checked twice or fought over:

|               | Owns                                                          |
| ------------- | ------------------------------------------------------------- |
| **Biome**     | lint and format for `.ts`, `.js`, `.json`                     |
| **Prettier**  | format for `.md`, `.yaml` — Biome does not support these yet  |
| **tsc**       | types, in strict mode with `noUncheckedIndexedAccess`         |
| **node:test** | tests, via the built-in runner — no test framework dependency |
| **Fallow**    | dead code, duplication, complexity                            |

`npm run format` fixes everything fixable.

Fallow's dead-code and duplication checks are expected to stay at zero. Its
health score is advisory and does not gate CI: a low score on a file is a prompt
to look, not a reason to block a correct fix.

## What tests to write

Only the pure logic is tested, and deliberately so — there are no mocked HTTP
fixtures, because a fixture of someone else's API mostly tests that the fixture
still matches itself.

So: put the logic worth protecting in a pure function and test that. The money
arithmetic, the payload builder, the debt derivation and the query filters all
live in `src/core/` for this reason. The client and the backends stay thin
enough to read.

Every test corresponds to a mistake that was possible against a real account. If
you fix a bug, add the case that would have caught it.

## Style

- Files stay under about 250 lines. That is a prompt to look for a second
  responsibility, not a hard rule — split when you can name the extracted piece
  without the word "utils".
- Comments explain **why**, in one line. If a comment needs a paragraph to
  justify the code, the code is usually the problem.
- Public API is exported from `src/index.ts` and nothing else. An export with no
  consumer is dead code, and Fallow will say so.

## Testing against a real account

Settle Up runs a **sandbox** project — use it. `--sandbox`, or
`SETTLEUP_ENV=sandbox`, points everything at it. It has its own users, so
register one through
[the sandbox web app](https://settle-up-sandbox-app.web.app/) first; your live
login does not work there.

Against a live account:

- Read-only commands are safe: `whoami`, `groups`, `members`, `list`,
  `balances`.
- For writes, make a throwaway group with one other member and work in that.
  Never test against a group other people are using — a stray expense changes
  what their app says they owe.
- Clean up after yourself. `settleup rm <id> --group <name>`, then check
  `balances` reads "all settled up".

## Reporting an API discovery

The most valuable contribution here is not code. Settle Up publishes a
[data model](https://api.settleup.io/) but it is explicitly incomplete. If you
find a field or a behaviour that isn't in [docs/api.md](docs/api.md) or
[docs/traps.md](docs/traps.md), open an issue with the request and response —
credentials removed.

Corrections especially welcome. The exchange-rate direction in `docs/traps.md`
was written backwards on the first attempt and only caught by checking the
arithmetic against a real balance.

## Releasing

Versions are driven by [changesets](https://github.com/changesets/changesets),
so the changelog is written when the change is fresh rather than reconstructed
from git log at release time.

With a change ready, describe it:

```bash
npm run changeset      # pick patch/minor/major, write one line for users
```

That drops a markdown file in `.changeset/`; commit it with the change. To cut a
release from whatever has accumulated:

```bash
npm run bump           # rolls the changesets into CHANGELOG.md and the version
npm run verify
git commit -am "chore: release" && git tag "v$(node -p 'require("./package.json").version')"
git push --follow-tags
```

The tag triggers `.github/workflows/release.yml`, which publishes from CI with
provenance. It carries no npm token: npm authenticates the workflow by its OIDC
identity, which has to be registered once as a trusted publisher under the
package's settings on npmjs.com.

Write the changeset for someone using the package, not for someone reading the
diff — "an edit no longer clears the split" rather than "rebuild items from
row".
