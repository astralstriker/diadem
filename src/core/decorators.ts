/**
 * Decorator-driven DI registration using class metadata instead of global state.
 * This approach is SSR-safe and avoids global state issues.
 */

import type { AbstractConstructor, ConcreteConstructor } from './types'

// TC39 decorator metadata (used by @provider/@provides) hangs off Symbol.metadata.
// Define it for runtimes that don't ship it yet, so the transpiled metadata
// wiring has somewhere to attach. Idempotent and safe to run more than once.
;(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata')

// Metadata keys for storing registration info on classes
const DI_TOKEN_KEY = Symbol('di:token')
const DI_LIFECYCLE_KEY = Symbol('di:lifecycle')
const DI_ENVIRONMENT_KEY = Symbol('di:environment')
const DI_PROVIDER_KEY = Symbol('di:provider')
const DI_PROVIDES_KEY = Symbol('di:provides')

// Lifecycle types
export type LifecycleType = 'singleton' | 'factory' | 'lazy' | 'lazySingleton'

// Metadata interface
export interface DIMetadata {
  token: AbstractConstructor
  lifecycle: LifecycleType
  environment?: string
}

/**
 * Set DI metadata on a class constructor
 */
function setDIMetadata(
  target: ConcreteConstructor,
  token: AbstractConstructor,
  lifecycle: LifecycleType,
  environment?: string
): void {
  // Store metadata directly on the class constructor
  Object.defineProperty(target, DI_TOKEN_KEY, {
    value: token,
    enumerable: false,
    writable: false,
    configurable: false
  })

  Object.defineProperty(target, DI_LIFECYCLE_KEY, {
    value: lifecycle,
    enumerable: false,
    writable: false,
    configurable: false
  })

  if (environment) {
    Object.defineProperty(target, DI_ENVIRONMENT_KEY, {
      value: environment,
      enumerable: false,
      writable: false,
      configurable: false
    })
  }
}

/**
 * Get DI metadata from a class constructor
 */
export function getDIMetadata(target: ConcreteConstructor): DIMetadata | null {
  const store = target as unknown as Record<symbol, unknown>
  const token = store[DI_TOKEN_KEY] as AbstractConstructor | undefined
  const lifecycle = store[DI_LIFECYCLE_KEY] as LifecycleType | undefined
  const environment = store[DI_ENVIRONMENT_KEY] as string | undefined

  if (!token || !lifecycle) {
    return null
  }

  return {
    token,
    lifecycle,
    environment
  }
}

/**
 * Check if a class has DI metadata
 */
export function hasDIMetadata(target: ConcreteConstructor): boolean {
  return getDIMetadata(target) !== null
}

/**
 * Decorator to register a class as a singleton.
 * The class will be instantiated once per container and reused.
 *
 * @param token The interface/abstract class token to register the implementation against
 * @param env Optional environment filter. If provided, the class will only be registered in that environment.
 *
 * @example
 * ```typescript
 * @singleton(IMyService)
 * class MyService implements IMyService {
 *   // implementation
 * }
 *
 * @singleton(IService, 'production')
 * class ProductionOnlyService implements IService {
 *   // only registered in production environment
 * }
 * ```
 */
export function singleton<T>(token: AbstractConstructor<T>, env?: string) {
  return function <U extends ConcreteConstructor<T>>(target: U): U {
    setDIMetadata(target, token, 'singleton', env)
    return target
  }
}

/**
 * Decorator to register a class as a factory.
 * A new instance will be created each time the dependency is resolved.
 *
 * @param token The interface/abstract class token to register the implementation against
 * @param env Optional environment filter. If provided, the class will only be registered in that environment.
 *
 * @example
 * ```typescript
 * @factory(ITransientService)
 * class TransientService implements ITransientService {
 *   // new instance created on each resolve
 * }
 * ```
 */
export function factory<T>(token: AbstractConstructor<T>, env?: string) {
  return function <U extends ConcreteConstructor<T>>(target: U): U {
    setDIMetadata(target, token, 'factory', env)
    return target
  }
}

/**
 * Decorator to register a class as lazy.
 * The class will be instantiated only when first resolved, then a new instance on each subsequent resolve.
 *
 * @param token The interface/abstract class token to register the implementation against
 * @param env Optional environment filter. If provided, the class will only be registered in that environment.
 *
 * @example
 * ```typescript
 * @lazy(IExpensiveService)
 * class ExpensiveService implements IExpensiveService {
 *   // only instantiated when first needed
 * }
 * ```
 */
export function lazy<T>(token: AbstractConstructor<T>, env?: string) {
  return function <U extends ConcreteConstructor<T>>(target: U): U {
    setDIMetadata(target, token, 'lazy', env)
    return target
  }
}

/**
 * Decorator to register a class as a lazy singleton.
 * The class will be instantiated only when first resolved, then reused.
 *
 * @param token The interface/abstract class token to register the implementation against
 * @param env Optional environment filter. If provided, the class will only be registered in that environment.
 *
 * @example
 * ```typescript
 * @lazySingleton(IDatabaseConnection)
 * class DatabaseConnection implements IDatabaseConnection {
 *   // instantiated only when first needed, then reused
 * }
 * ```
 */
export function lazySingleton<T>(token: AbstractConstructor<T>, env?: string) {
  return function <U extends ConcreteConstructor<T>>(target: U): U {
    setDIMetadata(target, token, 'lazySingleton', env)
    return target
  }
}

// Manual discovery functions removed - use manifest-based auto-discovery instead

// Manual registration functions removed - use manifest-based auto-discovery instead

/**
 * Auto-discovery helper that scans for decorated classes in the current context.
 * This can be used to automatically find all decorated classes without manual imports.
 *
 * @param modules Array of module objects to scan
 * @returns Combined array of all decorated classes found
 // Auto-discovery from modules removed - use manifest-based auto-discovery instead

/**
 * Get registration statistics for debugging
 */
export function getDIRegistrationStats(classes: ConcreteConstructor[]): {
  total: number
  singletons: number
  factories: number
  lazy: number
  lazySingletons: number
  environments: string[]
} {
  const stats = {
    total: 0,
    singletons: 0,
    factories: 0,
    lazy: 0,
    lazySingletons: 0,
    environments: new Set<string>()
  }

  for (const ClassConstructor of classes) {
    const metadata = getDIMetadata(ClassConstructor)
    if (!metadata) continue

    stats.total++

    switch (metadata.lifecycle) {
      case 'singleton':
        stats.singletons++
        break
      case 'factory':
        stats.factories++
        break
      case 'lazy':
        stats.lazy++
        break
      case 'lazySingleton':
        stats.lazySingletons++
        break
    }

    if (metadata.environment) {
      stats.environments.add(metadata.environment)
    }
  }

  return {
    ...stats,
    environments: Array.from(stats.environments)
  }
}

/**
 * A single `@provides`-decorated method on a provider class.
 */
export interface ProvidesEntry {
  method: string
  token: AbstractConstructor
  environment?: string
}

/**
 * Marks a class as a *provider*: its `@provides`-decorated methods bind tokens to
 * the values/factories they return. Use for things the container can't construct
 * directly — config values, third-party clients, computed instances.
 *
 * @example
 * ```typescript
 * @provider()
 * class CoreProviders {
 *   @provides(IConfig) config(): IConfig { return loadConfig() }
 *   @provides(IStripe) stripe(config: IConfig): IStripe {
 *     return new StripeClient(config.get('KEY'))
 *   }
 * }
 * ```
 */
/** True for a TC39 (Stage 3) decorator context object. */
function isDecoratorContext(value: unknown): value is { metadata: object } {
  return typeof value === 'object' && value !== null && 'metadata' in value
}

/**
 * Marks a class as a *provider*. Works under both TC39 (Stage 3) and legacy
 * (`experimentalDecorators`) — diadem reads providers from source at build time,
 * so the runtime form just needs to record the marker without throwing.
 */
export function provider() {
  return function <U extends ConcreteConstructor>(target: U, context?: unknown): U {
    if (isDecoratorContext(context)) {
      // TC39: hang metadata off the shared context object (→ Symbol.metadata).
      ;(context.metadata as Record<symbol, unknown>)[DI_PROVIDER_KEY] = true
    } else {
      // Legacy: store directly on the constructor.
      Object.defineProperty(target, DI_PROVIDER_KEY, {
        value: true,
        enumerable: false,
        writable: false,
        configurable: true
      })
    }
    return target
  }
}

/**
 * Marks a provider method as binding `token` to whatever it returns. The method's
 * parameters are injected like constructor dependencies. Optional `env` restricts
 * the binding to one environment. Works under both decorator modes.
 */
export function provides<T>(token: AbstractConstructor<T>, env?: string) {
  return function (target: unknown, context: unknown): void {
    if (isDecoratorContext(context)) {
      // TC39: context is { kind, name, metadata, ... }.
      const md = context.metadata as Record<symbol, ProvidesEntry[]>
      const entries = (md[DI_PROVIDES_KEY] ??= [])
      const name = (context as unknown as { name: string | symbol }).name
      entries.push({ method: String(name), token, environment: env })
      return
    }
    // Legacy: (prototype, propertyKey, descriptor) — accumulate on the ctor.
    const ctor = (target as { constructor: ConcreteConstructor }).constructor
    const store = ctor as unknown as Record<symbol, ProvidesEntry[]>
    const existing = store[DI_PROVIDES_KEY] ?? []
    Object.defineProperty(ctor, DI_PROVIDES_KEY, {
      value: [...existing, { method: String(context), token, environment: env }],
      enumerable: false,
      writable: true,
      configurable: true
    })
  }
}

/**
 * Get the `@provides` bindings declared on a provider class, or null if the class
 * isn't a `@provider`. Reads metadata stored by either decorator mode.
 */
export function getProviderMetadata(
  target: ConcreteConstructor
): ProvidesEntry[] | null {
  // TC39 metadata lives on Symbol.metadata; legacy metadata on the ctor itself.
  const tc39 = (target as { [Symbol.metadata]?: Record<symbol, unknown> })[
    Symbol.metadata
  ]
  const direct = target as unknown as Record<symbol, unknown>
  const isProvider = Boolean(tc39?.[DI_PROVIDER_KEY] ?? direct[DI_PROVIDER_KEY])
  if (!isProvider) {
    return null
  }
  return ((tc39?.[DI_PROVIDES_KEY] ?? direct[DI_PROVIDES_KEY]) as
    | ProvidesEntry[]
    | undefined) ?? []
}

/**
 * Check if a class is registered for a specific environment.
 */
export function isClassRegisteredForEnvironment(
  ClassConstructor: ConcreteConstructor,
  environment?: string
): boolean {
  const metadata = getDIMetadata(ClassConstructor)
  if (!metadata) return false

  // If no environment specified, class is available everywhere
  if (!metadata.environment) return true

  // If environment specified, it must match
  return metadata.environment === environment
}
