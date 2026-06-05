# Examples

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
