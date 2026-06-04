/**
 * Decorator-driven DI registration using class metadata instead of global state.
 * This approach is SSR-safe and avoids global state issues.
 */

import type { AbstractConstructor, ConcreteConstructor } from './types'

// Metadata keys for storing registration info on classes
const DI_TOKEN_KEY = Symbol('di:token')
const DI_LIFECYCLE_KEY = Symbol('di:lifecycle')
const DI_ENVIRONMENT_KEY = Symbol('di:environment')

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
