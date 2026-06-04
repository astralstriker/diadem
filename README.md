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
npm install diadem
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

Trade-offs vs. the default manifest emit:
- One environment is **baked in** per build (`--target-env`, default: all) — no
  runtime env branching.
- `lazySingleton` is treated as **eager** (its instance is referenced up front).
- No runtime mock/override registration — use the manifest emit for dev/test if
  you rely on that dynamism.

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
import { DiademContainer, configureManifest, singleton } from 'diadem'
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
import { setLogger, consoleLogger } from 'diadem'

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

- `diadem` — `DiademContainer`, decorators (`singleton`/`factory`/`lazy`/
  `lazySingleton`), the manifest contract (`configureManifest`,
  `ServiceManifestModule`, `ServiceManifestEntry`, …), `Disposable`,
  auto-discovery utilities, and logging (`setLogger`, `consoleLogger`, `Logger`).
- `diadem/setup` — environment-aware container factories, `validateAutoRegistration`,
  and `logSetupInfo`.
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

For maximum runtime performance, `diadem build --emit=compiled` emits
straight-line wiring (no runtime interpretation) — the same codegen approach as
Dagger/Micronaut, which makes it the fastest DI path available in TS/npm.

Trade-offs to know: `diadem` resolves tokens by identifier (use `--strict` to
turn unresolved/ambiguous tokens into build errors — closer to Dagger's
compile-time guarantees); a singleton's factory runs at registration, so
**registration order matters** (the generator emits services in topological
order for you; use `lazySingleton` to defer construction); and the generated
manifest grows with the number of services. It uses legacy
(`experimentalDecorators`) decorators.

## Roadmap

- Richer dependency-graph diagnostics from the generator (visualization, unused
  service detection).
- A `--check` dry-run mode and a benchmark harness.

## License

[MIT](LICENSE) © Jai Sachdeva
