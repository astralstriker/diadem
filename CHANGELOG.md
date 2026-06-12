# diadem

## 0.4.0

### Minor Changes

- fac300b: v0.4 — `diadem check` for CI, and no more silent heuristic wiring.

  Both changes come out of an external source review of the generator; the issues are documented in the README's trade-offs section as well.

  - **`diadem check`** — new CLI command for CI: regenerates the manifest/compiled wiring **in memory**, compares it against the committed file, and exits non-zero on drift. Nothing is written, so a PR that changes the service graph without re-running `diadem build` fails fast instead of shipping stale wiring. Honors `--strict` and `--fail-on-cycle`.
  - **Heuristic wiring is never silent anymore.** When a constructor parameter's type is not a declared token, the generator falls back to a naming convention (`IFoo` → `Foo`, or a unique `*Service`/`*Repository` containing `Foo`). Previously these guesses were wired with no diagnostic, and multiple candidates were resolved to whichever match the file scan found first — meaning a file rename could silently rewire production. Now:
    - every convention-based wiring emits a warning naming the guessed implementation, and **fails the build under `--strict`** (a guess violates strict's "no runtime surprises" contract);
    - a convention match with **multiple candidates** (e.g. `ILoan` matching both `LoanService` and `LoanRepository`) is never wired — the dependency is left unresolved and reported with the full candidate list;
    - heuristic-wired dependencies are marked `"heuristic": true` in the generated manifest.
  - **Known limitation, stated honestly:** graph analysis remains syntactic and name-based — token identity is the token's _name_, so two same-named abstract classes in different packages can collide, and nothing structurally verifies that a class implements its token. An opt-in type-checked pass (`--type-check`) is on the roadmap; until then, keep token names unique across the scanned codebase.

## 0.3.0

### Minor Changes

- c4f75f5: v0.3 — request scope, true lazy in compiled mode, multi-binding, and scope-safety diagnostics.

  - **Managed request scope** — `@scoped(Token)` + `container.createRequestScope()`. Scoped services are constructed once per scope, cached in that scope, and torn down by `scope.dispose()` without touching parent singletons.
  - **True lazy in compiled mode** — `lazySingleton` is now emitted as a cached factory (constructed on first resolve) instead of being treated as eager, and participates in the `Overrides` seam.
  - **Multi-binding** — `@singleton(Token, { multi: true })` + `container.resolveAll(Token)` for plugin/middleware/handler lists, preserved in registration order and excluded from single-token accessors.
  - **Build-time diagnostics** — the generator now warns on captive scoped dependencies (a non-scoped service injecting a scoped one) and on multi-bound tokens injected as single constructor parameters; both fail the build under `--strict`.
  - **Fix** — environment-split implementations of one token (e.g. dev/prod metrics) now resolve to the impl that survives `--target-env`; previously dependents were silently wired to nothing when the first-seen impl was filtered out, and the build emitted a false "ambiguous token" warning for the supported one-impl-per-environment pattern.
  - **Fix** — compiled emit no longer mis-types `onInit()` when the service is overridable (the override and constructed branches are emitted separately).

## 0.2.2

### Patch Changes

- decef2c: Async services (@asyncSingleton) and onInit lifecycle hooks

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
