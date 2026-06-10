---
'@devcraft-ts/diadem': minor
---

v0.3 — request scope, true lazy in compiled mode, multi-binding, and scope-safety diagnostics.

- **Managed request scope** — `@scoped(Token)` + `container.createRequestScope()`. Scoped services are constructed once per scope, cached in that scope, and torn down by `scope.dispose()` without touching parent singletons.
- **True lazy in compiled mode** — `lazySingleton` is now emitted as a cached factory (constructed on first resolve) instead of being treated as eager, and participates in the `Overrides` seam.
- **Multi-binding** — `@singleton(Token, { multi: true })` + `container.resolveAll(Token)` for plugin/middleware/handler lists, preserved in registration order and excluded from single-token accessors.
- **Build-time diagnostics** — the generator now warns on captive scoped dependencies (a non-scoped service injecting a scoped one) and on multi-bound tokens injected as single constructor parameters; both fail the build under `--strict`.
- **Fix** — environment-split implementations of one token (e.g. dev/prod metrics) now resolve to the impl that survives `--target-env`; previously dependents were silently wired to nothing when the first-seen impl was filtered out, and the build emitted a false "ambiguous token" warning for the supported one-impl-per-environment pattern.
- **Fix** — compiled emit no longer mis-types `onInit()` when the service is overridable (the override and constructed branches are emitted separately).
