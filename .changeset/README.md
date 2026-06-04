# Changesets

This folder holds [changesets](https://github.com/changesets/changesets) —
intent-to-release notes that drive versioning and the CHANGELOG.

Add one with:

```bash
npx changeset
```

Pick the bump (patch/minor/major), write a short summary, and commit the
generated file. On merge to `main`, the release workflow opens/updates a
"Version Packages" PR; merging that PR publishes to npm.
