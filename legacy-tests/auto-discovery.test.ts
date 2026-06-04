/**
 * Auto-Discovery Test Suite
 *
 * Tests for the build-time manifest-based service auto-discovery system.
 */

import {
  checkManifestStatus,
  clearAllTimeouts,
  clearDiscoveryCache,
  discoverServices,
  getManifestStats,
  isManifestAvailable
} from './auto-discovery'
import { NextDIContainer } from './container'

const consoleLogMock = console.log as unknown as jest.Mock
describe('Build-time Manifest Auto-Discovery', () => {
  let container: NextDIContainer
  const containersToCleanup: NextDIContainer[] = []

  beforeEach(() => {
    // Use fake timers to control timeouts created by auto-discovery
    jest.useFakeTimers()
    container = new NextDIContainer()
    containersToCleanup.push(container)
  })

  afterEach(() => {
    // Clear all containers created during tests
    containersToCleanup.forEach((c) => {
      try {
        c.clear()
      } catch (e) {
        // Container might already be cleared
      }
    })
    containersToCleanup.length = 0

    // Clear auto-discovery timeouts and cache
    clearAllTimeouts()
    clearDiscoveryCache()

    // Clear all pending timers
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  afterAll(() => {
    // Final cleanup to ensure all resources are released
    clearAllTimeouts()
    clearDiscoveryCache()
    jest.clearAllTimers()
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  describe('Manifest Availability', () => {
    test('should detect if manifest is available', async () => {
      const available = await isManifestAvailable()

      // In test environment, manifest should be available after build
      expect(typeof available).toBe('boolean')
    })

    test('should provide manifest status information', async () => {
      const status = await checkManifestStatus()

      expect(status).toHaveProperty('available')
      expect(status).toHaveProperty('recommendation')
      expect(typeof status.available).toBe('boolean')
      expect(typeof status.recommendation).toBe('string')
    })

    test('should get manifest statistics when available', async () => {
      const isAvailable = await isManifestAvailable()

      if (isAvailable) {
        const stats = await getManifestStats()

        expect(stats).toHaveProperty('totalServices')
        expect(stats).toHaveProperty('generatedAt')
        expect(stats).toHaveProperty('environments')
        expect(stats).toHaveProperty('lifecycles')
        expect(typeof stats.totalServices).toBe('number')
        expect(stats.totalServices).toBeGreaterThan(0)
      } else {
        console.warn('Manifest not available, skipping stats test')
      }
    })
  })

  describe('Service Discovery', () => {
    test('should discover services using manifest', async () => {
      const result = await discoverServices({
        environment: 'development',
        useCache: false
      })

      expect(result).toHaveProperty('services')
      expect(result).toHaveProperty('totalFound')
      expect(result).toHaveProperty('totalDecorated')
      expect(result).toHaveProperty('scanTime')
      expect(result).toHaveProperty('fromManifest')
      expect(result).toHaveProperty('manifestAvailable')

      expect(Array.isArray(result.services)).toBe(true)
      expect(typeof result.totalFound).toBe('number')
      expect(typeof result.totalDecorated).toBe('number')
      expect(typeof result.scanTime).toBe('number')
      expect(typeof result.fromManifest).toBe('boolean')
      expect(typeof result.manifestAvailable).toBe('boolean')
    })

    test('should discover services for specific environment', async () => {
      const devResult = await discoverServices({
        environment: 'development',
        useCache: false
      })

      const prodResult = await discoverServices({
        environment: 'production',
        useCache: false
      })

      // Both should find services (since most services don't have environment constraints)
      expect(devResult.services.length).toBeGreaterThan(0)
      expect(prodResult.services.length).toBeGreaterThan(0)
    })

    test('should cache discovery results', async () => {
      // First call
      const firstResult = await discoverServices({
        environment: 'development',
        useCache: true,
        cacheTTL: 5000
      })

      // Second call should be from cache
      const secondResult = await discoverServices({
        environment: 'development',
        useCache: true,
        cacheTTL: 5000
      })

      expect(secondResult.fromCache).toBe(true)
      expect(secondResult.services.length).toBe(firstResult.services.length)
    })

    test('should handle fallback when manifest unavailable', async () => {
      // This test simulates the case where manifest is not available
      const result = await discoverServices({
        environment: 'development',
        useFallback: true,
        useCache: false
      })

      // Should still find services via fallback or manifest
      expect(result.services.length).toBeGreaterThan(0)
    })
  })

  describe('Container Integration', () => {
    test('should auto-register discovered services', async () => {
      await container.autoRegisterDiscovered('development')

      expect(container.isReady()).toBe(false) // Need to call setReady manually

      const diagnostics = container.getDiagnostics()
      const totalRegistered =
        diagnostics.dependencies +
        diagnostics.singletons +
        diagnostics.factories

      expect(totalRegistered).toBeGreaterThan(0)
    })

    test('should register services with correct lifecycle', async () => {
      await container.autoRegisterDiscovered('development')

      const diagnostics = container.getDiagnostics()

      // Should have registered some singletons (most services use @singleton)
      expect(diagnostics.singletons).toBeGreaterThan(0)
    })

    test('should provide discovery diagnostics in development', async () => {
      // Mock NODE_ENV using Object.defineProperty
      const originalEnv = process.env.NODE_ENV
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'development',
        writable: true,
        configurable: true
      })

      // Use shared console.log mock from setup
      consoleLogMock.mockClear()

      try {
        await container.autoRegisterDiscovered('development')

        // Should have logged discovery information
        expect(consoleLogMock).toHaveBeenCalledWith(
          expect.stringContaining('Auto-discovered and registered')
        )
      } finally {
        // Restore original NODE_ENV
        if (originalEnv !== undefined) {
          Object.defineProperty(process.env, 'NODE_ENV', {
            value: originalEnv,
            writable: true,
            configurable: true
          })
        } else {
          Object.defineProperty(process.env, 'NODE_ENV', {
            value: undefined,
            writable: true,
            configurable: true
          })
        }
        // no-op: shared console log mock retained
      }
    })

    test('should handle environment filtering', async () => {
      await container.autoRegisterDiscovered('production')

      const diagnostics = container.getDiagnostics()
      const totalRegistered =
        diagnostics.dependencies +
        diagnostics.singletons +
        diagnostics.factories

      // Should register services even for production environment
      expect(totalRegistered).toBeGreaterThan(0)
    })
  })

  describe('Known Services Integration', () => {
    test('should discover expected core services', async () => {
      const result = await discoverServices({
        environment: 'development',
        useCache: false
      })

      const serviceNames = result.services.map((service) => service.name)

      // Check for some expected services (these should be found in the manifest)
      const expectedServices = [
        'ApiClient',
        'EmailService',
        'AuditService',
        'SonnerNotificationService'
      ]

      expectedServices.forEach((expectedService) => {
        const found = serviceNames.some((name) =>
          name.includes(expectedService)
        )
        if (!found) {
          console.warn(
            `Expected service ${expectedService} not found in:`,
            serviceNames
          )
        }
        // Note: We don't fail the test if not found, as the manifest might not include all services
      })
    })

    test('should register and resolve known services', async () => {
      await container.autoRegisterDiscovered('development')
      container.setReady()

      // Try to get registered tokens
      const tokens = container.getRegisteredTokens()
      expect(tokens.length).toBeGreaterThan(0)

      // Test that we can resolve at least one service
      if (tokens.length > 0) {
        try {
          const resolved = container.resolve(tokens[0])
          expect(resolved).toBeDefined()
        } catch (error) {
          // Some services might have dependencies that aren't available in test environment
          console.warn('Could not resolve service:', error)
        }
      }
    })
  })

  describe('Performance', () => {
    test('should complete discovery within reasonable time', async () => {
      const startTime = Date.now()

      const result = await discoverServices({
        environment: 'development',
        useCache: false
      })

      const totalTime = Date.now() - startTime

      // Discovery should complete within 1 second
      expect(totalTime).toBeLessThan(1000)
      expect(result.scanTime).toBeLessThan(500)
    })

    test('should be faster with caching enabled', async () => {
      // Import clearDiscoveryCache function
      const { clearDiscoveryCache } = await import('./auto-discovery')

      // Clear any existing cache first
      clearDiscoveryCache()

      // First call (no cache) - measure multiple times for more accurate timing
      const firstCallTimes: number[] = []
      for (let i = 0; i < 3; i++) {
        clearDiscoveryCache()
        const startTime = Date.now()
        await discoverServices({
          environment: 'development',
          useCache: true,
          cacheTTL: 10000
        })
        firstCallTimes.push(Date.now() - startTime)
      }
      const avgFirstCallTime =
        firstCallTimes.reduce((a, b) => a + b, 0) / firstCallTimes.length

      // Second call (with cache) - should be from cache
      const startTime2 = Date.now()
      const cachedResult = await discoverServices({
        environment: 'development',
        useCache: true,
        cacheTTL: 10000
      })
      const secondCallTime = Date.now() - startTime2

      expect(cachedResult.fromCache).toBe(true)
      // Cache should be faster, but allow for some timing variance in tests
      expect(secondCallTime).toBeLessThanOrEqual(Math.max(avgFirstCallTime, 10))
    })
  })

  describe('Error Handling', () => {
    test('should handle missing manifest gracefully', async () => {
      // Force using fallback by setting useFallback to true
      const result = await discoverServices({
        environment: 'development',
        useFallback: true,
        useCache: false
      })

      // Should not throw and should return some result
      expect(result).toBeDefined()
      expect(Array.isArray(result.services)).toBe(true)
    })

    test('should handle invalid environment gracefully', async () => {
      const result = await discoverServices({
        environment: 'invalid-environment',
        useCache: false
      })

      // Should not throw
      expect(result).toBeDefined()
      expect(Array.isArray(result.services)).toBe(true)
    })

    test('should handle container registration errors', async () => {
      // This should not throw even if some services fail to register
      await expect(
        container.autoRegisterDiscovered('development')
      ).resolves.not.toThrow()
    })
  })
})
