/**
 * Core DI System - Core Module Exports
 *
 * This module exports the fundamental building blocks of the dependency injection system:
 * - Container implementation
 * - Decorators for service registration
 * - Type definitions
 *
 * @example
 * ```typescript
 * import { DiademContainer, singleton, factory } from 'app/infrastructure/di/core'
 * ```
 */

// Import for local usage
import type { Constructor, DIContainer } from './container'
import { DiademContainer } from './container'
import { factory, lazy, lazySingleton, singleton } from './decorators'

// Container and types
export {
  DiademContainer,
  type Constructor,
  type DIContainer,
  type Disposable,
  type LifecycleType,
  type Token
} from './container'

// Decorators for auto-registration
export {
  factory,
  getDIMetadata,
  getDIRegistrationStats,
  getProviderMetadata,
  hasDIMetadata,
  isClassRegisteredForEnvironment,
  lazy,
  lazySingleton,
  provider,
  provides,
  singleton,
  type LifecycleType as DecoratorLifecycleType,
  type DIMetadata,
  type ProvidesEntry
} from './decorators'

// Type definitions
export type { AbstractConstructor } from './types'

// Pluggable logging (silent by default)
export { consoleLogger, getLogger, noopLogger, setLogger } from './logger'
export type { Logger } from './logger'

// Service manifest contract + injection seam
export {
  configureManifest,
  getManifest,
  hasManifest,
  resetManifest
} from './manifest'
export type {
  ImportedService,
  ServiceDependency,
  ServiceManifestEntry,
  ServiceManifestModule
} from './manifest'

/**
 * Common decorator combinations for convenience
 */
export const decorators = {
  singleton,
  factory,
  lazy,
  lazySingleton
} as const

/**
 * Type helpers for better developer experience
 */

// Helper type to extract the implementation type from a constructor token
export type ResolvedType<T> = T extends Constructor<infer U> ? U : never

// Helper type for multiple dependency resolution
export type ResolvedTypes<T extends ReadonlyArray<Constructor<unknown>>> = {
  [K in keyof T]: T[K] extends Constructor<infer U> ? U : never
}

// Helper type for service factory functions
export type ServiceFactory<T> = () => T

// Helper type for environment-aware service registration
export interface EnvironmentConfig {
  environment?: string
  modules: Array<Record<string, unknown>>
}

/**
 * Utility functions for advanced usage
 */

/** Fluent builder returned by {@link createContainerBuilder}. */
export interface ContainerBuilder {
  register: <T>(token: Constructor<T>, implementation: T) => ContainerBuilder
  registerSingleton: <T>(
    token: Constructor<T>,
    factory: ServiceFactory<T>
  ) => ContainerBuilder
  registerFactory: <T>(
    token: Constructor<T>,
    factory: ServiceFactory<T>
  ) => ContainerBuilder
  build: () => DiademContainer
}

// Create a type-safe container builder
export function createContainerBuilder(): ContainerBuilder {
  const container = new DiademContainer()

  const builder: ContainerBuilder = {
    register: <T>(token: Constructor<T>, implementation: T) => {
      container.register(token, implementation)
      return builder
    },
    registerSingleton: <T>(
      token: Constructor<T>,
      factory: ServiceFactory<T>
    ) => {
      container.registerSingleton(token, factory)
      return builder
    },
    registerFactory: <T>(token: Constructor<T>, factory: ServiceFactory<T>) => {
      container.registerFactory(token, factory)
      return builder
    },

    build: () => container
  }

  return builder
}

// Create a mock container for testing
export function createMockContainer(
  mocks = new Map<Constructor<unknown>, unknown>()
): DiademContainer {
  const container = new DiademContainer()

  // Register all mocks
  mocks.forEach((implementation, token) => {
    container.register(token, implementation)
  })

  container.setReady()
  return container
}

/**
 * Type guards for runtime type checking
 */
export function isDIContainer(obj: unknown): obj is DIContainer {
  if (typeof obj !== 'object' || obj === null) {
    return false
  }
  const c = obj as Record<string, unknown>
  return (
    typeof c.register === 'function' &&
    typeof c.resolve === 'function' &&
    typeof c.isReady === 'function'
  )
}

export function isDiademContainer(obj: unknown): obj is DiademContainer {
  if (!isDIContainer(obj)) {
    return false
  }
  const c = obj as unknown as Record<string, unknown>
  return (
    typeof c.autoRegisterDiscovered === 'function' &&
    typeof c.getDiagnostics === 'function'
  )
}
