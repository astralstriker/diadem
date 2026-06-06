# Examples

## `shop/` — a realistic, multi-file app

A small shop backend wired with diadem: configuration, a clock, a logger, a
lazy database connection, repositories, auth, payments, messaging, analytics,
and a `ShopApp` composition root. It's the best thing to point the tools at,
because it exercises every feature:

- a `lazySingleton` (`Database`),
- a **production-only** service (`SegmentAnalytics`, `@singleton(IAnalytics, 'production')`),
- an **optional** dependency (`OrderService`'s analytics),
- and an **external** dependency (`StripeClient`, an undecorated third-party class).

Visualize its dependency graph (no build or install needed — open the HTML):

```bash
npx diadem graph --cwd examples/shop --scan-dir . --out graph.html
```

That graph has 16 services and 35 edges: `StripeClient` shows up greyed as
external, `SegmentAnalytics` appears only under the `production` env filter, and
the optional analytics edge is dashed. You can also generate its manifest:

```bash
npx diadem build --cwd examples/shop --scan-dir . --out generated/service-manifest.ts
# then run examples/shop/main.ts
```

## `basic.ts` — hand-written manifest

A complete, self-contained example that builds the manifest by hand to show the
exact `ServiceManifestModule` contract the generator produces. Run it with any
TS runner, e.g.:

```bash
npx tsx examples/basic.ts
```

## Generator workflow (a real project)

In an actual project you don't hand-write the manifest — you generate it.

1. Write decorated services anywhere under your source root:

   ```ts
   // src/services/logger.ts
   import { singleton } from '@devcraft-ts/diadem'

   export abstract class ILogger {
     abstract log(msg: string): void
   }

   @singleton(ILogger)
   export class ConsoleLogger extends ILogger {
     log(msg: string) {
       console.log(msg)
     }
   }
   ```

2. Generate the manifest (wire it into your build as a `prebuild` step):

   ```bash
   npx diadem build --strict
   # writes src/generated/service-manifest.ts
   ```

3. Register it once at startup and resolve:

   ```ts
   import { DiademContainer, configureManifest } from '@devcraft-ts/diadem'
   import * as manifest from './generated/service-manifest'

   configureManifest(manifest)

   const container = new DiademContainer()
   await container.autoRegisterDiscovered(process.env.NODE_ENV)

   const logger = container.resolve(ILogger)
   ```

See the repository README for configuration (`diadem.config.json`) and flags.
