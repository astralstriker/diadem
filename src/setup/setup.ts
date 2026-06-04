import type { Constructor } from '../core/container'
import { DiademContainer } from '../core/container'
import { getLogger } from '../core/logger'

/**
 * Auto-registration based dependency setup that uses decorated classes.
 * This replaces the manual setup functions with automatic discovery and registration.
 *
 * @param container The DI container instance to configure
 * @param environment Optional environment filter for environment-specific services
 */
export async function setupDependencies(
  container: DiademContainer,
  environment?: string
): Promise<void> {
  // Auto-register all decorated services using manifest-based discovery
  await container.autoRegisterDiscovered(environment)

  // Mark container as ready for use
  container.setReady()
}

/**
 * Auto-registration setup for testing environments.
 * Allows for custom dependency mocking while using auto-registration for the rest.
 *
 * @param container The DI container instance to configure
 * @param mockDependencies Optional map of tokens to mock implementations
 * @param environment Optional environment filter
 */
export async function setupTestDependencies(
  container: DiademContainer,
  mockDependencies?: Map<Constructor<unknown>, unknown>,
  environment?: string
): Promise<void> {
  // Register mock dependencies first (they take precedence)
  if (mockDependencies) {
    mockDependencies.forEach((implementation, token) => {
      container.register(token, implementation)
    })
  }

  // Auto-register remaining services using manifest-based discovery
  await container.autoRegisterDiscovered(environment)

  container.setReady()
}

/**
 * Auto-registration setup for development environment with debugging.
 *
 * @param container The DI container instance to configure
 */
export async function setupDevelopmentDependencies(
  container: DiademContainer
): Promise<void> {
  // Auto-register all services for development using manifest-based discovery
  await container.autoRegisterDiscovered('development')

  // Log diagnostics in development
  if (process.env.NODE_ENV === 'development') {
    const diagnostics = container.getDiagnostics()
    getLogger().info('DI Container Auto-Registration Diagnostics:', diagnostics)

    // Log discovered services
    const stats = container.getDiagnostics()
    getLogger().info(
      `Registered ${stats.dependencies + stats.singletons + stats.factories + stats.asyncFactories} services automatically`
    )
  }

  container.setReady()
}

/**
 * Auto-registration setup for production environment.
 *
 * @param container The DI container instance to configure
 */
export async function setupProductionDependencies(
  container: DiademContainer
): Promise<void> {
  // Auto-register all services for production using manifest-based discovery
  await container.autoRegisterDiscovered('production')

  container.setReady()
}

/**
 * Create a fully configured container using auto-registration.
 * This is the recommended way to create containers with the new decorator system.
 *
 * @param environment The environment to configure for ('development', 'production', 'test', etc.)
 * @param customSetup Optional custom setup function that runs before auto-registration
 * @returns A fully configured and ready container
 */
export async function createAutoConfiguredContainer(
  environment: string,
  customSetup?: (container: DiademContainer) => Promise<void>
): Promise<DiademContainer> {
  const container = new DiademContainer()

  // Run custom setup first if provided
  if (customSetup) {
    await customSetup(container)
  }

  // Auto-register core services using manifest-based discovery
  await container.autoRegisterDiscovered(environment)
  container.setReady()

  return container
}

/**
 * Validate that the expected services are registered after auto-registration.
 * Useful for debugging and asserting setup in application bootstrap code.
 *
 * @param container The container to validate
 * @param expectedServices Class names the application expects to be registered.
 *   Each is matched as a substring against registered token names. Defaults to
 *   an empty list (validation passes), since the set of services is
 *   application-specific.
 * @returns Object with validation results
 */
export function validateAutoRegistration(
  container: DiademContainer,
  expectedServices: string[] = []
): {
  isValid: boolean
  missingServices: string[]
  registeredCount: number
} {
  const diagnostics = container.getDiagnostics()
  const totalRegistered =
    diagnostics.dependencies +
    diagnostics.singletons +
    diagnostics.factories +
    diagnostics.asyncFactories

  const registeredTokens = container.getRegisteredTokens()
  const registeredNames = registeredTokens.map((token) => token.name)

  const missingServices = expectedServices.filter(
    (serviceName) => !registeredNames.some((name) => name.includes(serviceName))
  )

  return {
    isValid: missingServices.length === 0,
    missingServices,
    registeredCount: totalRegistered
  }
}

// Backward compatibility aliases (keep the Auto suffix for existing code)
export const setupDependenciesAuto = setupDependencies
export const setupTestDependenciesAuto = setupTestDependencies
export const setupDevelopmentDependenciesAuto = setupDevelopmentDependencies
export const setupProductionDependenciesAuto = setupProductionDependencies
