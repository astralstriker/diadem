import type {
  AutoDiscoveryConfig,
  ServiceDiscoveryResult
} from './auto-discovery'
import { registerServicesWithManifestDependencies } from './dependency-resolver'
import { getLogger } from './logger'
import { loadManifest } from './manifest'

// Constructor type for class-based DI tokens. `...args: any[]` is the idiomatic
// constructor signature — the only form that accepts a class with any params.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T> = abstract new (...args: any[]) => T
export type Token<T> = Constructor<T>

// Lifecycle types for auto-registration
export type LifecycleType =
  | 'singleton'
  | 'factory'
  | 'lazy'
  | 'lazySingleton'
  | 'scoped'

/**
 * A resource that can be released when its owning container is disposed.
 * Singletons and directly-registered values implementing this are torn down
 * automatically by {@link DiademContainer.dispose}.
 */
export interface Disposable {
  dispose: () => void | Promise<void>
}

function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Disposable).dispose === 'function'
  )
}

// Base DI Container
/**
 * DIContainer interface for dependency injection.
 *
 * - Use `register` for direct value/class registration.
 * - Use `registerSingleton` for singletons (one instance per container).
 * - Use `registerFactory` for transient factories (new instance per resolve).
 * - Use `resolve` to retrieve a dependency by token.
 * - Use `isReady` to check if the container is fully set up.
 * - Use `autoRegisterDiscovered` for automatic service discovery and registration.
 */
export interface DIContainer {
  register: <T>(token: Token<T>, implementation: T) => void
  resolve: <T>(token: Token<T>) => T
  resolveAll: <T>(token: Token<T>) => T[]
  resolveAsync: <T>(token: Token<T>) => Promise<T>
  registerSingleton: <T>(token: Token<T>, factory: () => T) => void
  registerFactory: <T>(token: Token<T>, factory: () => T) => void
  registerScoped: <T>(token: Token<T>, factory: (scope: DIContainer) => T) => void
  registerMulti: <T>(token: Token<T>, implementation: T) => void
  registerAsyncFactory: <T>(token: Token<T>, factory: () => Promise<T>) => void
  registerAsyncSingleton: <T>(token: Token<T>, factory: () => Promise<T>) => void
  autoDiscover: (
    config?: AutoDiscoveryConfig
  ) => Promise<ServiceDiscoveryResult>
  autoRegisterDiscovered: (environment?: string) => Promise<void>
  isReady: () => boolean
  getDiagnostics: () => {
    dependencies: number
    singletons: number
    factories: number
    scopedFactories: number
    multiBindings: number
    asyncFactories: number
    isReady: boolean
  }
  has: <T>(token: Token<T>) => boolean
  getRegisteredTokens: () => Array<Token<unknown>>
  onDispose: (callback: () => void | Promise<void>) => void
  dispose: () => Promise<void>
}

/**
 * DiademContainer is a dependency injection container.
 *
 * Typically you create **one application-scoped container** and keep it for the
 * lifetime of the process. The library holds no hidden global container — you
 * own the instance — which is what makes it safe in concurrent/SSR environments
 * where a module-level global container would leak state between requests.
 *
 * When you need isolation between concurrent units of work (e.g. per HTTP
 * request, or per test), create a child scope with {@link createChild} that
 * inherits the parent's registrations and can override them locally.
 *
 * - Supports direct registration, singletons, and per-resolve factories.
 * - Supports decorator-driven auto-registration from a build-time manifest,
 *   with optional environment filtering.
 * - Stores registration metadata on classes rather than in global state.
 *
 * @example
 *   const container = new DiademContainer()
 *   container.register(IRepository, new Repository())
 *   container.registerSingleton(IService, () => new Service(container.resolve(IRepository)))
 *   container.registerFactory(IApiClient, () => createApiClient())
 *
 *   // Or autowire from a configured build-time manifest:
 *   await container.autoRegisterDiscovered('production')
 *
 *   const repo = container.resolve(IRepository)
 *
 *   // Per-request isolation when you need it:
 *   const scoped = container.createChild()
 */
class DiademContainer implements DIContainer {
  private readonly dependencies = new Map<Constructor<unknown>, unknown>()
  public readonly singletons = new Map<Constructor<unknown>, unknown>()
  public readonly factories = new Map<Constructor<unknown>, () => unknown>()
  private readonly scopedInstances = new Map<Constructor<unknown>, unknown>()
  private readonly multiBindings = new Map<Constructor<unknown>, unknown[]>()
  public readonly scopedFactories = new Map<
    Constructor<unknown>,
    (scope: DIContainer) => unknown
  >()
  public readonly asyncFactories = new Map<
    Constructor<unknown>,
    () => Promise<unknown>
  >()
  private readonly disposers: Array<() => void | Promise<void>> = []
  private ready = false
  private disposed = false

  /**
   * Register a dependency by value or class instance.
   * @param token Dependency token
   * @param implementation The value or instance to register
   */
  register<T>(token: Constructor<T>, implementation: T): void {
    this.dependencies.set(token, implementation)
    this.trackDisposable(implementation)
  }

  /**
   * Register a factory that returns a new instance on every resolve.
   * Use for transient dependencies.
   * @param token Dependency token
   * @param factory Factory function
   */
  registerFactory<T>(token: Constructor<T>, factory: () => T): void {
    this.factories.set(token, factory)
  }

  /**
   * Register a scoped factory. The factory runs once per container instance and
   * the result is cached in that container. Child/request scopes inherit the
   * factory but not the cached instance, so each scope gets its own object.
   * @param token Dependency token
   * @param factory Factory function
   */
  registerScoped<T>(
    token: Constructor<T>,
    factory: (scope: DIContainer) => T
  ): void {
    this.scopedFactories.set(token, factory)
  }

  /**
   * Register one contribution to a multi-binding token. Use
   * {@link resolveAll} to retrieve every contribution in registration order.
   * @param token Dependency token
   * @param implementation Implementation instance
   */
  registerMulti<T>(token: Constructor<T>, implementation: T): void {
    const existing = this.multiBindings.get(token) ?? []
    existing.push(implementation)
    this.multiBindings.set(token, existing)
    this.trackDisposable(implementation)
  }

  /**
   * Register a singleton (one instance per container).
   *
   * **Order matters:** the factory runs immediately, at registration time, so
   * anything it resolves must already be registered. Register dependencies
   * before their dependents — the build-time manifest is emitted in exactly this
   * (topological) order. To defer construction until first resolve instead, use
   * a `lazySingleton` lifecycle via the decorator/manifest.
   *
   * @param token Dependency token
   * @param factory Factory function, called once, immediately
   */
  registerSingleton<T>(token: Constructor<T>, factory: () => T): void {
    if (!this.singletons.has(token)) {
      const instance = factory()
      this.singletons.set(token, instance)
      this.trackDisposable(instance)
    }
  }

  /**
   * Register a factory that awaits its result on every {@link resolveAsync}.
   * Use for transient dependencies that require asynchronous construction.
   * @param token Dependency token
   * @param factory Async factory function
   */
  registerAsyncFactory<T>(
    token: Constructor<T>,
    factory: () => Promise<T>
  ): void {
    this.asyncFactories.set(token, factory)
  }

  /**
   * Register an async singleton: the factory runs at most once (on the first
   * {@link resolveAsync}) and the awaited instance is cached. If the instance
   * is {@link Disposable} it is torn down on {@link dispose}.
   * @param token Dependency token
   * @param factory Async factory function, called at most once
   */
  registerAsyncSingleton<T>(
    token: Constructor<T>,
    factory: () => Promise<T>
  ): void {
    let cached: Promise<T> | undefined
    this.asyncFactories.set(token, () => {
      cached ??= factory().then((instance) => {
        this.trackDisposable(instance)
        return instance
      })
      return cached
    })
  }

  /** Record a value's disposer if it implements {@link Disposable}. */
  private trackDisposable(value: unknown): void {
    if (isDisposable(value)) {
      this.disposers.push(() => value.dispose())
    }
  }

  /**
   * Resolve a dependency by token.
   * @param token Dependency token
   * @returns The resolved dependency
   * @throws If the dependency is not found
   */
  resolve<T>(token: Constructor<T>): T {
    // Guard against undefined/null token
    if (!token) {
      throw new Error('Dependency token is undefined or null')
    }

    // One Map.get() per registry on the hit path (registered values are always
    // instances/factories, never undefined), instead of has() + get().
    const direct = this.dependencies.get(token)
    if (direct !== undefined) {
      return direct as T
    }

    const singleton = this.singletons.get(token)
    if (singleton !== undefined) {
      return singleton as T
    }

    const scopedInstance = this.scopedInstances.get(token)
    if (scopedInstance !== undefined) {
      return scopedInstance as T
    }

    const factory = this.factories.get(token)
    if (factory !== undefined) {
      return factory() as T
    }

    const scopedFactory = this.scopedFactories.get(token)
    if (scopedFactory !== undefined) {
      const instance = scopedFactory(this)
      this.scopedInstances.set(token, instance)
      this.trackDisposable(instance)
      return instance as T
    }

    // Registered, but only as an async factory.
    if (this.asyncFactories.has(token)) {
      throw new Error(
        `Dependency ${token?.name || 'Unknown'} is registered as an async ` +
          `factory; resolve it with resolveAsync() instead of resolve().`
      )
    }

    // Rare: a value of `undefined` was explicitly registered.
    if (this.dependencies.has(token) || this.singletons.has(token)) {
      return undefined as T
    }

    // Enhanced error message with more debugging info
    const tokenName = token?.name || 'Unknown'
    const registeredTokens = this.getRegisteredTokens()
    const registeredNames = registeredTokens
      .map((t) => t?.name || 'Unknown')
      .join(', ')

    throw new Error(
      `Dependency not found: ${tokenName}. ` +
        `Available services: [${registeredNames}]. ` +
        `Total registered: ${registeredTokens.length}`
    )
  }

  /**
   * Resolve every implementation registered for a multi-binding token.
   * @param token Dependency token
   * @returns Registered implementations in registration order
   */
  resolveAll<T>(token: Constructor<T>): T[] {
    if (!token) {
      throw new Error('Dependency token is undefined or null')
    }
    return [...((this.multiBindings.get(token) as T[] | undefined) ?? [])]
  }

  /**
   * Resolve a dependency that may have been registered asynchronously.
   * Synchronous registrations resolve immediately; async factories/singletons
   * are awaited.
   * @param token Dependency token
   * @returns A promise of the resolved dependency
   * @throws If the dependency is not found
   */
  async resolveAsync<T>(token: Constructor<T>): Promise<T> {
    if (!token) {
      throw new Error('Dependency token is undefined or null')
    }

    if (
      this.dependencies.has(token) ||
      this.singletons.has(token) ||
      this.scopedInstances.has(token) ||
      this.factories.has(token) ||
      this.scopedFactories.has(token)
    ) {
      return this.resolve(token)
    }

    const asyncFactory = this.asyncFactories.get(token)
    if (asyncFactory) {
      return asyncFactory() as Promise<T>
    }

    return this.resolve(token) // throws the standard "not found" error
  }

  /**
   * Returns true if the container is fully set up.
   */
  isReady(): boolean {
    return this.ready
  }

  /**
   * Mark the container as ready (all dependencies registered).
   */
  setReady(): void {
    this.ready = true
  }

  /**
   * Clear all registrations (useful for testing or container reset).
   */
  clear(): void {
    this.dependencies.clear()
    this.singletons.clear()
    this.factories.clear()
    this.scopedInstances.clear()
    this.scopedFactories.clear()
    this.multiBindings.clear()
    this.asyncFactories.clear()
    this.disposers.length = 0
    this.ready = false
  }

  /**
   * Register an arbitrary teardown callback, run on {@link dispose} in reverse
   * order of registration.
   */
  onDispose(callback: () => void | Promise<void>): void {
    this.disposers.push(callback)
  }

  /**
   * Dispose the container: run all teardown callbacks (and the `dispose()` of
   * any registered {@link Disposable} singletons/values) in reverse order, then
   * clear all registrations. Idempotent.
   *
   * Note: transient (`factory`) and lazy instances are owned by the caller, not
   * the container, so they are not disposed here.
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }
    this.disposed = true

    for (const disposer of [...this.disposers].reverse()) {
      try {
        await disposer()
      } catch (error) {
        getLogger().error('Diadem: disposer threw during dispose()', error)
      }
    }

    this.clear()
  }

  /** Whether {@link dispose} has been called. */
  isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Get diagnostic information about registered dependencies.
   */
  getDiagnostics(): {
    dependencies: number
    singletons: number
    factories: number
    scopedFactories: number
    multiBindings: number
    asyncFactories: number
    isReady: boolean
  } {
    return {
      dependencies: this.dependencies.size,
      singletons: this.singletons.size,
      factories: this.factories.size,
      scopedFactories: this.scopedFactories.size,
      multiBindings: Array.from(this.multiBindings.values()).reduce(
        (sum, bindings) => sum + bindings.length,
        0
      ),
      asyncFactories: this.asyncFactories.size,
      isReady: this.ready
    }
  }

  /**
   * Check if a token is registered in the container
   */
  has<T>(token: Constructor<T>): boolean {
    // Guard against undefined/null token
    if (!token) {
      return false
    }

    return (
      this.dependencies.has(token) ||
      this.singletons.has(token) ||
      this.scopedInstances.has(token) ||
      this.multiBindings.has(token) ||
      this.factories.has(token) ||
      this.scopedFactories.has(token) ||
      this.asyncFactories.has(token)
    )
  }

  /**
   * Get all registered tokens
   */
  getRegisteredTokens(): Array<Constructor<unknown>> {
    const tokens = new Set<Constructor<unknown>>()

    this.dependencies.forEach((_, token) => tokens.add(token))
    this.singletons.forEach((_, token) => tokens.add(token))
    this.factories.forEach((_, token) => tokens.add(token))
    this.scopedFactories.forEach((_, token) => tokens.add(token))
    this.multiBindings.forEach((_, token) => tokens.add(token))
    this.asyncFactories.forEach((_, token) => tokens.add(token))

    return Array.from(tokens)
  }

  /**
   * Create a child container that inherits this container's registrations and
   * can override them locally. Useful for per-request or per-test scopes.
   *
   * The child shares the parent's already-created singleton instances by
   * reference; it deliberately does NOT inherit the parent's disposers, so
   * disposing the child never tears down shared parent-owned resources. Only
   * resources the child registers itself are disposed with it.
   */
  createChild(): DiademContainer {
    const child = new DiademContainer()

    // Copy parent registrations by reference. Disposers are intentionally not
    // copied — the parent owns the lifecycle of shared instances.
    this.dependencies.forEach((impl, token) => {
      child.dependencies.set(token, impl)
    })

    this.singletons.forEach((impl, token) => {
      child.singletons.set(token, impl)
    })

    this.factories.forEach((factory, token) => {
      child.factories.set(token, factory)
    })

    this.scopedFactories.forEach((factory, token) => {
      child.scopedFactories.set(token, factory)
    })

    this.multiBindings.forEach((bindings, token) => {
      child.multiBindings.set(token, [...bindings])
    })

    this.asyncFactories.forEach((factory, token) => {
      child.asyncFactories.set(token, factory)
    })

    return child
  }

  /**
   * Create a named request scope. This is intentionally the same isolation
   * model as {@link createChild}: parent singletons are shared, scoped services
   * are recreated and cached inside the request container, and disposing the
   * request never tears down parent-owned resources.
   */
  createRequestScope(): DiademContainer {
    return this.createChild()
  }

  /**
   * Auto-discover and get information about available services.
   * Does not register them - use autoRegisterDiscovered() for that.
   */
  async autoDiscover(
    config?: AutoDiscoveryConfig
  ): Promise<ServiceDiscoveryResult> {
    const { discoverServices } = await import('./auto-discovery')
    return discoverServices(config)
  }

  /**
   * Auto-discover and register all DI-decorated services using build-time manifest.
   * This is true autowiring that doesn't require hardcoded paths or explicit imports.
   *
   * @param environment Optional environment filter
   * @example
   * ```typescript
   * const container = new DiademContainer()
   * await container.autoRegisterDiscovered('production')
   * container.setReady()
   * ```
   */
  async autoRegisterDiscovered(environment?: string): Promise<void> {
    try {
      const { discoverServices } = await import('./auto-discovery')
      const discoveryResult = await discoverServices({ environment })
      const services = discoveryResult.services

      if (!discoveryResult.manifestAvailable) {
        getLogger().warn(
          'Diadem: no manifest configured — nothing was auto-registered.'
        )
        return
      }

      const { getServicesForEnvironment } = await loadManifest()
      const manifestEntries = getServicesForEnvironment(environment)

      const result = await registerServicesWithManifestDependencies(
        this,
        services,
        manifestEntries,
        environment
      )

      const log = getLogger()
      log.debug(
        `Diadem: registered ${result.registeredCount} services for "${environment ?? 'all'}"`,
        result.dependencyStats
      )
      if (result.warnings.length > 0) {
        log.warn('Diadem: registration warnings', result.warnings)
      }
    } catch (error) {
      getLogger().error('Diadem: auto-registration failed', error)
      throw error
    }
  }
}

export { DiademContainer }
