/**
 * Service manifest contract + injection seam.
 *
 * Diadem is a *build-time* DI container: a generator scans the consumer's
 * source, extracts each service's constructor dependencies, topologically
 * sorts them, and emits a manifest module. That generated module is NOT part
 * of this package — it lives in the consumer's project. This file defines the
 * shape such a module must conform to, and the seam through which it is plugged
 * in at runtime.
 *
 * Usage in a consuming app:
 * ```ts
 * import { configureManifest } from '@devcraft-ts/diadem'
 * import * as manifest from './generated/service-manifest'
 *
 * configureManifest(manifest)
 * ```
 *
 * See `examples/basic.ts` for a complete, runnable example.
 */

import type { AbstractConstructor } from './types'

/** A single constructor parameter of a service, as analysed at build time. */
export interface ServiceDependency {
  paramName: string
  paramIndex: number
  typeName: string
  isOptional: boolean
  isReadonly?: boolean
  isPrivate?: boolean
  /** Class name of the service that implements this dependency, if internal. */
  implementingService?: string
  /** True when the dependency is not managed by the container. */
  external?: boolean
}

/** One service entry in the build-time manifest. */
export interface ServiceManifestEntry {
  className: string
  importPath: string
  lifecycle:
    | 'dependency'
    | 'singleton'
    | 'factory'
    | 'lazy'
    | 'lazySingleton'
    | 'scoped'
  environment?: string
  multi?: boolean
  exported: boolean
  filePath: string
  registrationOrder: number
  dependencies: ServiceDependency[]
  resolvedDependencies: ServiceDependency[]
}

/** A loaded service class, paired with the manifest entry it came from. */
export interface ImportedService {
  entry: ServiceManifestEntry
  serviceClass: AbstractConstructor
}

/**
 * The shape of a generated manifest module. A consumer's build step emits a
 * module exporting these members; pass that module to {@link configureManifest}.
 */
export interface ServiceManifestModule {
  SERVICE_MANIFEST: ServiceManifestEntry[]
  SERVICE_CLASSES: Record<string, AbstractConstructor>
  SERVICES_BY_ENVIRONMENT?: Record<string, ServiceManifestEntry[]>
  MANIFEST_STATS?: unknown
  getServicesForEnvironment: (environment?: string) => ServiceManifestEntry[]
  importService: (entry: ServiceManifestEntry) => Promise<AbstractConstructor>
  importAllServices: (
    entries: ServiceManifestEntry[]
  ) => Promise<ImportedService[]>
}

let registeredManifest: ServiceManifestModule | null = null

/**
 * Register the generated manifest module so the container can discover and
 * autowire services. Call once at application startup, before constructing a
 * container that relies on auto-discovery.
 */
export function configureManifest(manifest: ServiceManifestModule): void {
  registeredManifest = manifest
}

/** Returns the configured manifest, or null if none has been registered. */
export function getManifest(): ServiceManifestModule | null {
  return registeredManifest
}

/** True when a manifest has been registered via {@link configureManifest}. */
export function hasManifest(): boolean {
  return registeredManifest !== null
}

/** Clear the registered manifest. Primarily useful in tests. */
export function resetManifest(): void {
  registeredManifest = null
}

/**
 * Resolve the configured manifest, throwing a helpful error if none is set.
 * Internal call sites use this in place of a hardcoded manifest import.
 */
export async function loadManifest(): Promise<ServiceManifestModule> {
  if (registeredManifest) {
    return registeredManifest
  }
  throw new Error(
    'No Diadem service manifest configured. Generate a manifest for your ' +
      'project and register it at startup:\n\n' +
      "  import { configureManifest } from '@devcraft-ts/diadem'\n" +
      "  import * as manifest from './generated/service-manifest'\n" +
      '  configureManifest(manifest)\n'
  )
}
