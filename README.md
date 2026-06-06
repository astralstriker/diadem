# diadem

![types: included](https://img.shields.io/badge/types-included-blue)
![runtime deps: 0](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![reflect-metadata: none](https://img.shields.io/badge/reflect--metadata-none-brightgreen)
![license: MIT](https://img.shields.io/badge/license-MIT-green)

> Build-time, manifest-driven dependency injection for TypeScript — SSR-safe, framework-agnostic, zero runtime reflection.

**diadem** wires your services from a manifest that is generated at build time. A
generator analyses your decorated classes, extracts each constructor's
dependencies, topologically sorts them, and emits a manifest module. At runtime
the container reads that manifest and autowires everything — **no
`reflect-metadata`, no runtime constructor parsing, no global state**. You create
and own the container (usually one per application); because the library keeps no
hidden global container, it is safe in concurrent/SSR environments, and you can
spin up child scopes for per-request isolation when you need it.

```
   decorated classes  ──►  build-time generator  ──►  service-manifest.ts
                                                              │
                                                              ▼
                              configureManifest(manifest) ──► DiademContainer
```

> **Status:** early but complete (`0.1.0`). The runtime container, decorators,
> dependency resolver, and the **`diadem build` manifest generator** are all in
> place. You can also hand-write a manifest conforming to `ServiceManifestModule`
> (see [`examples/basic.ts`](examples/basic.ts)).

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

## Generating the manifest

Run the generator after writing or changing decorated services:

```bash
npx diadem build
```

It scans your source, finds DI-decorated classes via the TypeScript AST,
extracts and topologically sorts their constructor dependencies, and writes a
manifest module (default: `src/generated/service-manifest.ts`). Import paths in
the output are computed relative to the manifest file, so no path aliases are
required.

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

`--strict` exits non-zero on dependency cycles, ambiguous (duplicated) tokens, or
required dependencies with no implementing service — turning runtime surprises
into build failures. (`--fail-on-cycle` is the narrower cycles-only variant.)
Wire it into your build, e.g. `"prebuild": "diadem build --strict"`.

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

Trade-offs vs. the default manifest emit:
- One environment is **baked in** per build (`--target-env`, default: all) — no
  runtime env branching.
- `lazySingleton` is treated as **eager** (its instance is referenced up front).
- No runtime mock/override registration — use the manifest emit for dev/test if
  you rely on that dynamism.

## Visualize the dependency graph

`diadem graph` writes a self-contained, interactive HTML page of your dependency
graph — nodes are services (colored by lifecycle), arrows point to what they
depend on, cycles are flagged in red, and clicking a node shows its
dependencies and dependents. It reads the same source as `diadem build`, so no
running app or manifest is required.

```bash
npx diadem graph                 # writes diadem-graph.html
npx diadem graph --out docs/di.html --target-env production
```

Open the file in a browser. (It loads its graph layout library from a CDN, so
view it online.)

## Concepts

| Concept | What it is |
| --- | --- |
| **Token** | An abstract class used as the injection key. |
| **Decorator** | `@singleton` / `@factory` / `@lazy` / `@lazySingleton` tag an implementation with its token, lifecycle, and optional environment. |
| **Manifest** | Build-time output describing every service, its dependencies, and a topological registration order. Conforms to `ServiceManifestModule`. |
| **Container** | `DiademContainer` — reads the manifest and resolves instances. Usually app-scoped; `createChild()` makes an isolated scope when needed. |

### Lifecycles

- `singleton` — one instance per container, created eagerly on registration.
- `lazySingleton` — one instance per container, created on first resolve.
- `lazy` / `factory` — a new instance on every resolve.

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

Trade-offs to know: build-time graph validation is name-based (`--strict` turns
unresolved/ambiguous tokens into build errors) rather than fully type-driven; a
singleton's factory runs at registration, so **registration order matters** (the
generator emits services in topological order for you; use `lazySingleton` to
defer construction); and the generated manifest grows with the number of
services. It uses legacy (`experimentalDecorators`) decorators.

## Roadmap

- Unused-service detection and other graph diagnostics (the interactive
  `diadem graph` viewer already ships).
- Offline mode for `diadem graph` (inline the layout library).
- Type-driven `--strict` (verify the whole graph at the type level, not just by
  token name).

## License

[MIT](LICENSE) © Jai Sachdeva
