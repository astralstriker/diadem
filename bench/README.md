# diadem benchmarks

Compares `@devcraft-ts/diadem` against other TypeScript DI containers on a
realistic dependency graph.

## What it measures

An 11-service graph, layered the way a real app tends to look:

```
Config  Clock
  │       │
Logger  Metrics
  │  \   /  │
  Db    Cache
  │ \   / │
UserRepo OrderRepo
  │  \   /  │
UserService OrderService
       \   /   │
        App (root)
```

Every framework implements the **same** graph in its own idiom. Each service
has a deterministic `value()`; the root must compute `2448`, which the harness
asserts before benchmarking, so we know the graphs are equivalent.

Two scenarios:

- **Cold** — build a fresh container with all services registered as singletons,
  then resolve the root. This is the build-vs-runtime story: it includes whatever
  wiring/reflection each framework does.
- **Hot** — resolve the root from an already-built container (a cached lookup).

## Running it

```bash
npm run build          # in the repo root, so the file:.. dep is fresh
cd bench
npm install
npm run bench          # generates diadem manifests, compiles with tsc, runs
```

It compiles with **`tsc`** (not esbuild/tsx) on purpose: tsyringe and inversify
need `emitDecoratorMetadata`, which the esbuild-based runners don't produce.

## Results (one run, for shape — run it yourself for your machine)

`Node v24` · linux/x64 · tinybench, 1s/task

### Cold: build + resolve

| framework | ops/sec | relative |
| --- | ---: | ---: |
| vanilla (hand-written) | 6,816,075 | 1.00× |
| **diadem (compiled)** | **1,228,703** | **0.18×** |
| typed-inject | 667,466 | 0.10× |
| tsyringe | 375,348 | 0.06× |
| diadem (manifest) | 82,535 | 0.01× |
| inversify | 23,768 | 0.003× |

### Hot: resolve

| framework | ops/sec | relative |
| --- | ---: | ---: |
| vanilla (hand-written) | 28,773,258 | 1.00× |
| typed-inject | 26,583,453 | 0.92× |
| **diadem (compiled)** | **23,501,152** | **0.82×** |
| diadem (manifest) | 22,200,080 | 0.77× |
| tsyringe | 10,383,615 | 0.36× |
| inversify | 1,874,237 | 0.07× |

## Takeaways

- On **cold construction**, diadem's compiled output is the fastest real DI
  container here: ~1.8× typed-inject, ~3.3× tsyringe, ~52× inversify. Only
  hand-written wiring is faster, which is the point — compiled mode is close to
  hand-written.
- On **hot resolve**, everything that avoids per-resolve reflection clusters near
  the vanilla ceiling. typed-inject edges diadem slightly; both are far ahead of
  the reflect-metadata containers (diadem ~2.3× tsyringe, ~12× inversify).
- diadem's **manifest** mode is slow to build (it interprets the manifest at
  runtime) but resolves as fast as compiled. Use manifest in dev/test, compiled
  in production.

## Caveats

This is a microbenchmark on one machine with one graph shape. Real apps build
their container once at startup, so cold cost is usually a one-time hit; hot
resolve differences are small in absolute terms. Treat these as *shape*, not
gospel, and run it on your own hardware.
