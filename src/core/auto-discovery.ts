/**
 * Automatic service discovery from a configured build-time manifest.
 *
 * Discovery is cheap: the manifest is an in-memory module registered via
 * `configureManifest`, so this just reads its entries for the requested
 * environment, resolves the corresponding classes, and keeps those carrying DI
 * metadata. Results are cached per environment.
 */

import { hasDIMetadata } from './decorators'
import { getLogger } from './logger'
import { hasManifest, loadManifest } from './manifest'
import type { ConcreteConstructor } from './types'

/** Configuration for auto-discovery. */
export interface AutoDiscoveryConfig {
  /** Environment filter; omit (or 'all') to discover every service. */
  environment?: string
  /** Whether to use the per-environment discovery cache. Defaults to true. */
  useCache?: boolean
}

/** Result of a discovery pass. */
export interface ServiceDiscoveryResult {
  services: ConcreteConstructor[]
  /** Number of manifest entries considered for the environment. */
  totalFound: number
  /** Number of discovered services carrying DI metadata. */
  totalDecorated: number
  fromCache: boolean
  manifestAvailable: boolean
}

const discoveryCache = new Map<string, ConcreteConstructor[]>()

/** Clear the per-environment discovery cache. */
export function clearDiscoveryCache(): void {
  discoveryCache.clear()
}

/**
 * Discover all DI-decorated services from the configured manifest.
 */
export async function discoverServices(
  config: AutoDiscoveryConfig = {}
): Promise<ServiceDiscoveryResult> {
  const { environment, useCache = true } = config
  const cacheKey = environment ?? 'all'

  if (useCache) {
    const cached = discoveryCache.get(cacheKey)
    if (cached) {
      return {
        services: cached,
        totalFound: cached.length,
        totalDecorated: cached.length,
        fromCache: true,
        manifestAvailable: true
      }
    }
  }

  if (!hasManifest()) {
    getLogger().warn(
      'Diadem: no manifest configured — service discovery found nothing. ' +
        'Call configureManifest(...) at startup.'
    )
    return {
      services: [],
      totalFound: 0,
      totalDecorated: 0,
      fromCache: false,
      manifestAvailable: false
    }
  }

  const manifest = await loadManifest()
  const entries = manifest.getServicesForEnvironment(environment)
  const imported = await manifest.importAllServices(entries)

  const services = imported
    .map((item) => item.serviceClass)
    .filter(
      (serviceClass): serviceClass is ConcreteConstructor =>
        typeof serviceClass === 'function' &&
        hasDIMetadata(serviceClass as ConcreteConstructor)
    )

  if (useCache) {
    discoveryCache.set(cacheKey, services)
  }

  getLogger().debug(
    `Diadem: discovered ${services.length}/${entries.length} services for "${cacheKey}"`
  )

  return {
    services,
    totalFound: entries.length,
    totalDecorated: services.length,
    fromCache: false,
    manifestAvailable: true
  }
}

/** Whether a manifest has been configured. */
export function isManifestAvailable(): boolean {
  return hasManifest()
}

/** The configured manifest's `MANIFEST_STATS`, or null if unavailable. */
export async function getManifestStats(): Promise<unknown> {
  if (!hasManifest()) {
    return null
  }
  const manifest = await loadManifest()
  return manifest.MANIFEST_STATS ?? null
}
