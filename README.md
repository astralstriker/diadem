# diadem

![types: included](https://img.shields.io/badge/types-included-blue)
![runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![reflect-metadata: none](https://img.shields.io/badge/reflect--metadata-none-brightgreen)
![license: MIT](https://img.shields.io/badge/license-MIT-green)

> Build-time architecture visibility for TypeScript. Generate a canonical dependency graph, enforce architectural boundaries, and make software structure explicit — SSR-safe, framework-agnostic, zero runtime reflection.

**diadem** makes your software architecture visible. It analyzes decorated classes at build time, extracts dependencies, and generates both a **manifest for wiring** and a **dependency graph for understanding**. At runtime, the container reads the manifest and autowires everything — **no `reflect-metadata`, no runtime constructor parsing, no global state**. You create and own the container (usually one per application); because the library keeps no hidden global container, it is safe in concurrent/SSR environments, and you can spin up child scopes for per-request isolation when you need it.

```
   decorated classes  ──►  build-time generator  ──►  service-manifest.ts  ──┐
                                                                               ├──► DiademContainer
                                                      ──►  dependency graph  ──┘
```

> **Status:** Production-ready DI foundation (v0.3) with request scopes, multi-binding, build-time cycle and scope-safety diagnostics, async lifecycle hooks, and provider bindings. Architectural insights in active development. The runtime container, decorators, dependency resolver, **`diadem build` manifest generator**, and **`diadem graph` visualizer** are all in place. See [DIADEM_VISION.md](DIADEM_VISION.md) for the architectural intelligence roadmap.

## Install

```bash
npm install @devcraft-ts/diadem
```

Requires TypeScript with `experimentalDecorators` enabled (legacy decorator
syntax) and Node ≥ 18. `typescript` is an (optional) peer dependency — needed
only to run the `diadem build` generator.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

## Build-time architecture generation

Run the generator after writing or changing decorated services:

```bash
npx diadem build              # generate service wiring
npx diadem build --watch      # rebuild automatically as you edit
npx diadem graph --serve      # visualize your dependency graph
```

**`diadem build`** scans your source, finds DI-decorated classes via the TypeScript AST, extracts and topologically sorts their constructor dependencies, and writes a manifest module (default: `src/generated/service-manifest.ts`). Import paths in the output are computed relative to the manifest file, so no path aliases are required.

**`diadem graph`** analyzes the same source and generates an interactive HTML visualization of your dependency graph — nodes are services (colored by lifecycle), edges show dependencies, cycles are flagged, and you can inspect each service's dependencies and dependents. This is where you see your architecture.

Configure via flags or a `diadem.config.json` in the project root (flags win):

```jsonc
// diadem.config.json
{
  "scanDirs": ["src"],
  "outFile": "src/generated/service-manifest.ts",
  "include": ["\\.ts$"],            // optional perf narrowing, e.g. ["Service\\.ts$"]
  "environments": ["development", "production", "test"]
}
```

```bash
diadem build --scan-dir src --out src/generated/service-manifest.ts --strict
```

`--strict` exits non-zero on dependency cycles, ambiguous (duplicated) tokens,
required dependencies with no implementing service, or dependencies wired by
naming heuristic instead of a declared token — turning runtime surprises into
build failures. (`--fail-on-cycle` is the narrower cycles-only variant.)
Wire it into your build, e.g. `"prebuild": "diadem build --strict"`.

In CI, use `diadem check`: it regenerates the output **in memory**, compares it
against the committed file, and exits non-zero if they differ — nothing is
written, so a PR that changes the service graph without re-running `diadem
build` fails fast instead of shipping stale wiring:

```bash
diadem check --strict   # non-mutating; fails on drift or strict violations
```

### Compiled mode (zero-overhead wiring)

`--emit=compiled` generates **straight-line wiring code** instead of an
interpreted data manifest — the same approach Dagger/Micronaut take on the JVM.
There's no manifest to parse, no resolver loop, and no per-dependency lookup
during construction; services are just constructed in topological order with
direct references:

```bash
diadem build --emit=compiled --target-env production --out src/generated/container.ts
```

```ts
// generated container.ts (abridged)
export function createContainer(): DiademContainer {
  const c = new DiademContainer()
  const _ConsoleLogger = new ConsoleLogger()
  c.register(token(ConsoleLogger), _ConsoleLogger)
  const _Greeter = new Greeter(_ConsoleLogger) // ← direct reference, no lookup
  c.register(token(Greeter), _Greeter)
  c.setReady()
  return c
}
```

```ts
import { createContainer } from './generated/container'
const container = createContainer() // fully wired, ready
const greeter = container.resolve(IGreeter)
```

This is the fastest path — wiring compiles down to the `new` calls you'd write
by hand, and bundlers can tree-shake unused services from the output.

**Type-safe access.** Compiled mode also emits a `createServices()` accessor
whose surface contains *only the registered tokens*, each typed to its token —
so resolving something that isn't wired is a **compile error**, not a runtime
throw:

```ts
import { createServices } from './generated/container'

const services = createServices()
const greeting: string = services.IGreeter.greet('world') // ✓ correctly typed
services.INope // ✗ tsc error: Property 'INope' does not exist on type 'DiademServices'
```

That's the compile-time guarantee of `typed-inject`/`@wessberg/di` — but reached
through decorators + auto-discovery, with no custom TypeScript transformer.
(Ambiguous or unlocatable tokens are omitted from the typed surface but still
wired into `createContainer()`.)

**Architecture as code.** Compiled emit doesn't just wire services — it encodes architectural decisions as TypeScript:

- **Lifecycles** (singleton/lazy/async) reveal initialization topology and when instances are shared vs. fresh
- **Dependencies** show coupling and layering — which services talk to which
- **Providers** represent cross-cutting concerns — config, logging, integrations
- **Overrides** support testing and environment-specific composition — architectural seams

This metadata becomes the foundation for architectural analysis: detecting cycles, measuring coupling, identifying hotspots, and enforcing boundaries.
- One environment is **baked in** per build (`--target-env`, default: all) — no
  runtime env branching.
- `lazySingleton` is registered up front but constructed only on first resolve,
  then cached. Note that laziness holds only while nothing eager depends on it:
  constructor injection forces construction, so an eager singleton that injects
  a `lazySingleton` materializes it at container creation.

### Providing externals & mocking (overrides)

Compiled mode emits a typed `Overrides` surface and threads it through both
entry points. Use it to **provide externals** the container can't build, or to
**replace any service with a mock** in tests:

```ts
import { createContainer, createServices } from './generated/container'

// Provide a third-party client the container can't construct:
const container = createContainer({ StripeClient: new StripeClient(secret) })

// Or swap a service for a fake in a test:
const services = createServices({ ILogger: silentLogger })
```

Every eager service is overridable by its token, and every importable external
is provide-able by its type — all type-checked. A required external that you
*don't* provide fails fast with a clear message (see below), instead of becoming
a silent `undefined`.

## Bringing in third-party clients (the adapter pattern)

diadem only manages classes it can construct. A raw third-party SDK that needs
secrets or runtime config (Stripe, a DB pool, an S3 client) isn't one of those —
it's an **external**. You have two good options:

1. **Wrap it in a `@singleton` adapter** (recommended). Make the SDK a managed
   service that builds itself from your `IConfig`:

   ```ts
   @singleton(IPaymentClient)
   export class StripePaymentClient extends IPaymentClient {
     private readonly stripe: StripeClient
     constructor(config: IConfig) {        // config IS a diadem service
       super()
       this.stripe = new StripeClient(config.get('STRIPE_KEY'))
     }
     charge(cents: number) { return this.stripe.charge(cents).id }
   }
   ```

   Now it's a real node in the graph, fully wired — no external, no overrides.

2. **Bind it with a `@provides` provider** *(compiled mode)*. When a constructor
   adapter feels heavy — you just want to hand the container a value or run a
   factory — declare a provider class. Its `@provides` methods bind a token to
   whatever they return, and their parameters are injected like constructor deps:

   ```ts
   @provider()
   export class Integrations {
     @provides(StripeClient)
     stripe(config: IConfig): StripeClient {     // config IS a diadem service
       return new StripeClient(config.get('STRIPE_KEY'))
     }
   }
   ```

   Now any service can depend on `StripeClient` and the container injects the
   bound instance — no external, no overrides. Provider bindings are wired at
   build time, so they only run under `--emit=compiled` (manifest mode is
   runtime-interpreted and skips them with a warning). Bindings stay overridable:
   `createContainer({ StripeClient: fake })` replaces one in a test.

3. **Depend on it directly and provide it** via `createContainer` overrides (above),
   or make the parameter optional with a fallback. Use this when the instance is
   built outside the container (a pool from your bootstrap, a client the host
   framework hands you).

If a *required* external is neither provided nor primitive, `diadem build` warns,
`--strict` fails the build, and the generated code throws a clear error rather
than passing `undefined`.

## See your architecture

The dependency graph is the primary artifact — it makes your software structure explicit.

```bash
npx diadem graph --serve         # opens http://localhost:4321 (re-analyzes on refresh)
npx diadem graph                 # or write a file: diadem-graph.html
npx diadem graph --out docs/di.html --target-env production
```

`--serve` runs a local dev server and re-renders on every refresh, so you can edit a service, reload, and immediately see the updated graph. Plain `diadem graph` writes a self-contained HTML file instead — no running app required. The graph is interactive: click a service to inspect its dependencies, dependents, and lifecycle, and cycles are highlighted in red.

## Architectural insights

The dependency graph reveals what's already happening in your code — patterns that are easy to miss in the codebase:

**Dependency cycles** — Services depending on each other create circular chains. `diadem build --strict` catches these at build time and fails the build before they become runtime errors.

**Over-coupled services** — A service with many dependents (high fan-in) or many dependencies (high fan-out) may be a bottleneck or architectural hotspot. The graph makes these visible instantly.

**Lifecycle mismatches** — A transient service depending on a singleton, or a singleton depending on a scoped service. The graph color-codes by lifecycle, so violations jump out.

**External dependencies** — Services that depend on things the container can't construct (third-party APIs, runtime config). `diadem build` tracks these and warns or fails with `--strict`.

**Convention-wired dependencies** — Dependencies matched by naming heuristic instead of a declared token. The generator reports every guess, refuses ambiguous ones outright, and `--strict` fails the build.

**Architectural boundaries** — The graph shows which services talk to which, revealing whether your intended layering (controller → application → domain → infrastructure) matches reality.

## Concepts

| Concept | What it is |
| --- | --- |
| **Token** | An abstract class used as the injection key. |
| **Decorator** | `@singleton` / `@factory` / `@lazy` / `@lazySingleton` / `@scoped` tag an implementation with its token, lifecycle, and optional environment. |
| **Manifest** | Build-time output describing every service, its dependencies, and a topological registration order. Conforms to `ServiceManifestModule`. |
| **Container** | `DiademContainer` — reads the manifest and resolves instances. Usually app-scoped; `createRequestScope()` makes an isolated request scope when needed. |

### Lifecycles

- `singleton` — one instance per container, created eagerly on registration.
- `lazySingleton` — one instance per container, created on first resolve.
- `scoped` — one instance per request scope, created on first resolve within that scope.
- `lazy` / `factory` — a new instance on every resolve.

### Request scope

Use `@scoped(Token)` for per-request state such as request context, auth
principal, correlation IDs, or unit-of-work objects. Create one request scope
from the application container and dispose it when the request finishes:

```ts
@scoped(IRequestContext)
export class RequestContext extends IRequestContext {}

const app = createContainer()
const request = app.createRequestScope()
const context = request.resolve(IRequestContext)
await request.dispose()
```

Scoped services may inject singletons, but not the other way around: a
singleton that injects a scoped service captures one instance at construction
and shares it across every request (a *captive dependency*). The generator
warns when it sees this, and `--strict` fails the build.

### Multi-binding

Use multi-binding when several implementations intentionally share one token,
such as plugin, middleware, or handler lists:

```ts
@singleton(IPlugin, { multi: true })
export class AuditPlugin extends IPlugin {}

@singleton(IPlugin, { multi: true })
export class MetricsPlugin extends IPlugin {}

const plugins = container.resolveAll(IPlugin)
```

Multi-bound tokens are retrieved with `resolveAll`, never injected as a single
constructor parameter — the generator warns if a service tries, and `--strict`
fails the build.

### Token resolution and the naming heuristic

Dependencies resolve **token-first**: a constructor parameter typed as a
declared token (`@singleton(ILogger)` → param `logger: ILogger`) is wired to
that token's implementation. When the parameter's type is *not* a declared
token, the generator falls back to a naming convention: `IFoo` matches a
service class named `Foo`, or a unique `*Service`/`*Repository` whose name
contains `Foo`.

Convention matches are guesses, so they are never silent:

- Every heuristic wiring prints a warning naming the guessed implementation
  and **fails the build under `--strict`** — strict's contract is "no runtime
  surprises", and a guess is one.
- If the convention matches **more than one** candidate (say `ILoan` against
  both `LoanService` and `LoanRepository`), diadem refuses to pick: the
  dependency is left unresolved and reported with the full candidate list.
  Earlier versions wired whichever match was found first in scan order — which
  meant a file rename could silently rewire production.

Declared tokens are the explicit, reliable path; treat the heuristic as a
prototyping convenience.

## Quick start

```ts
import { DiademContainer, configureManifest, singleton } from '@devcraft-ts/diadem'
import * as manifest from './generated/service-manifest' // your build output

abstract class ILogger {
  abstract log(msg: string): void
}

@singleton(ILogger)
class ConsoleLogger extends ILogger {
  log(msg: string) {
    console.log(msg)
  }
}

// Register the generated manifest once at startup.
configureManifest(manifest)

// Create your application container (once):
const container = new DiademContainer()
await container.autoRegisterDiscovered(process.env.NODE_ENV)
container.setReady()

const logger = container.resolve(ILogger)
logger.log('wired with diadem')
```

See [`examples/basic.ts`](examples/basic.ts) for a complete, runnable example
including a hand-written manifest that documents the generator contract.

## Manual registration

You don't have to use the manifest — the container is a perfectly good explicit
DI container on its own:

```ts
const container = new DiademContainer()
container.registerSingleton(ILogger, () => new ConsoleLogger())
container.registerFactory(IClock, () => new SystemClock())
container.register(IConfig, loadedConfig)
container.setReady()
```

## Logging

Diadem is **silent by default** — it writes nothing unless you opt in. Register a
logger to surface its diagnostics:

```ts
import { setLogger, consoleLogger } from '@devcraft-ts/diadem'

setLogger(consoleLogger) // or your own pino/winston adapter implementing `Logger`
setLogger(null) // back to silent
```

## Async services

Some services need awaited construction (open a connection, read a secret).
Register them as async and resolve with `resolveAsync`:

```ts
container.registerAsyncSingleton(IDatabase, async () => {
  const db = new Database()
  await db.connect()
  return db
})

const db = await container.resolveAsync(IDatabase) // awaited once, then cached
```

`registerAsyncFactory` gives a fresh awaited instance per `resolveAsync`. Calling
the synchronous `resolve()` on an async-only token throws a clear error.

## Lifecycle & disposal

Singletons and directly-registered values that implement `Disposable`
(`{ dispose(): void | Promise<void> }`) are torn down automatically when the
container is disposed. You can also register arbitrary teardown callbacks:

```ts
container.registerSingleton(IPool, () => new ConnectionPool()) // has dispose()
container.onDispose(() => clearInterval(timer))

await container.dispose() // runs teardown in reverse order, then clears the container
```

Child scopes share parent-owned instances by reference and never dispose them —
only resources a child registers itself are released with it. Transient
(`factory`) instances are owned by the caller and are not auto-disposed.

## API surface

- `@devcraft-ts/diadem` — `DiademContainer`, decorators (`singleton`/`factory`/`lazy`/
  `lazySingleton`), the manifest contract (`configureManifest`,
  `ServiceManifestModule`, `ServiceManifestEntry`, …), `Disposable`,
  auto-discovery utilities, and logging (`setLogger`, `consoleLogger`, `Logger`).
- `@devcraft-ts/diadem/setup` — environment-aware container factories,
  `validateAutoRegistration`, and `logSetupInfo`.
- `diadem build` — the manifest generator CLI (`bin`).

## How it compares

Most TS/JS DI lives in two camps. **Reflection + decorators** (InversifyJS,
tsyringe, TypeDI, NestJS) is ergonomic but needs `reflect-metadata` and reads
constructor types *at runtime*. **Type-safe manual** (typed-inject, brandi,
ditox) has no decorators and no reflection — the compiler verifies the graph,
but you wire everything by hand.

`diadem` is a third path: decorator ergonomics **and** auto-discovery, but the
dependency analysis happens in a **build step** that emits a static manifest —
so there's **no `reflect-metadata` and nothing reflective on the runtime path**.
On the JVM this is the Spring → **Dagger / Micronaut / Quarkus** shift (runtime
reflection → build-time wiring); `diadem` brings that shift to TypeScript.

| | reflect-metadata | decorators | auto-discovery | graph analysis at |
| --- | --- | --- | --- | --- |
| Inversify / tsyringe / Nest | required | yes | yes | runtime |
| typed-inject / brandi / ditox | no | no | no | compile (type-checked) |
| **diadem** | **no** | yes | yes | **build (`diadem build`)** |

For maximum runtime performance **and** type safety, `diadem build
--emit=compiled` emits straight-line wiring (no runtime interpretation — the same
codegen approach as Dagger/Micronaut, the fastest DI path in TS/npm) plus a
`createServices()` accessor that is **compile-time checked**: resolving an
unregistered token is a `tsc` error. That matches `typed-inject`/`@wessberg/di`
on safety, but without their cost — `@wessberg/di` needs a custom TypeScript
transformer (and `ts-patch`/`ttypescript`, which broke at TS 5.0), whereas
`diadem` emits plain `.ts` that any toolchain (tsc, esbuild, swc, vite, bun)
compiles as-is.

Trade-offs to know — stated plainly, because they matter at scale:

- **Graph analysis is syntactic and name-based, not type-checked.** The
  generator parses each file's AST without building a TypeScript program —
  that's what keeps builds fast, but it has two consequences. (a) Token
  identity is the token's *name*: two different abstract classes that happen to
  share a name (e.g. two `IConfig`s in different packages of a monorepo) can
  collide or cross-wire. (b) Nothing structurally verifies that a decorated
  class actually implements its token. `--strict` catches everything catchable
  by name (unresolved and ambiguous tokens, heuristic wiring, cycles, scope
  violations); an opt-in type-checked pass for structural verification and
  cross-package token disambiguation (`--type-check`) is on the roadmap. Until
  then, keep token names unique across the codebase you scan.
- **Convention wiring is a guess.** Parameters not typed as a declared token
  may be wired by the `IFoo` → `Foo`/`FooService` naming heuristic; every such
  match is reported, ambiguous matches are never wired, and `--strict` rejects
  them (see [Token resolution](#token-resolution-and-the-naming-heuristic)).
- A singleton's factory runs at registration, so **registration order matters**
  (the generator emits services in topological order for you; use
  `lazySingleton` to defer construction).
- The generated manifest grows with the number of services.

The decorators work under both TC39 (Stage 3) and legacy
(`experimentalDecorators`) modes — they're read from source at build time, so
your `tsconfig` decorator setting doesn't change the wiring.

## Roadmap

Diadem is evolving toward an **Architectural Intelligence Platform**. The DI container is the foundation; the dependency graph is the primary product. See [DIADEM_VISION.md](DIADEM_VISION.md) for the long-term direction:

- **Layer 1 — Runtime foundation** (current) — production-ready DI, lifecycle management, async init, provider bindings
- **Layer 2 — Canonical graph** (parallel) — service graph generation, module boundaries, metadata extraction
- **Layer 3 — Architectural insights** (started) — cycle detection and scope-safety diagnostics ship today in `diadem build --strict`; coupling metrics, boundary enforcement, and health scoring to come
- **Layer 4 — Ecosystem** (future) — VS Code extension, CI/CD checks, dashboards, documentation generators

### Shipped (v0.2.x → v0.4)

**v0.2.x** — Runtime foundation maturity
1. ✅ `diadem build --watch` *(0.2.0)*.
2. ✅ **Value/factory bindings** via `@provides` *(0.2.0, compiled mode)*.
3. ✅ **Async services** — `@asyncSingleton` + `createContainerAsync`, `onInit` lifecycle hook *(0.2.1)*.

**v0.3** — Architectural expressiveness
4. ✅ Managed **request scope** — `@scoped(IRequestContext)` + `createRequestScope()`.
5. ✅ True lazy in compiled mode (honor `lazySingleton` instead of eager).
6. ✅ **Multi-binding** — `@singleton(IPlugin, { multi: true })` + `resolveAll` for plugin architectures.

**v0.4** — CI guardrails & no silent guesses
7. ✅ **`diadem check`** — non-mutating drift check for CI: regenerates in memory and fails if the committed output is stale.
8. ✅ **Heuristic-wiring diagnostics** — naming-convention matches are always reported and fail `--strict`; ambiguous matches are never wired (previously the first scan-order match was wired silently).

### v0.5 — Canonical graph (Layer 2)

With the runtime foundation complete, the graph becomes the product:

9. **Graph as a stable artifact** — `diadem graph --emit json` with a versioned schema (services, lifecycles, environments, edges, externals), so tools can consume the architecture model without parsing TypeScript.
10. **Modules & boundaries** — declare bounded contexts with private providers and an explicit public surface; the graph records every edge that crosses a boundary.
11. **Architecture APIs** — a programmatic `analyzeGraph()` entry point (the CLI already uses it internally) for custom tooling.

### v0.6 — Architectural insights (Layer 3)

Analysis on top of the canonical graph. Cycle detection and the scope-safety diagnostics (captive scoped dependencies, multi-binding misuse, env-ambiguous tokens, heuristic wiring) already ship in `diadem build --strict` — this layer generalizes them:

12. **Boundary enforcement** — fail the build when an edge violates a declared module boundary.
13. **Coupling & health metrics** — afferent/efferent coupling, instability, and hotspot scoring per module, with CI-friendly output.
14. **Drift detection** — diff two graph artifacts (main vs. PR) and report new cycles, new boundary crossings, and removed seams.

### Layer 4 & runtime conveniences (future)

15. Framework adapters (Express/Fastify per-request scope, React provider).
16. VS Code extension, CI/CD checks, dashboards, documentation generators — consumers of the Layer 2 graph.

**Later / optional:** `--type-check` (an opt-in `ts.Program` pass for structural implements-verification and cross-package token disambiguation — closes the name-based-identity gap for large monorepos), named/qualified bindings, circular-dependency escape, property/setter injection, unused-service detection, offline graph viewer.

**Non-goals**
- A custom-transformer mode for `resolve<IFoo>()` / interface tokens. That's
  exactly what [`@wessberg/di`](https://github.com/wessberg/DI) already does, and
  adopting it would require `ts-patch`/`ttypescript` and break diadem's
  no-transformer, toolchain-agnostic guarantee — the main reason to choose it. If
  you want reified-style ergonomics, `@wessberg/di` is the right tool; diadem
  deliberately trades a little token verbosity for working in any toolchain with
  no compiler surgery.

**Speculative**
- Generic/parameterized services (`Repository<User>` vs `Repository<Order>`) —
  resolvable distinctly via build-time type-arg analysis. Niche, but something
  only a build-time tool could reasonably do in TS.

## License

[MIT](LICENSE) © Jai Sachdeva
