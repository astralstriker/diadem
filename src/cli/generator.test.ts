import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config'
import { generateManifest } from './generator'

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

      expect(code).toContain('export function createContainer()')
      // Dependency constructed first, then referenced directly (no lookup).
      expect(code).toContain('const _ConsoleLogger = new ConsoleLogger()')
      expect(code).toContain('const _Greeter = new Greeter(_ConsoleLogger)')
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
      expect(code).toContain('export function createServices()')
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
  })
})
