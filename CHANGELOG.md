# diadem

## 0.2.1

Async services and lifecycle hooks.

- **`@asyncSingleton` decorator** — for services that need awaited initialization
  (database pools, secret clients, etc.). Pairs with an `async onInit()` method on
  the service. Async services are only wired by **compiled emit** (`--emit=compiled`),
  which generates `createContainerAsync()` instead of `createContainer()`. Manifest
  emit skips them with a warning.
- **`onInit()` lifecycle hook** — sync or async post-construction setup method,
  called after the service is constructed. Applicable to eager services (singletons,
  lazy singletons, async singletons). Automatically invoked only in compiled emit;
  skipped if the service is overridden. Enables DB connection pooling, config
  loading, warm-up logic without polluting constructors.

## 0.2.0

Expressiveness pass — value/factory bindings and a watch mode.

- **Value/factory bindings** via `@provider` classes and `@provides` methods.
  Bind a token to whatever a method returns (a third-party SDK client, a
  config-derived value, a computed instance), with the method's parameters
  injected like constructor dependencies. Bindings are wired at build time in
  **compiled emit** (`--emit=compiled`) and stay overridable for tests; manifest
  emit skips them with a warning (it can't call provider methods at runtime).
  The decorators work under both TC39 and legacy (`experimentalDecorators`)
  modes.
- **`diadem build --watch`** — regenerate the manifest/compiled wiring as source
  changes (debounced, ignores its own output, survives errors).
- **Benchmark harness** (`bench/`) comparing diadem to tsyringe, inversify,
  typed-inject, and hand-wired code across bundle size, cold start, memory, and
  scaling, plus a consolidated `RESULTS.md`.

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
