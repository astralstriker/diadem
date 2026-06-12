import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config'
import { checkManifest, generateGraph, generateManifest } from './generator'

let root: string

function write(rel: string, content: string): void {
  const path = join(root, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'diadem-gen-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('manifest generator', () => {
  it('discovers services, resolves tokens, and orders them topologically', () => {
    write(
      'src/logger.ts',
      `import { singleton } from 'diadem'
       export abstract class ILogger { abstract log(m: string): void }
       @singleton(ILogger)
       export class ConsoleLogger extends ILogger { log(m: string) {} }`
    )
    write(
      'src/greeter.ts',
      `import { singleton } from 'diadem'
       import { ILogger } from './logger'
       export abstract class IGreeter { abstract greet(): string }
       @singleton(IGreeter, 'production')
       export class Greeter extends IGreeter {
         constructor(private readonly logger: ILogger) { super() }
         greet() { return 'hi' }
       }`
    )

    const config = loadConfig(root)
    const result = generateManifest(config)

    expect(result.serviceCount).toBe(2)
    expect(result.cycles).toHaveLength(0)
    expect(result.externalDependencies).toBe(0)

    const manifest = readFileSync(result.outFile, 'utf8')
    // Greeter's dependency resolved to the ILogger implementation.
    expect(manifest).toContain('"implementingService": "ConsoleLogger"')
    // Topological order: ConsoleLogger (0) before Greeter (1).
    const loggerOrder = manifest.indexOf('"className": "ConsoleLogger"')
    const greeterOrder = manifest.indexOf('"className": "Greeter"')
    expect(loggerOrder).toBeLessThan(greeterOrder)
    // Import paths are relative to the generated file, not aliased.
    expect(manifest).toContain("from '../logger'")
    // Environment captured.
    expect(manifest).toContain('"environment": "production"')
  })

  it('marks unresolved dependencies as external', () => {
    write(
      'src/service.ts',
      `import { singleton } from 'diadem'
       export abstract class IService { abstract run(): void }
       @singleton(IService)
       export class Service extends IService {
         constructor(private readonly missing: ISomethingExternal) { super() }
         run() {}
       }`
    )

    const result = generateManifest(loadConfig(root))
    expect(result.serviceCount).toBe(1)
    expect(result.externalDependencies).toBe(1)
    expect(readFileSync(result.outFile, 'utf8')).toContain('"external": true')
    // A required external dependency is reported as unresolved (for --strict).
    expect(result.unresolved).toEqual([
      { service: 'Service', paramName: 'missing', typeName: 'ISomethingExternal' }
    ])
  })

  it('does not report optional missing dependencies as unresolved', () => {
    write(
      'src/service.ts',
      `import { singleton } from 'diadem'
       export abstract class IService { abstract run(): void }
       @singleton(IService)
       export class Service extends IService {
         constructor(private readonly missing?: ISomethingExternal) { super() }
         run() {}
       }`
    )
    const result = generateManifest(loadConfig(root))
    expect(result.unresolved).toHaveLength(0)
  })

  it('flags a non-scoped service injecting a scoped one as captive', () => {
    write(
      'src/captive.ts',
      `import { singleton, scoped } from 'diadem'
       export abstract class ICtx { abstract id(): string }
       @scoped(ICtx)
       export class Ctx extends ICtx { id() { return 'x' } }
       export abstract class ICache { abstract get(): string }
       @singleton(ICache)
       export class Cache extends ICache {
         constructor(private readonly ctx: ICtx) { super() }
         get() { return this.ctx.id() }
       }`
    )
    const result = generateManifest(loadConfig(root))
    expect(result.captiveDependencies).toEqual([
      {
        service: 'Cache',
        serviceLifecycle: 'singleton',
        paramName: 'ctx',
        dependency: 'ICtx'
      }
    ])
  })

  it('does not flag scoped services injecting scoped services', () => {
    write(
      'src/scoped-chain.ts',
      `import { scoped } from 'diadem'
       export abstract class ICtx { abstract id(): string }
       @scoped(ICtx)
       export class Ctx extends ICtx { id() { return 'x' } }
       export abstract class IAudit { abstract log(): void }
       @scoped(IAudit)
       export class Audit extends IAudit {
         constructor(private readonly ctx: ICtx) { super() }
         log() {}
       }`
    )
    const result = generateManifest(loadConfig(root))
    expect(result.captiveDependencies).toHaveLength(0)
  })

  it('flags a multi-bound token injected as a single parameter', () => {
    write(
      'src/multi-inject.ts',
      `import { singleton } from 'diadem'
       export abstract class IPlugin { abstract run(): void }
       @singleton(IPlugin, { multi: true })
       export class A extends IPlugin { run() {} }
       @singleton(IPlugin, { multi: true })
       export class B extends IPlugin { run() {} }
       export abstract class IHost { abstract go(): void }
       @singleton(IHost)
       export class Host extends IHost {
         constructor(private readonly plugin: IPlugin) { super() }
         go() {}
       }`
    )
    const result = generateManifest(loadConfig(root))
    expect(result.multiInjections).toEqual([
      { service: 'Host', paramName: 'plugin', token: 'IPlugin' }
    ])
  })

  it('resolves env-split tokens to the target-env impl without an ambiguity warning', () => {
    write(
      'src/metrics.ts',
      `import { singleton } from 'diadem'
       export abstract class IMetrics { abstract inc(): void }
       @singleton(IMetrics, 'development')
       export class DevMetrics extends IMetrics { inc() {} }
       @singleton(IMetrics, 'production')
       export class ProdMetrics extends IMetrics { inc() {} }
       export abstract class IApp { abstract go(): void }
       @singleton(IApp)
       export class App extends IApp {
         constructor(private readonly metrics: IMetrics) { super() }
         go() {}
       }`
    )
    const result = generateManifest(
      loadConfig(root, {
        emit: 'compiled',
        outFile: 'src/generated/c.ts',
        targetEnv: 'production'
      })
    )
    // One impl per environment is the supported pattern, not a collision...
    expect(result.duplicateTokens).toHaveLength(0)
    // ...and dependents are wired to the impl that survives the env filter,
    // not silently to nothing because the first-seen impl was filtered out.
    const code = readFileSync(result.outFile, 'utf8')
    expect(code).toContain('new App(_ProdMetrics)')
    expect(code).not.toContain('new App()')
  })

  it('flags ambiguous (duplicate) tokens', () => {
    write(
      'src/a.ts',
      `import { singleton } from 'diadem'
       export abstract class IThing { abstract t(): void }
       @singleton(IThing)
       export class ThingA extends IThing { t() {} }`
    )
    write(
      'src/b.ts',
      `import { singleton } from 'diadem'
       import { IThing } from './a'
       @singleton(IThing)
       export class ThingB extends IThing { t() {} }`
    )
    const result = generateManifest(loadConfig(root))
    expect(result.duplicateTokens).toContain('IThing')
  })

  it('captures request-scoped services in the manifest', () => {
    write(
      'src/request.ts',
      `import { scoped } from 'diadem'
       export abstract class IRequestContext { abstract id(): string }
       @scoped(IRequestContext, 'request', 'production')
       export class RequestContext extends IRequestContext { id() { return 'r1' } }`
    )

    const result = generateManifest(loadConfig(root))
    const manifest = readFileSync(result.outFile, 'utf8')

    expect(result.serviceCount).toBe(1)
    expect(manifest).toContain('"lifecycle": "scoped"')
    expect(manifest).toContain('"environment": "production"')
  })

  it('captures multi-binding services in the manifest without duplicate warnings', () => {
    write(
      'src/plugins.ts',
      `import { singleton } from 'diadem'
       export abstract class IPlugin { abstract run(): string }
       @singleton(IPlugin, { multi: true })
       export class AlphaPlugin extends IPlugin { run() { return 'a' } }
       @singleton(IPlugin, { multi: true })
       export class BetaPlugin extends IPlugin { run() { return 'b' } }`
    )

    const result = generateManifest(loadConfig(root))
    const manifest = readFileSync(result.outFile, 'utf8')

    expect(result.serviceCount).toBe(2)
    expect(result.duplicateTokens).toHaveLength(0)
    expect(manifest).toContain('"multi": true')
  })

  it('detects dependency cycles', () => {
    write(
      'src/a.ts',
      `import { singleton } from 'diadem'
       import { IB } from './b'
       export abstract class IA { abstract a(): void }
       @singleton(IA)
       export class A extends IA { constructor(private b: IB) { super() } a() {} }`
    )
    write(
      'src/b.ts',
      `import { singleton } from 'diadem'
       import { IA } from './a'
       export abstract class IB { abstract b(): void }
       @singleton(IB)
       export class B extends IB { constructor(private a: IA) { super() } b() {} }`
    )

    const result = generateManifest(loadConfig(root))
    expect(result.serviceCount).toBe(2)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it('ignores classes without DI decorators', () => {
    write('src/plain.ts', `export class Plain { foo() {} }`)
    const result = generateManifest(loadConfig(root))
    expect(result.serviceCount).toBe(0)
  })

  describe('compiled emit', () => {
    function writeGraph(): void {
      write(
        'src/logger.ts',
        `import { singleton } from 'diadem'
         export abstract class ILogger { abstract log(m: string): void }
         @singleton(ILogger)
         export class ConsoleLogger extends ILogger { log(m: string) {} }`
      )
      write(
        'src/greeter.ts',
        `import { singleton } from 'diadem'
         import { ILogger } from './logger'
         export abstract class IGreeter { abstract greet(): string }
         @singleton(IGreeter, 'production')
         export class Greeter extends IGreeter {
           constructor(private readonly logger: ILogger) { super() }
           greet() { return 'hi' }
         }`
      )
    }

    it('emits straight-line wiring with direct local references', () => {
      writeGraph()
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/container.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      expect(code).toContain('export function createContainer(')
      // Dependency constructed first, then referenced directly (no lookup).
      expect(code).toContain('new ConsoleLogger()')
      expect(code).toContain('new Greeter(_ConsoleLogger)')
      expect(code).toContain('c.register(token(Greeter), _Greeter)')
      // No interpreted manifest data.
      expect(code).not.toContain('SERVICE_MANIFEST')
      // Topological order preserved.
      expect(code.indexOf('new ConsoleLogger()')).toBeLessThan(
        code.indexOf('new Greeter(')
      )
    })

    it('bakes in a single environment with --target-env', () => {
      writeGraph()
      const result = generateManifest(
        loadConfig(root, {
          emit: 'compiled',
          targetEnv: 'development',
          outFile: 'src/generated/container.ts'
        })
      )
      const code = readFileSync(result.outFile, 'utf8')
      // Greeter is production-only, so it's excluded from a development build.
      expect(code).toContain('new ConsoleLogger()')
      expect(code).not.toContain('new Greeter(')
    })

    it('emits a type-safe accessor surface (createServices)', () => {
      writeGraph()
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/container.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      expect(code).toContain('export interface DiademServices')
      expect(code).toContain('ILogger: ILogger')
      expect(code).toContain('IGreeter: IGreeter')
      expect(code).toContain('export function createServices(')
      expect(code).toContain('return container.resolve(IGreeter)')
      // Token classes are imported so they can be both type and resolution key.
      expect(code).toMatch(
        /import \{[\s\S]*ConsoleLogger[\s\S]*ILogger[\s\S]*\} from '\.\.\/logger'/
      )
    })

    it('excludes ambiguous tokens from the typed surface but still wires them', () => {
      write(
        'src/a.ts',
        `import { singleton } from 'diadem'
         export abstract class IThing { abstract t(): void }
         @singleton(IThing)
         export class ThingA extends IThing { t() {} }`
      )
      write(
        'src/b.ts',
        `import { singleton } from 'diadem'
         import { IThing } from './a'
         @singleton(IThing)
         export class ThingB extends IThing { t() {} }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/container.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      // Both are constructed/registered...
      expect(code).toContain('new ThingA()')
      expect(code).toContain('new ThingB()')
      // ...but the ambiguous token is not exposed in the typed surface.
      expect(code).not.toContain('IThing: IThing')
    })

    it('fails fast on a required external instead of passing undefined', () => {
      write(
        'src/svc.ts',
        `import { singleton } from 'diadem'
         export abstract class IService { abstract run(): void }
         @singleton(IService)
         export class Service extends IService {
           constructor(private client: StripeSdk) { super() }
           run() {}
         }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')
      // Required, non-primitive external → a throwing helper, not silent undefined.
      expect(code).toContain('requireExternal("Service", "client", "StripeSdk")')
      expect(code).toContain('function requireExternal')
      expect(code).not.toContain('new Service(undefined)')
    })

    it('omits a trailing optional external (no undefined arg, no throw)', () => {
      write(
        'src/svc.ts',
        `import { singleton } from 'diadem'
         export abstract class IService { abstract run(): void }
         @singleton(IService)
         export class Service extends IService {
           constructor(private client?: StripeSdk) { super() }
           run() {}
         }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')
      expect(code).toContain('new Service()')
      expect(code).not.toContain('new Service(undefined)')
      expect(code).not.toContain('requireExternal')
    })

    it('exposes an Overrides surface for externals and service mocking', () => {
      write('src/sdk.ts', `export class PaymentSdk { charge() { return 'ok' } }`)
      write(
        'src/svc.ts',
        `import { singleton } from 'diadem'
         import { PaymentSdk } from './sdk'
         export abstract class ILogger { abstract log(): void }
         @singleton(ILogger) export class Logger extends ILogger { log() {} }
         export abstract class IGateway { abstract pay(): void }
         @singleton(IGateway)
         export class Gateway extends IGateway {
           constructor(private log: ILogger, private sdk: PaymentSdk) { super() }
           pay() {}
         }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      // The importable external becomes a provide-able, typed override.
      expect(code).toContain('export interface Overrides')
      expect(code).toContain('PaymentSdk?: PaymentSdk')
      expect(code).toMatch(/import type \{ PaymentSdk \} from '\.\.\/sdk'/)
      expect(code).toContain('overrides.PaymentSdk ?? requireExternal')
      // Services are mockable by token.
      expect(code).toContain('ILogger?: ILogger')
      expect(code).toContain('overrides.ILogger ?? new Logger()')
      // Threaded through both entry points.
      expect(code).toContain('createContainer(overrides: Overrides = {})')
      expect(code).toContain('createServices(overrides: Overrides = {})')
    })

    it('types onInit against the implementation when the service is overridable', () => {
      write(
        'src/db.ts',
        `import { asyncSingleton } from 'diadem'
         export abstract class IDatabase { abstract ping(): Promise<boolean> }
         @asyncSingleton(IDatabase)
         export class Database extends IDatabase {
           async onInit() {}
           async ping() { return true }
         }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')
      // The override branch never calls onInit; the constructed branch calls it
      // on a local typed as the impl class — the token type (IDatabase) does
      // not declare onInit, so calling it on the ?? union would not typecheck.
      expect(code).toContain('let _Database: IDatabase')
      expect(code).toContain('_Database = overrides.IDatabase')
      expect(code).toContain('const instance = new Database()')
      expect(code).toContain('await instance.onInit()')
      expect(code).not.toContain('_Database.onInit()')
    })

    it('emits request-scoped services as scope-local factories', () => {
      write(
        'src/request.ts',
        `import { scoped } from 'diadem'
         export abstract class IRequestContext { abstract id(): string }
         @scoped(IRequestContext)
         export class RequestContext extends IRequestContext { id() { return 'r1' } }`
      )
      write(
        'src/handler.ts',
        `import { scoped } from 'diadem'
         import { IRequestContext } from './request'
         export abstract class IRequestHandler { abstract ctx(): IRequestContext }
         @scoped(IRequestHandler)
         export class RequestHandler extends IRequestHandler {
           constructor(private request: IRequestContext) { super() }
           ctx() { return this.request }
         }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      expect(code).toContain(
        'c.registerScoped(token(RequestContext), (scope) => new RequestContext())'
      )
      expect(code).toContain(
        'c.registerScoped(token(RequestHandler), (scope) => new RequestHandler(scope.resolve(token(RequestContext))))'
      )
      expect(code).not.toContain('const _RequestContext = new RequestContext()')
    })

    it('emits lazy singletons as deferred cached factories', () => {
      write(
        'src/database.ts',
        `import { lazySingleton } from 'diadem'
         export abstract class IDatabase { abstract query(): string }
         @lazySingleton(IDatabase)
         export class Database extends IDatabase { query() { return 'ok' } }`
      )
      write(
        'src/repo.ts',
        `import { singleton } from 'diadem'
         import { IDatabase } from './database'
         export abstract class IRepository { abstract get(): string }
         @singleton(IRepository)
         export class Repository extends IRepository {
           constructor(private db: IDatabase) { super() }
           get() { return this.db.query() }
         }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      expect(code).toContain('let _Database: Database | undefined')
      expect(code).toContain('c.registerFactory(token(Database), () => {')
      expect(code).toContain('_Database ??= new Database()')
      expect(code).toContain('new Repository(c.resolve(token(Database)))')
      expect(code).not.toContain('const _Database = new Database()')
    })

    it('emits multi-bindings with registerMulti and excludes them from single accessors', () => {
      write(
        'src/plugins.ts',
        `import { singleton } from 'diadem'
         export abstract class IPlugin { abstract run(): string }
         @singleton(IPlugin, { multi: true })
         export class AlphaPlugin extends IPlugin { run() { return 'a' } }
         @singleton(IPlugin, { multi: true })
         export class BetaPlugin extends IPlugin { run() { return 'b' } }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      expect(code).toContain('c.registerMulti(token(AlphaPlugin), _AlphaPlugin)')
      expect(code).toContain('c.registerMulti(token(BetaPlugin), _BetaPlugin)')
      expect(code).not.toContain('IPlugin: IPlugin')
      expect(result.duplicateTokens).toHaveLength(0)
    })
  })

  describe('providers (@provides bindings)', () => {
    function writeProviders(): void {
      write(
        'src/config.ts',
        `import { singleton } from 'diadem'
         export abstract class IConfig { abstract get(k: string): string }
         @singleton(IConfig)
         export class Config extends IConfig { get(k: string) { return '' } }`
      )
      write('src/sdk.ts', `export class StripeSdk {
        constructor(private key: string) {}
        charge() { return 'ok' }
      }`)
      write(
        'src/providers.ts',
        `import { provider, provides } from 'diadem'
         import { IConfig } from './config'
         import { StripeSdk } from './sdk'
         @provider()
         export class Integrations {
           @provides(StripeSdk)
           stripe(config: IConfig): StripeSdk { return new StripeSdk(config.get('KEY')) }
         }`
      )
    }

    it('wires a provider method as a factory call registered under its token', () => {
      writeProviders()
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      expect(result.providerCount).toBe(1)
      // Provider class instantiated once, method called with injected deps.
      expect(code).toContain('const _provider_Integrations = new Integrations()')
      expect(code).toContain('_provider_Integrations.stripe(_Config)')
      // Registered under the token directly, not a synthetic class id.
      expect(code).toContain('c.register(StripeSdk, _Integrations_stripe)')
      // Provider class + token are imported as values.
      expect(code).toMatch(/import \{ Integrations \} from '\.\.\/providers'/)
    })

    it('lets a service depend on a provider-bound token', () => {
      writeProviders()
      write(
        'src/gateway.ts',
        `import { singleton } from 'diadem'
         import { StripeSdk } from './sdk'
         export abstract class IGateway { abstract pay(): void }
         @singleton(IGateway)
         export class Gateway extends IGateway {
           constructor(private sdk: StripeSdk) { super() }
           pay() {}
         }`
      )
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      // The provided StripeSdk is injected — no requireExternal, no undefined.
      expect(code).toContain('new Gateway(_Integrations_stripe)')
      expect(code).not.toContain('requireExternal')
      // Provider binding is emitted before the service that consumes it.
      expect(code.indexOf('_Integrations_stripe =')).toBeLessThan(
        code.indexOf('new Gateway(')
      )
    })

    it('exposes provider tokens in the typed accessor surface', () => {
      writeProviders()
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')
      expect(code).toContain('StripeSdk: StripeSdk')
      expect(code).toContain('return container.resolve(StripeSdk)')
    })

    it('makes a provider binding overridable', () => {
      writeProviders()
      const result = generateManifest(
        loadConfig(root, { emit: 'compiled', outFile: 'src/generated/c.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')
      expect(code).toContain('StripeSdk?: StripeSdk')
      expect(code).toContain('overrides.StripeSdk ?? _provider_Integrations.stripe')
    })

    it('skips provider bindings in manifest emit and reports a count', () => {
      writeProviders()
      const result = generateManifest(
        loadConfig(root, { outFile: 'src/generated/manifest.ts' })
      )
      const code = readFileSync(result.outFile, 'utf8')

      expect(result.providerCount).toBe(1)
      // Synthetic provider entries never reach the runtime manifest.
      expect(code).not.toContain('Integrations#stripe')
      expect(code).not.toContain('_provider_')
    })
  })

  describe('heuristic resolution', () => {
    it('does not report token-declared resolutions as heuristic', () => {
      write(
        'src/logger.ts',
        `import { singleton } from 'diadem'
         export abstract class ILogger { abstract log(m: string): void }
         @singleton(ILogger)
         export class ConsoleLogger extends ILogger { log(m: string) {} }`
      )
      write(
        'src/app.ts',
        `import { singleton } from 'diadem'
         import { ILogger } from './logger'
         export abstract class IApp { abstract go(): void }
         @singleton(IApp)
         export class App extends IApp {
           constructor(private readonly logger: ILogger) { super() }
           go() {}
         }`
      )
      const result = generateManifest(loadConfig(root))
      expect(result.heuristicResolutions).toHaveLength(0)
      expect(result.heuristicAmbiguities).toHaveLength(0)
    })

    it('reports an I-prefix exact match as a heuristic resolution', () => {
      write(
        'src/logger.ts',
        `import { singleton } from 'diadem'
         @singleton()
         export class Logger { log(m: string) {} }`
      )
      write(
        'src/app.ts',
        `import { singleton } from 'diadem'
         export abstract class IApp { abstract go(): void }
         @singleton(IApp)
         export class App extends IApp {
           constructor(private readonly logger: ILogger) { super() }
           go() {}
         }`
      )
      const result = generateManifest(loadConfig(root))
      expect(result.heuristicResolutions).toEqual([
        {
          service: 'App',
          paramName: 'logger',
          typeName: 'ILogger',
          implementingService: 'Logger'
        }
      ])
      // Still wired (a warning, not a behavior change), and marked in the manifest.
      const manifest = readFileSync(result.outFile, 'utf8')
      expect(manifest).toContain('"implementingService": "Logger"')
      expect(manifest).toContain('"heuristic": true')
    })

    it('reports a unique suffix match as a heuristic resolution', () => {
      write(
        'src/payments.ts',
        `import { singleton } from 'diadem'
         @singleton()
         export class PaymentService { charge() {} }`
      )
      write(
        'src/checkout.ts',
        `import { singleton } from 'diadem'
         export abstract class ICheckout { abstract go(): void }
         @singleton(ICheckout)
         export class Checkout extends ICheckout {
           constructor(private readonly payments: IPayment) { super() }
           go() {}
         }`
      )
      const result = generateManifest(loadConfig(root))
      expect(result.heuristicResolutions).toEqual([
        {
          service: 'Checkout',
          paramName: 'payments',
          typeName: 'IPayment',
          implementingService: 'PaymentService'
        }
      ])
    })

    it('leaves ambiguous heuristic matches unwired and reports the candidates', () => {
      write(
        'src/loans.ts',
        `import { singleton } from 'diadem'
         @singleton()
         export class LoanService { a() {} }
         @singleton()
         export class LoanRepository { b() {} }`
      )
      write(
        'src/app.ts',
        `import { singleton } from 'diadem'
         export abstract class IApp { abstract go(): void }
         @singleton(IApp)
         export class App extends IApp {
           constructor(private readonly loan: ILoan) { super() }
           go() {}
         }`
      )
      const result = generateManifest(loadConfig(root))
      expect(result.heuristicAmbiguities).toEqual([
        {
          service: 'App',
          paramName: 'loan',
          typeName: 'ILoan',
          candidates: ['LoanRepository', 'LoanService']
        }
      ])
      // Never silently wired to whichever candidate the scan found first...
      const manifest = readFileSync(result.outFile, 'utf8')
      expect(manifest).not.toContain('"implementingService": "LoanService"')
      expect(manifest).not.toContain('"implementingService": "LoanRepository"')
      // ...and reported via the pointed ambiguity diagnostic, not as plain unresolved.
      expect(result.unresolved).toHaveLength(0)
      expect(result.externalDependencies).toBe(1)
    })
  })

  describe('check mode', () => {
    function writeService(body = 'log(m: string) {}'): void {
      write(
        'src/logger.ts',
        `import { singleton } from 'diadem'
         export abstract class ILogger { abstract log(m: string): void }
         @singleton(ILogger)
         export class ConsoleLogger extends ILogger { ${body} }`
      )
    }

    it('reports up to date when the committed manifest matches the source', () => {
      writeService()
      const config = loadConfig(root)
      generateManifest(config)

      const check = checkManifest(config)
      expect(check.upToDate).toBe(true)
      expect(check.missing).toBe(false)
      expect(check.serviceCount).toBe(1)
    })

    it('reports stale when the source changed after generation, without writing', () => {
      writeService()
      const config = loadConfig(root)
      const { outFile } = generateManifest(config)
      const committed = readFileSync(outFile, 'utf8')

      write(
        'src/extra.ts',
        `import { singleton } from 'diadem'
         export abstract class IExtra { abstract e(): void }
         @singleton(IExtra)
         export class Extra extends IExtra { e() {} }`
      )

      const check = checkManifest(config)
      expect(check.upToDate).toBe(false)
      expect(check.missing).toBe(false)
      // check never mutates the committed file.
      expect(readFileSync(outFile, 'utf8')).toBe(committed)
    })

    it('reports missing when no manifest has been generated', () => {
      writeService()
      const check = checkManifest(loadConfig(root))
      expect(check.upToDate).toBe(false)
      expect(check.missing).toBe(true)
    })

    it('checks compiled emit output too', () => {
      writeService()
      const config = loadConfig(root, {
        emit: 'compiled',
        outFile: 'src/generated/container.ts'
      })
      generateManifest(config)
      expect(checkManifest(config).upToDate).toBe(true)

      writeService('log(m: string) { console.log(m) }')
      // Compiled wiring is structural — a body-only change keeps it identical.
      expect(checkManifest(config).upToDate).toBe(true)
    })
  })

  describe('graph visualizer', () => {
    it('writes an interactive HTML graph with nodes, edges, and externals', () => {
      write(
        'src/logger.ts',
        `import { singleton } from 'diadem'
         export abstract class ILogger { abstract log(m: string): void }
         @singleton(ILogger) export class ConsoleLogger extends ILogger { log(m: string) {} }`
      )
      write(
        'src/greeter.ts',
        `import { singleton } from 'diadem'
         import { ILogger } from './logger'
         export abstract class IGreeter { abstract greet(): string }
         @singleton(IGreeter) export class Greeter extends IGreeter {
           constructor(private l: ILogger, private cfg: IExternalConfig) { super() }
           greet() { return 'hi' }
         }`
      )
      const result = generateGraph(loadConfig(root), 'graph.html')
      expect(result.serviceCount).toBe(2)
      expect(result.edgeCount).toBe(2) // Greeter→ILogger, Greeter→external
      expect(result.externalCount).toBe(1)

      const html = readFileSync(result.outFile, 'utf8')
      expect(html).toContain('<!doctype html>')
      expect(html).toContain('cytoscape')
      expect(html).toContain('"ConsoleLogger"')
      expect(html).toContain('"ext:IExternalConfig"')
      // edge from Greeter to its ILogger implementation
      expect(html).toContain('"source":"Greeter","target":"ConsoleLogger"')
    })

    it('marks cycle members in the graph data', () => {
      write(
        'src/a.ts',
        `import { singleton } from 'diadem'
         import { IB } from './b'
         export abstract class IA { abstract a(): void }
         @singleton(IA) export class A extends IA { constructor(private b: IB) { super() } a() {} }`
      )
      write(
        'src/b.ts',
        `import { singleton } from 'diadem'
         import { IA } from './a'
         export abstract class IB { abstract b(): void }
         @singleton(IB) export class B extends IB { constructor(private a: IA) { super() } b() {} }`
      )
      const result = generateGraph(loadConfig(root), 'graph.html')
      expect(result.cycles.length).toBeGreaterThan(0)
      // at least one node flagged cycle:1 in the embedded data
      expect(readFileSync(result.outFile, 'utf8')).toContain('"cycle":1')
    })
  })
})
