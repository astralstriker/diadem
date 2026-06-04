/**
 * Setup helpers — environment-aware container factories and validation.
 *
 * @example
 * ```ts
 * import { createAutoConfiguredContainer } from 'diadem/setup'
 *
 * const container = await createAutoConfiguredContainer(process.env.NODE_ENV)
 * const service = container.resolve(IMyService)
 * ```
 */

import type { DiademContainer } from '../core/container'
import { getLogger } from '../core/logger'

export {
  createAutoConfiguredContainer,
  setupDependencies,
  setupDependenciesAuto,
  setupDevelopmentDependencies,
  setupDevelopmentDependenciesAuto,
  setupProductionDependencies,
  setupProductionDependenciesAuto,
  setupTestDependencies,
  setupTestDependenciesAuto,
  validateAutoRegistration
} from './setup'

/**
 * Log a one-line summary of a container's registrations through the active
 * logger (silent unless a logger is configured). Intended for development
 * bootstrap diagnostics.
 */
export function logSetupInfo(container: DiademContainer): void {
  const diagnostics = container.getDiagnostics()
  const total =
    diagnostics.dependencies +
    diagnostics.singletons +
    diagnostics.factories +
    diagnostics.asyncFactories

  getLogger().info('Diadem container setup', {
    ...diagnostics,
    total,
    tokens: container.getRegisteredTokens().map((token) => token.name)
  })
}
