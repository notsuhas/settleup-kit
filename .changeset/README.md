# Changesets

A changeset is a note describing one user-visible change and how it should move
the version. `npm run changeset` writes one; they accumulate here and are
consumed by `npm run bump`, which rolls them into `CHANGELOG.md` and the version
in `package.json`. See [CONTRIBUTING.md](../CONTRIBUTING.md#releasing).
