/**
 * Build-time Dependency Resolver for Auto-Wiring DI Container
 *
 * This module provides dependency resolution using pre-analyzed build-time manifest data.
 * No runtime reflection or constructor parsing - all dependency information is extracted
 * during build time and included in the manifest.
 *
 * Features:
 * - Uses build-time dependency analysis from enhanced manifest
 * - Topological sorting based on pre-calculated registration order
 * - Constructor injection with resolved dependencies
 * - Support for optional dependencies and external services
 */

import type { DIContainer } from './container'
import { getDIMetadata } from './decorators'
import type { DIMetadata } from './decorators'
import { getLogger } from './logger'
import { loadManifest } from './manifest'
import type { ServiceDependency, ServiceManifestEntry } from './manifest'
import type { AbstractConstructor, ConcreteConstructor } from './types'

export interface DependencyResolutionResult {
  registeredServices: string[]
  registeredCount: number
  skippedCount: number
  dependencyStats: {
    totalServices: number
    servicesWithDependencies: number
    totalDependencies: number
    externalDependencies: number
    maxDependencyDepth: number
  }
  warnings: string[]
  registrationOrder: string[]
}

export class EnhancedDependencyResolver {
  private readonly registeredServices = new Set<string>()
  private readonly serviceClassMap = new Map<string, ConcreteConstructor>()
  private readonly serviceMetadataMap = new Map<string, DIMetadata>()

  /**
   * Register services using build-time dependency analysis
   * Services are registered in the correct order based on their dependencies
   */
  async registerServicesWithManifest(
    container: DIContainer,
    services: ConcreteConstructor[],
    manifestEntries: ServiceManifestEntry[],
    environment?: string
  ): Promise<DependencyResolutionResult> {
    const warnings: string[] = []
    const registrationOrder: string[] = []
    let registeredCount = 0
    let skippedCount = 0

    // Create maps for efficient lookup
    const manifestMap = new Map<string, ServiceManifestEntry>()

    // Build service class map and metadata map using original class names from manifest
    this.serviceClassMap.clear()
    this.serviceMetadataMap.clear()
    let servicesWithMetadata = 0

    // Recover original (un-mangled) class names from the manifest's static
    // SERVICE_CLASSES mapping, when a manifest is configured. When it isn't
    // (e.g. callers passing explicit services + entries, or unminified runtimes),
    // fall back to the runtime class name.
    const reverseMapping = new Map<AbstractConstructor, string>()
    try {
      const { SERVICE_CLASSES } = await loadManifest()
      Object.entries(SERVICE_CLASSES).forEach(([originalName, serviceClass]) => {
        reverseMapping.set(serviceClass, originalName)
      })
    } catch {
      // No global manifest configured; runtime class names are used below.
    }

    for (const serviceClass of services) {
      const metadata = getDIMetadata(serviceClass)
      if (metadata) {
        // Use original class name from static mapping if available, otherwise fall back to mangled name
        const originalName =
          reverseMapping.get(serviceClass) || serviceClass.name
        this.serviceClassMap.set(originalName, serviceClass)
        this.serviceMetadataMap.set(originalName, metadata)
        servicesWithMetadata++
      }
    }
    getLogger().info(
      `📋 Built service map: ${servicesWithMetadata}/${services.length} services with DI metadata`
    )

    if (servicesWithMetadata === 0) {
      getLogger().error('❌ CRITICAL: No services have DI metadata!')
      getLogger().error(
        '🔍 Service analysis:',
        services.slice(0, 3).map((s) => ({
          name: s.name,
          hasDI: !!getDIMetadata(s)
        }))
      )
    }

    // Build manifest map and filter by environment
    for (const entry of manifestEntries) {
      // Skip if environment doesn't match
      if (
        environment &&
        entry.environment &&
        entry.environment !== environment
      ) {
        continue
      }
      manifestMap.set(entry.className, entry)
    }
    getLogger().info(
      `📋 Manifest map: ${manifestMap.size}/${manifestEntries.length} entries for ${environment || 'any'}`
    )

    // Get services sorted by registration order (calculated at build time)
    const sortedEntries = Array.from(manifestMap.values()).sort(
      (a, b) => a.registrationOrder - b.registrationOrder
    )

    if (sortedEntries.length === 0) {
      getLogger().error('❌ CRITICAL: No services to register after filtering!')
      getLogger().error('🔍 Debug analysis:', {
        serviceClassMapSize: this.serviceClassMap.size,
        manifestMapSize: manifestMap.size,
        serviceNames: Array.from(this.serviceClassMap.keys()).slice(0, 5),
        manifestNames: manifestEntries.slice(0, 5).map((e) => e.className),
        environment
      })
      return {
        registeredServices: [],
        registeredCount: 0,
        skippedCount: 0,
        dependencyStats: {
          totalServices: 0,
          servicesWithDependencies: 0,
          totalDependencies: 0,
          externalDependencies: 0,
          maxDependencyDepth: 0
        },
        warnings: ['No services to register'],
        registrationOrder: []
      }
    }

    getLogger().info(`🔗 Registering ${sortedEntries.length} services`)

    // Register each service in the correct order
    for (const manifestEntry of sortedEntries) {
      const serviceClass = this.serviceClassMap.get(manifestEntry.className)

      if (!serviceClass) {
        getLogger().error(`❌ Service class not found: ${manifestEntry.className}`)

        getLogger().error(
          `🔍 Available: ${Array.from(this.serviceClassMap.keys()).slice(0, 5).join(', ')}...`
        )
        warnings.push(`Service class ${manifestEntry.className} not found`)
        skippedCount++
        continue
      }

      try {
        await this.registerSingleService(
          container,
          serviceClass,
          manifestEntry,
          warnings
        )
        registeredCount++
        registrationOrder.push(manifestEntry.className)
        this.registeredServices.add(manifestEntry.className)
      } catch (error) {
        const err = error as Error
        skippedCount++
        getLogger().error(
          `❌ Registration failed: ${manifestEntry.className} - ${err.message}`
        )
        warnings.push(
          `Failed to register ${manifestEntry.className}: ${err.message}`
        )
      }
    }

    getLogger().info(
      `📊 Registration complete: ${registeredCount} registered, ${skippedCount} skipped`
    )

    // Calculate dependency statistics
    const dependencyStats = this.calculateDependencyStats(manifestEntries)

    const result: DependencyResolutionResult = {
      registeredServices: Array.from(this.registeredServices),
      registeredCount,
      skippedCount,
      dependencyStats,
      warnings,
      registrationOrder
    }

    if (process.env.DEBUG_DI) {
      getLogger().info(`📊 Registration Summary:`)
      getLogger().info(`   ✅ Registered: ${registeredCount}`)
      getLogger().info(`   ⚠️  Skipped: ${skippedCount}`)
      getLogger().info(
        `   🔗 Dependencies resolved: ${dependencyStats.totalDependencies}`
      )
      if (warnings.length > 0) {
        getLogger().warn(`   ⚠️  Warnings: ${warnings.length}`)
      }
    }

    return result
  }

  /**
   * Register a single service with proper dependency injection
   */
  private async registerSingleService(
    container: DIContainer,
    ServiceClass: ConcreteConstructor,
    manifestEntry: ServiceManifestEntry,
    warnings: string[]
  ): Promise<void> {
    // Get DI metadata from the service class
    const metadata = getDIMetadata(ServiceClass)
    if (!metadata) {
      getLogger().error(`❌ No DI metadata: ${ServiceClass.name}`)
      throw new Error(`No DI metadata found for ${ServiceClass.name}`)
    }

    // Validate container methods
    if (
      typeof container.registerSingleton !== 'function' ||
      typeof container.registerFactory !== 'function' ||
      typeof container.registerScoped !== 'function' ||
      typeof container.registerMulti !== 'function'
    ) {
      getLogger().error(
        `❌ Container missing registration methods for ${ServiceClass.name}`
      )
      throw new Error(`Container missing registration methods`)
    }

    // Create factory function that resolves dependencies using manifest information
    const createInstance = (resolvingContainer: DIContainer = container) => {
      const resolvedArgs: unknown[] = []

      // Resolve each dependency based on manifest information
      for (const dependency of manifestEntry.resolvedDependencies) {
        try {
          if (dependency.external) {
            // External dependency - not managed by DI container
            if (dependency.isOptional) {
              resolvedArgs[dependency.paramIndex] = undefined
            } else {
              // For external dependencies, we might need special handling
              const defaultValue =
                this.getDefaultValueForExternalDependency(dependency)
              if (defaultValue !== undefined) {
                resolvedArgs[dependency.paramIndex] = defaultValue
              } else {
                throw new Error(
                  `External dependency ${dependency.typeName} is required but no default available`
                )
              }
            }
          } else if (dependency.implementingService) {
            // Internal dependency - resolve from container
            const depMetadata = this.serviceMetadataMap.get(
              dependency.implementingService
            )
            if (!depMetadata) {
              throw new Error(
                `No DI metadata found for dependency ${dependency.implementingService}`
              )
            }

            // Resolve dependency from container
            const resolvedDep = resolvingContainer.resolve(depMetadata.token)
            resolvedArgs[dependency.paramIndex] = resolvedDep
          } else {
            // Unknown dependency type
            if (dependency.isOptional) {
              resolvedArgs[dependency.paramIndex] = undefined
            } else {
              throw new Error(
                `Unknown dependency type for ${dependency.typeName}`
              )
            }
          }
        } catch (error) {
          if (dependency.isOptional) {
            resolvedArgs[dependency.paramIndex] = undefined
            warnings.push(
              `Optional dependency ${dependency.typeName} could not be resolved for ${ServiceClass.name}: ${error}`
            )
          } else {
            throw new Error(
              `Cannot resolve required dependency ${dependency.typeName} for service ${ServiceClass.name}: ${error}`,
              { cause: error }
            )
          }
        }
      }

      // Create instance with resolved dependencies
      return new ServiceClass(...resolvedArgs)
    }

    // Register based on lifecycle from manifest
    getLogger().info(
      `🔧 Registering ${ServiceClass.name} (${manifestEntry.lifecycle})`
    )

    try {
      switch (manifestEntry.lifecycle) {
        case 'singleton':
          if (manifestEntry.multi) {
            container.registerMulti(metadata.token, createInstance())
          } else {
            container.registerSingleton(metadata.token, createInstance)
          }
          break
        case 'factory':
          container.registerFactory(metadata.token, createInstance)
          break
        case 'lazy':
          container.registerFactory(metadata.token, createInstance)
          break
        case 'scoped':
          container.registerScoped(metadata.token, createInstance)
          break
        case 'lazySingleton': {
          // For lazy singletons, we need to use a factory that maintains its own singleton state
          let lazySingletonInstance: unknown = null
          container.registerFactory(metadata.token, () => {
            if (lazySingletonInstance === null) {
              lazySingletonInstance = createInstance()
            }
            return lazySingletonInstance
          })
          break
        }
        default:
          // Default to singleton
          container.registerSingleton(metadata.token, createInstance)
      }
      getLogger().info(`✅ Registered ${ServiceClass.name}`)
    } catch (error) {
      const err = error as Error
      getLogger().error(
        `❌ Container registration failed for ${ServiceClass.name}: ${err.message}`
      )
      throw error
    }
  }

  /**
   * Get default value for external dependencies
   */
  private getDefaultValueForExternalDependency(
    dependency: ServiceDependency
  ): unknown {
    // Provide sane defaults for primitive external dependencies only.
    // Non-primitive externals should be supplied explicitly via container
    // registration; returning undefined makes a missing required one fail loudly.
    switch (dependency.typeName) {
      case 'string':
        return ''
      case 'number':
        return 0
      case 'boolean':
        return false
      default:
        return undefined
    }
  }

  /**
   * Calculate dependency statistics from manifest entries
   */
  private calculateDependencyStats(manifestEntries: ServiceManifestEntry[]): {
    totalServices: number
    servicesWithDependencies: number
    totalDependencies: number
    externalDependencies: number
    maxDependencyDepth: number
  } {
    let servicesWithDependencies = 0
    let totalDependencies = 0
    let externalDependencies = 0
    let maxDependencyDepth = 0

    for (const entry of manifestEntries) {
      if (entry.resolvedDependencies.length > 0) {
        servicesWithDependencies++
        totalDependencies += entry.resolvedDependencies.length
        maxDependencyDepth = Math.max(
          maxDependencyDepth,
          entry.resolvedDependencies.length
        )

        externalDependencies += entry.resolvedDependencies.filter(
          (dep) => dep.external
        ).length
      }
    }

    return {
      totalServices: manifestEntries.length,
      servicesWithDependencies,
      totalDependencies,
      externalDependencies,
      maxDependencyDepth
    }
  }

  /**
   * Validate that all required dependencies can be resolved
   */
  validateDependencies(manifestEntries: ServiceManifestEntry[]): {
    valid: boolean
    missingDependencies: string[]
    circularDependencies: string[]
  } {
    const missingDependencies: string[] = []
    const availableServices = new Set(
      manifestEntries.map((entry) => entry.className)
    )

    for (const entry of manifestEntries) {
      for (const dep of entry.resolvedDependencies) {
        if (!dep.external && !dep.isOptional && dep.implementingService) {
          if (!availableServices.has(dep.implementingService)) {
            missingDependencies.push(
              `${entry.className} requires ${dep.implementingService} (${dep.typeName})`
            )
          }
        }
      }
    }

    // Check for circular dependencies (should be rare due to build-time analysis)
    const circularDependencies =
      this.detectCircularDependencies(manifestEntries)

    return {
      valid:
        missingDependencies.length === 0 && circularDependencies.length === 0,
      missingDependencies,
      circularDependencies
    }
  }

  /**
   * Detect circular dependencies in manifest entries
   */
  private detectCircularDependencies(
    manifestEntries: ServiceManifestEntry[]
  ): string[] {
    const cycles: string[] = []
    const entryMap = new Map(
      manifestEntries.map((entry) => [entry.className, entry])
    )
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const findCycles = (className: string, path: string[]) => {
      if (visiting.has(className)) {
        const cycleStart = path.indexOf(className)
        const cycle = path.slice(cycleStart).join(' -> ') + ` -> ${className}`
        cycles.push(cycle)
        return
      }

      if (visited.has(className)) return

      const entry = entryMap.get(className)
      if (!entry) return

      visited.add(className)
      visiting.add(className)

      for (const dep of entry.resolvedDependencies) {
        if (dep.implementingService && !dep.external) {
          findCycles(dep.implementingService, [...path, className])
        }
      }

      visiting.delete(className)
    }

    for (const entry of manifestEntries) {
      if (!visited.has(entry.className)) {
        findCycles(entry.className, [])
      }
    }

    return cycles
  }
}

/**
 * Helper function to register services with enhanced dependency resolution using manifest
 */
export async function registerServicesWithManifestDependencies(
  container: DIContainer,
  services: ConcreteConstructor[],
  manifestEntries: ServiceManifestEntry[],
  environment?: string
): Promise<DependencyResolutionResult> {
  const resolver = new EnhancedDependencyResolver()

  // Validate dependencies before registration
  const validation = resolver.validateDependencies(manifestEntries)

  if (!validation.valid) {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_DI) {
      getLogger().warn('⚠️ Dependency validation warnings:')
      validation.missingDependencies.forEach((dep) => {
        getLogger().warn(`  - ${dep}`)
      })
      validation.circularDependencies.forEach((cycle) => {
        getLogger().warn(`  - Circular: ${cycle}`)
      })
    }
  }

  // Register services in dependency order
  return resolver.registerServicesWithManifest(
    container,
    services,
    manifestEntries,
    environment
  )
}
