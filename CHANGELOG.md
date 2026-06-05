# diadem

## 0.1.0

Initial release.

- SSR-safe, framework-agnostic DI container (`DiademContainer`) with direct,
  singleton, transient, lazy-singleton, and **async** lifecycles.
- Decorators: `@singleton` / `@factory` / `@lazy` / `@lazySingleton` with
  optional environment filtering.
- **Build-time manifest generator** (`diadem build`) — AST analysis of
  constructor dependencies, token-first resolution, topological ordering, and a
  `--strict` mode that fails on cycles, ambiguous tokens, or unresolved
  required dependencies. No runtime reflection, no `reflect-metadata`.
- **Compiled emit** (`--emit=compiled`) — generates straight-line `createContainer()`
  wiring (no runtime interpretation), the same codegen approach as Dagger/Micronaut,
  plus a **compile-time-checked `createServices()` accessor**: resolving an
  unregistered token is a `tsc` error, with no custom TypeScript transformer.
- Container lifecycle: `Disposable` support, `onDispose`, and `dispose()`;
  child scopes via `createChild()`.
- Pluggable, silent-by-default logging (`setLogger` / `consoleLogger`).
- Ships ESM + CJS + type declarations; entry points `@devcraft-ts/diadem` and `@devcraft-ts/diadem/setup`.
