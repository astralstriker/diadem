# diadem benchmarks

Compares `@devcraft-ts/diadem` against other TypeScript DI containers across the
metrics that actually matter: how big it bundles, how fast it cold-starts, how
much it costs to build the graph, and (least interesting) how fast it resolves.

## The graph

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

Every framework implements the **same** graph in its own idiom. Each service has
a deterministic `value()`; the root must compute `2448`, which the harness
asserts before benchmarking, so the graphs are provably equivalent.

## Running it

```bash
npm run build          # in the repo root, so the file:.. dep is fresh
cd bench && npm install

npm run report         # everything → a single bench/RESULTS.md
# or individual sections:
npm run bench          # cold build + hot resolve (tinybench)
npm run bundlesize     # esbuild bundle size, minified + gzipped
npm run coldstart      # process startup time + retained heap
npm run scaling        # build time vs graph size
```

`npm run report` writes one consolidated `bench/RESULTS.md` (gitignored; the
snapshot below is committed for convenience).

The 11-service bench compiles with **`tsc`** (not esbuild/tsx) on purpose:
tsyringe and inversify need `emitDecoratorMetadata`, which the esbuild-based
runners don't produce. Bundle size is measured on the tsc-compiled output so the
reflect-metadata frameworks' emitted type arrays are counted fairly. The scaling
graphs are esbuild-transpiled (type-checking 300-service generated files OOMs
tsc), so tsyringe — which needs decorator metadata — is omitted from that chart.

## Results

One machine (`Node v24`, linux/x64). Run it on yours — treat these as shape.

### Bundle size — *the one to care about for frontend / edge*

A minimal app (build the graph, resolve the root), bundled + minified by esbuild.

| framework | gzipped | vs smallest |
| --- | ---: | ---: |
| vanilla (hand-written) | 0.6 KB | 1.0× |
| typed-inject | 2.1 KB | 3.4× |
| **diadem (compiled)** | **6.2 KB** | 9.9× |
| tsyringe | 11.1 KB | 17.7× |
| inversify | 22.1 KB | 35.3× |

diadem is ~1.8× smaller than tsyringe and ~3.6× smaller than inversify (no
`reflect-metadata`, no decorator-metadata arrays, tree-shakeable output).
typed-inject is smaller still — it's a tiny functional injector with almost no
runtime.

### Cold start — *the one to care about for serverless*

Median of 31 fresh Node processes: import the framework, build the graph, resolve
the root. The delta subtracts a framework-free baseline (~24 ms of Node startup).

| framework | Δ startup | Δ heap |
| --- | ---: | ---: |
| vanilla (hand-written) | +0.0 ms | +0.5 MB |
| **diadem (compiled)** | **+4.0 ms** | +0.3 MB |
| typed-inject | +8.1 ms | +0.3 MB |
| tsyringe | +22.9 ms | +0.6 MB |
| inversify | +55.8 ms | +1.3 MB |

diadem compiled has the **lowest cold-start overhead of any real DI container** —
~6× lower than tsyringe, ~14× lower than inversify, and it even edges typed-inject
(whose nested injector chain costs more to build than straight-line code).

### Cold build — build the whole container, in-process

| framework | ops/sec | relative |
| --- | ---: | ---: |
| vanilla (hand-written) | 6,581,043 | 1.00× |
| **diadem (compiled)** | **1,266,679** | 0.19× |
| typed-inject | 667,106 | 0.10× |
| tsyringe | 385,865 | 0.06× |
| diadem (manifest) | 82,192 | 0.01× |
| inversify | 24,132 | 0.003× |

Among real DI containers, compiled mode is fastest to build: ~1.9× typed-inject,
~3.3× tsyringe, ~52× inversify. diadem's **manifest** mode is slow to build (it
interprets the manifest at runtime) — use manifest in dev/test, compiled in prod.

### Scaling — build time as the graph grows

Build time for the whole container at 10 → 300 services (ms, lower is better).

| framework | N=10 | N=30 | N=100 | N=300 |
| --- | ---: | ---: | ---: | ---: |
| vanilla (hand-written) | 0.0001 | 0.0002 | 0.0005 | 0.0018 |
| **diadem (compiled)** | **0.0017** | **0.0086** | **0.032** | **0.11** |
| typed-inject | 0.0035 | 0.0084 | 0.052 | 0.25 |
| inversify | 0.067 | 0.22 | 0.79 | 2.58 |

diadem stays cheap as the graph grows: at 300 services it builds in ~0.1 ms,
roughly 2.5× faster than typed-inject and ~23× faster than inversify (which is
already ~40× costlier at 10 services). tsyringe behaves like inversify here but
is omitted (it needs decorator metadata the transpile can't emit).

## Takeaways

- **Bundle size** and **cold start** are where diadem's build-time design pays
  off, and they're the metrics that actually bite in production (frontend, edge,
  serverless). diadem compiled wins cold start outright and beats the
  reflect-metadata containers on size.
- **Cold build** in-process: compiled mode is the fastest real container.
- **Scaling**: diadem's build cost grows gently with graph size; inversify (and
  reflect-metadata DI generally) climbs much faster.
- **Hot resolve** is a wash among the fast group — ignore the small differences.

## Caveats

Microbenchmarks on one machine with one graph shape. Cold build/start are
one-time costs in long-running apps; hot differences are tiny in absolute terms.
Run it on your own hardware before quoting numbers.
