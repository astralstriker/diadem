/**
 * Diadem — main entry point.
 *
 * A build-time, manifest-driven DI container. SSR-safe and framework-agnostic:
 * registration metadata lives on classes, never in global state.
 *
 * ```typescript
 * import {
 *   DiademContainer,
 *   configureManifest,
 *   singleton,
 *   factory
 * } from 'diadem'
 * import * as manifest from './generated/service-manifest'
 *
 * configureManifest(manifest)
 * const container = new DiademContainer()
 * await container.autoRegisterDiscovered(process.env.NODE_ENV)
 * const service = container.resolve(IMyService)
 * ```
 */

// Core DI functionality (container, decorators, manifest contract, logging).
// Setup helpers live at 'diadem/setup'.
export * from './core'

/**
 * Version and metadata
 */
export const DI_VERSION = '0.1.0'

export const DI_FEATURES = [
  'type-safe',
  'ssr-safe',
  'decorator-driven',
  'auto-registration',
  'environment-aware',
  'server-safe',
  'no-global-state',
  'metadata-based',
  'zero-dependencies'
] as const
