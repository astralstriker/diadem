/**
 * Enhanced Dependency Resolution Test
 *
 * This test verifies that the build-time dependency analysis and enhanced
 * dependency resolver are working correctly with real service dependencies.
 */

import { DiademContainer } from './container'
import { singleton } from './decorators'

// Mock interfaces for testing
abstract class ITestApiClient {
  abstract get(url: string): Promise<any>
}

abstract class ITestRepository {
  abstract findById(id: string): Promise<any>
}

abstract class ITestService {
  abstract process(data: any): Promise<any>
}

// Mock service implementations with dependencies

@singleton(ITestApiClient)
class TestApiClient implements ITestApiClient {
  async get(url: string): Promise<any> {
    return { data: `Mock data from ${url}`, success: true }
  }
}

@singleton(ITestRepository)
class TestRepository implements ITestRepository {
  constructor(private readonly apiClient: ITestApiClient) {}

  async findById(id: string): Promise<any> {
    const response = await this.apiClient.get(`/api/test/${id}`)
    return { id, ...response }
  }
}

@singleton(ITestService)
class TestService implements ITestService {
  constructor(
    private readonly repository: ITestRepository,
    private readonly apiClient: ITestApiClient
  ) {}

  async process(data: any): Promise<any> {
    const existing = await this.repository.findById(data.id)
    const external = await this.apiClient.get('/api/external')

    return {
      processed: true,
      existing,
      external,
      input: data
    }
  }
}

// Mock manifest entries for testing
const mockManifestEntries = [
  {
    className: 'TestApiClient',
    lifecycle: 'singleton' as const,
    importPath: 'test/mock',
    filePath: 'test/mock.ts',
    exported: true,
    registrationOrder: 0,
    dependencies: [],
    resolvedDependencies: []
  },
  {
    className: 'TestRepository',
    lifecycle: 'singleton' as const,
    importPath: 'test/mock',
    filePath: 'test/mock.ts',
    exported: true,
    registrationOrder: 1,
    dependencies: [
      {
        paramName: 'apiClient',
        paramIndex: 0,
        typeName: 'ITestApiClient',
        isOptional: false,
        isReadonly: true,
        isPrivate: true
      }
    ],
    resolvedDependencies: [
      {
        paramName: 'apiClient',
        paramIndex: 0,
        typeName: 'ITestApiClient',
        isOptional: false,
        isReadonly: true,
        isPrivate: true,
        implementingService: 'TestApiClient'
      }
    ]
  },
  {
    className: 'TestService',
    lifecycle: 'singleton' as const,
    importPath: 'test/mock',
    filePath: 'test/mock.ts',
    exported: true,
    registrationOrder: 2,
    dependencies: [
      {
        paramName: 'repository',
        paramIndex: 0,
        typeName: 'ITestRepository',
        isOptional: false,
        isReadonly: true,
        isPrivate: true
      },
      {
        paramName: 'apiClient',
        paramIndex: 1,
        typeName: 'ITestApiClient',
        isOptional: false,
        isReadonly: true,
        isPrivate: true
      }
    ],
    resolvedDependencies: [
      {
        paramName: 'repository',
        paramIndex: 0,
        typeName: 'ITestRepository',
        isOptional: false,
        isReadonly: true,
        isPrivate: true,
        implementingService: 'TestRepository'
      },
      {
        paramName: 'apiClient',
        paramIndex: 1,
        typeName: 'ITestApiClient',
        isOptional: false,
        isReadonly: true,
        isPrivate: true,
        implementingService: 'TestApiClient'
      }
    ]
  }
]

describe('Enhanced Dependency Resolution', () => {
  let container: DiademContainer

  beforeEach(() => {
    container = new DiademContainer()
  })

  describe('Build-time Dependency Analysis', () => {
    test('should register services in correct dependency order', async () => {
      // Import the enhanced dependency resolver
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      // Register services with manifest-based dependency resolution
      const result = await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      expect(result.registeredCount).toBe(3)
      expect(result.skippedCount).toBe(0)
      expect(result.warnings).toHaveLength(0)

      // Verify registration order - dependencies should be registered first
      expect(result.registrationOrder).toEqual([
        'TestApiClient', // No dependencies, registered first
        'TestRepository', // Depends on TestApiClient
        'TestService' // Depends on both TestApiClient and TestRepository
      ])
    })

    test('should analyze dependency statistics correctly', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      const result = await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      expect(result.dependencyStats).toEqual({
        totalServices: 3,
        servicesWithDependencies: 2, // TestRepository and TestService have dependencies
        totalDependencies: 3, // TestRepository has 1, TestService has 2
        externalDependencies: 0, // All dependencies are internal
        maxDependencyDepth: 2 // TestService has 2 dependencies
      })
    })
  })

  describe('Constructor Dependency Injection', () => {
    test('should inject dependencies correctly', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      // Register all services
      await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      // Resolve the service with dependencies
      const testService = container.resolve(ITestService)

      expect(testService).toBeInstanceOf(TestService)

      // Test that dependencies were injected correctly
      const result = await testService.process({
        id: 'test-123',
        data: 'sample'
      })

      expect(result.processed).toBe(true)
      expect(result.existing.id).toBe('test-123')
      expect(result.external.success).toBe(true)
      expect(result.input).toEqual({ id: 'test-123', data: 'sample' })
    })

    test('should maintain singleton behavior', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      // Resolve the same service multiple times
      const service1 = container.resolve(ITestService)
      const service2 = container.resolve(ITestService)
      const apiClient1 = container.resolve(ITestApiClient)
      const apiClient2 = container.resolve(ITestApiClient)

      // Should be the same instances (singleton behavior)
      expect(service1).toBe(service2)
      expect(apiClient1).toBe(apiClient2)
    })

    test('should handle nested dependencies correctly', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      const repository = container.resolve(ITestRepository)
      const service = container.resolve(ITestService)

      // Both should have access to the same ApiClient instance
      const repositoryResult = await repository.findById('test-id')
      const serviceResult = await service.process({
        id: 'test-id',
        data: 'test'
      })

      expect(repositoryResult).toBeDefined()
      expect(serviceResult.existing).toEqual(repositoryResult)
    })
  })

  describe('Error Handling', () => {
    test('should handle missing dependencies gracefully', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      // Try to register TestService without its dependencies
      const result = await registerServicesWithManifestDependencies(
        container,
        [TestService], // Missing TestApiClient and TestRepository
        mockManifestEntries.filter((entry) => entry.className === 'TestService')
      )

      expect(result.registeredCount).toBe(0)
      expect(result.skippedCount).toBe(1)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('Failed to register TestService')
    })

    test('should validate dependencies before registration', async () => {
      const { EnhancedDependencyResolver } =
        await import('./dependency-resolver')

      const resolver = new EnhancedDependencyResolver()

      // Test with incomplete manifest (missing TestApiClient)
      const incompleteManifest = mockManifestEntries.filter(
        (entry) => entry.className !== 'TestApiClient'
      )

      const validation = resolver.validateDependencies(incompleteManifest)

      expect(validation.valid).toBe(false)
      expect(validation.missingDependencies).toEqual(
        expect.arrayContaining([
          'TestRepository requires TestApiClient (ITestApiClient)',
          'TestService requires TestApiClient (ITestApiClient)'
        ])
      )
    })
  })

  describe('Performance and Efficiency', () => {
    test('should register services efficiently', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      const startTime = Date.now()

      const result = await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      const duration = Date.now() - startTime

      expect(result.registeredCount).toBe(3)
      expect(duration).toBeLessThan(100) // Should be very fast
    })

    test('should resolve services efficiently', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      const startTime = Date.now()

      // Resolve multiple services
      for (let i = 0; i < 100; i++) {
        container.resolve(ITestService)
        container.resolve(ITestRepository)
        container.resolve(ITestApiClient)
      }

      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(50) // Resolution should be very fast
    })
  })

  describe('Integration with Container Features', () => {
    test('should work with container diagnostics', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      const diagnostics = container.getDiagnostics()

      expect(diagnostics.singletons).toBe(3) // All registered as singletons
      expect(diagnostics.dependencies).toBe(0) // None registered as direct dependencies
      expect(diagnostics.factories).toBe(0) // None registered as factories
      expect(diagnostics.isReady).toBe(false) // Not marked ready yet
    })

    test('should work with token checking', async () => {
      const { registerServicesWithManifestDependencies } =
        await import('./dependency-resolver')

      await registerServicesWithManifestDependencies(
        container,
        [TestApiClient, TestRepository, TestService],
        mockManifestEntries
      )

      expect(container.has(ITestApiClient)).toBe(true)
      expect(container.has(ITestRepository)).toBe(true)
      expect(container.has(ITestService)).toBe(true)

      const tokens = container.getRegisteredTokens()
      expect(tokens).toContain(ITestApiClient)
      expect(tokens).toContain(ITestRepository)
      expect(tokens).toContain(ITestService)
    })
  })
})
