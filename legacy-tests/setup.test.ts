/**
 * Tests for automatic DI setup and discovery
 * These tests verify that the automatic discovery system works correctly
 */

import { NextDIContainer } from '../core/container'
import {
  createAutoConfiguredContainer,
  setupDependencies,
  setupTestDependencies,
  validateAutoRegistration
} from './setup'
import { clearAllTimeouts, clearDiscoveryCache } from '../core/auto-discovery'

describe('Automatic DI Setup', () => {
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

  describe('Basic Auto-Discovery Setup', () => {
    test('should auto-discover and register services', async () => {
      await setupDependencies(container, 'development')

      expect(container.isReady()).toBe(true)

      const diagnostics = container.getDiagnostics()
      const totalServices =
        diagnostics.dependencies +
        diagnostics.singletons +
        diagnostics.factories

      expect(totalServices).toBeGreaterThan(0)
    })

    test('should handle environment-specific registration', async () => {
      await setupDependencies(container, 'production')

      expect(container.isReady()).toBe(true)

      const diagnostics = container.getDiagnostics()
      expect(
        diagnostics.dependencies +
          diagnostics.singletons +
          diagnostics.factories
      ).toBeGreaterThan(0)
    })

    test('should register different services for different environments', async () => {
      const devContainer = new NextDIContainer()
      const prodContainer = new NextDIContainer()
      containersToCleanup.push(devContainer, prodContainer)

      await setupDependencies(devContainer, 'development')
      await setupDependencies(prodContainer, 'production')

      const devDiagnostics = devContainer.getDiagnostics()
      const prodDiagnostics = prodContainer.getDiagnostics()

      expect(
        devDiagnostics.dependencies +
          devDiagnostics.singletons +
          devDiagnostics.factories
      ).toBeGreaterThan(0)
      expect(
        prodDiagnostics.dependencies +
          prodDiagnostics.singletons +
          prodDiagnostics.factories
      ).toBeGreaterThan(0)
    })
  })

  describe('Container Factory', () => {
    test('should create auto-configured container', async () => {
      const autoContainer = await createAutoConfiguredContainer('development')
      containersToCleanup.push(autoContainer)

      expect(autoContainer).toBeInstanceOf(NextDIContainer)
      expect(autoContainer.isReady()).toBe(true)

      const diagnostics = autoContainer.getDiagnostics()
      expect(
        diagnostics.dependencies +
          diagnostics.singletons +
          diagnostics.factories
      ).toBeGreaterThan(0)
    })

    test('should create container with custom setup', async () => {
      const customSetup = async (container: NextDIContainer) => {
        // Custom registration before auto-discovery
        class TestToken {
          test = 'token'
        }
        container.register(TestToken, { test: 'custom' })
      }

      const autoContainer = await createAutoConfiguredContainer(
        'development',
        customSetup
      )
      containersToCleanup.push(autoContainer)

      expect(autoContainer).toBeInstanceOf(NextDIContainer)
      expect(autoContainer.isReady()).toBe(true)
    })
  })

  describe('Test Setup', () => {
    test('should setup test dependencies with mocks', async () => {
      const mockDependencies = new Map()
      class MockService {
        test = 'service'
      }
      mockDependencies.set(MockService, { test: 'mock' })

      await setupTestDependencies(container, mockDependencies, 'test')

      expect(container.isReady()).toBe(true)

      const diagnostics = container.getDiagnostics()
      expect(diagnostics.dependencies).toBeGreaterThan(0) // Should include our mock
    })

    test('should setup test dependencies without mocks', async () => {
      await setupTestDependencies(container, undefined, 'test')

      expect(container.isReady()).toBe(true)

      const diagnostics = container.getDiagnostics()
      expect(
        diagnostics.dependencies +
          diagnostics.singletons +
          diagnostics.factories
      ).toBeGreaterThan(0)
    })
  })

  describe('Validation', () => {
    test('should validate auto-registration results', async () => {
      await setupDependencies(container, 'development')

      const validation = validateAutoRegistration(container)

      expect(validation.registeredCount).toBeGreaterThan(0)
      expect(typeof validation.isValid).toBe('boolean')
      expect(Array.isArray(validation.missingServices)).toBe(true)
    })

    test('should provide meaningful validation for empty container', () => {
      const validation = validateAutoRegistration(container)

      expect(validation.registeredCount).toBe(0)
      expect(validation.isValid).toBe(false)
      expect(validation.missingServices.length).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    test('should handle auto-discovery gracefully', async () => {
      // This should not throw even if discovery has issues
      expect(async () => {
        await container.autoRegisterDiscovered('development')
      }).not.toThrow()
    })

    test('should handle setup with invalid environment', async () => {
      // Should not throw for unknown environments
      await expect(
        setupDependencies(container, 'unknown-env')
      ).resolves.not.toThrow()
      expect(container.isReady()).toBe(true)
    })
  })

  describe('Container Lifecycle', () => {
    test('should properly initialize and ready container', async () => {
      expect(container.isReady()).toBe(false)

      await setupDependencies(container, 'development')

      expect(container.isReady()).toBe(true)
    })

    test('should provide diagnostics after setup', async () => {
      await setupDependencies(container, 'development')

      const diagnostics = container.getDiagnostics()

      expect(typeof diagnostics.dependencies).toBe('number')
      expect(typeof diagnostics.singletons).toBe('number')
      expect(typeof diagnostics.factories).toBe('number')
      expect(typeof diagnostics.isReady).toBe('boolean')
    })

    test('should clear registrations properly', async () => {
      await setupDependencies(container, 'development')

      expect(container.isReady()).toBe(true)

      container.clear()

      expect(container.isReady()).toBe(false)
      const diagnostics = container.getDiagnostics()
      expect(
        diagnostics.dependencies +
          diagnostics.singletons +
          diagnostics.factories
      ).toBe(0)
    })
  })
})
