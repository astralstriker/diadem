# Contributing to diadem

Thanks for your interest! This is a small, focused TypeScript package.

## Setup

```bash
npm install
```

## Workflow

| Task | Command |
| --- | --- |
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |
| Test | `npm test` (watch: `npm run test:watch`) |
| Build | `npm run build` (ESM + CJS + d.ts via tsup) |

Please keep all four green before opening a PR. CI runs them on Node 18/20/22.

## Project layout

```
src/
  index.ts            Public entry (re-exports core)
  core/
    container.ts      DiademContainer + DIContainer interface
    decorators.ts     @singleton / @factory / @lazy / @lazySingleton
    dependency-resolver.ts  Manifest-driven constructor injection
    auto-discovery.ts Reads the configured manifest
    manifest.ts       ServiceManifestModule contract + injection seam
    logger.ts         Pluggable, silent-by-default logging
  setup/              Environment-aware container factories
  cli/                The `diadem build` generator (config + generator + CLI)
examples/             Runnable usage examples
```

## Standards

- **No `any`** — use `unknown` or proper types. The only exception is the
  `...args: any[]` constructor-signature idiom, fenced with an eslint comment.
- **No `console`** in library code — log through `getLogger()`. The CLI may
  write to `process.stdout`/`process.stderr`.
- Prefer small, focused modules and keep the public API minimal.

## Running the generator locally

```bash
node dist/cli.js build --cwd /path/to/a/project
```

## Releasing

We use [changesets](https://github.com/changesets/changesets). Add a changeset
describing your change:

```bash
npx changeset
```

Merging to `main` opens a "Version Packages" PR; merging that publishes to npm.
