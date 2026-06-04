/**
 * Diadem — minimal end-to-end example (framework-agnostic, no build step).
 *
 * In a real project the manifest is generated from your decorated classes by a
 * build command. Here we hand-write a tiny manifest module to show the exact
 * contract (`ServiceManifestModule`) the generator must satisfy, and how the
 * pieces fit together at runtime.
 */

import {
  DiademContainer,
  configureManifest,
  singleton,
  type ServiceManifestModule
} from '../src/index'

// 1. Define token (abstract class) + implementation, decorated with a lifecycle.
abstract class ILogger {
  abstract log(message: string): void
}

@singleton(ILogger)
class ConsoleLogger extends ILogger {
  log(message: string): void {
    console.log(`[log] ${message}`)
  }
}

abstract class IGreeter {
  abstract greet(name: string): string
}

@singleton(IGreeter)
class Greeter extends IGreeter {
  // `logger` is injected; the generator records this as a resolved dependency.
  constructor(private readonly logger: ILogger) {
    super()
  }

  greet(name: string): string {
    this.logger.log(`greeting ${name}`)
    return `Hello, ${name}!`
  }
}

// 2. A hand-written stand-in for the generated manifest module.
//    A real generator emits this by analysing the source above.
const manifest: ServiceManifestModule = {
  SERVICE_CLASSES: { ConsoleLogger, Greeter },
  SERVICE_MANIFEST: [
    {
      className: 'ConsoleLogger',
      importPath: 'examples/basic',
      filePath: 'examples/basic.ts',
      lifecycle: 'singleton',
      exported: true,
      registrationOrder: 0,
      dependencies: [],
      resolvedDependencies: []
    },
    {
      className: 'Greeter',
      importPath: 'examples/basic',
      filePath: 'examples/basic.ts',
      lifecycle: 'singleton',
      exported: true,
      registrationOrder: 1,
      dependencies: [
        {
          paramName: 'logger',
          paramIndex: 0,
          typeName: 'ILogger',
          isOptional: false,
          implementingService: 'ConsoleLogger'
        }
      ],
      resolvedDependencies: [
        {
          paramName: 'logger',
          paramIndex: 0,
          typeName: 'ILogger',
          isOptional: false,
          implementingService: 'ConsoleLogger'
        }
      ]
    }
  ],
  getServicesForEnvironment() {
    return this.SERVICE_MANIFEST
  },
  async importService(entry) {
    return this.SERVICE_CLASSES[entry.className]
  },
  async importAllServices(entries) {
    return entries.map((entry) => ({
      entry,
      serviceClass: this.SERVICE_CLASSES[entry.className]
    }))
  }
}

// 3. Register the manifest, build a container, resolve.
async function main(): Promise<void> {
  configureManifest(manifest)

  const container = new DiademContainer()
  await container.autoRegisterDiscovered()
  container.setReady()

  const greeter = container.resolve(IGreeter)
  console.log(greeter.greet('world'))
}

void main()
