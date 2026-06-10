import { describe, expect, it } from 'vitest'
import {
  factory,
  getDIMetadata,
  getDIRegistrationStats,
  getProviderMetadata,
  hasDIMetadata,
  isClassRegisteredForEnvironment,
  lazy,
  lazySingleton,
  provider,
  provides,
  scoped,
  singleton
} from './decorators'

abstract class IService {
  abstract run(): void
}

abstract class IConfig {
  abstract get(k: string): string
}

abstract class IClient {
  abstract send(): void
}

describe('decorators', () => {
  it('attaches singleton metadata', () => {
    @singleton(IService)
    class S extends IService {
      run() {}
    }
    const meta = getDIMetadata(S)
    expect(meta).not.toBeNull()
    expect(meta?.lifecycle).toBe('singleton')
    expect(meta?.token).toBe(IService)
    expect(meta?.environment).toBeUndefined()
  })

  it('records lifecycle for each decorator', () => {
    @factory(IService)
    class F extends IService {
      run() {}
    }
    @lazy(IService)
    class L extends IService {
      run() {}
    }
    @lazySingleton(IService)
    class LS extends IService {
      run() {}
    }
    @scoped(IService)
    class RequestScoped extends IService {
      run() {}
    }
    expect(getDIMetadata(F)?.lifecycle).toBe('factory')
    expect(getDIMetadata(L)?.lifecycle).toBe('lazy')
    expect(getDIMetadata(LS)?.lifecycle).toBe('lazySingleton')
    expect(getDIMetadata(RequestScoped)?.lifecycle).toBe('scoped')
  })

  it('captures an environment filter', () => {
    @singleton(IService, 'production')
    class P extends IService {
      run() {}
    }
    expect(getDIMetadata(P)?.environment).toBe('production')
    expect(isClassRegisteredForEnvironment(P, 'production')).toBe(true)
    expect(isClassRegisteredForEnvironment(P, 'development')).toBe(false)
  })

  it('captures singleton binding options', () => {
    @singleton(IService, { multi: true, env: 'test' })
    class Plugin extends IService {
      run() {}
    }

    const meta = getDIMetadata(Plugin)
    expect(meta?.lifecycle).toBe('singleton')
    expect(meta?.multi).toBe(true)
    expect(meta?.environment).toBe('test')
  })

  it('treats env-less classes as available everywhere', () => {
    @singleton(IService)
    class Anywhere extends IService {
      run() {}
    }
    expect(isClassRegisteredForEnvironment(Anywhere, 'production')).toBe(true)
    expect(isClassRegisteredForEnvironment(Anywhere)).toBe(true)
  })

  it('hasDIMetadata distinguishes decorated from plain classes', () => {
    @singleton(IService)
    class Decorated extends IService {
      run() {}
    }
    class Plain {}
    expect(hasDIMetadata(Decorated)).toBe(true)
    expect(hasDIMetadata(Plain)).toBe(false)
    expect(getDIMetadata(Plain)).toBeNull()
  })

  it('aggregates registration stats', () => {
    @singleton(IService)
    class A extends IService {
      run() {}
    }
    @factory(IService, 'test')
    class B extends IService {
      run() {}
    }
    @scoped(IService)
    class C extends IService {
      run() {}
    }
    const stats = getDIRegistrationStats([A, B, C])
    expect(stats.total).toBe(3)
    expect(stats.singletons).toBe(1)
    expect(stats.factories).toBe(1)
    expect(stats.scoped).toBe(1)
    expect(stats.environments).toContain('test')
  })

  describe('providers', () => {
    it('collects @provides bindings from a @provider class', () => {
      @provider()
      class Integrations {
        @provides(IConfig)
        config(): IConfig {
          return { get: () => '' }
        }
        @provides(IClient, 'production')
        client(): IClient {
          return { send() {} }
        }
      }

      const entries = getProviderMetadata(Integrations)
      expect(entries).not.toBeNull()
      expect(entries).toHaveLength(2)
      const byMethod = Object.fromEntries(
        (entries ?? []).map((e) => [e.method, e])
      )
      expect(byMethod.config.token).toBe(IConfig)
      expect(byMethod.config.environment).toBeUndefined()
      expect(byMethod.client.token).toBe(IClient)
      expect(byMethod.client.environment).toBe('production')
    })

    it('returns null for a class that is not a @provider', () => {
      class Plain {}
      expect(getProviderMetadata(Plain)).toBeNull()
    })

    it('returns an empty list for a @provider with no @provides methods', () => {
      @provider()
      class Empty {}
      expect(getProviderMetadata(Empty)).toEqual([])
    })

    it('keeps @provides bindings per-class (no cross-class leakage)', () => {
      @provider()
      class A {
        @provides(IConfig)
        config(): IConfig {
          return { get: () => 'a' }
        }
      }
      @provider()
      class B {
        @provides(IClient)
        client(): IClient {
          return { send() {} }
        }
      }
      expect(getProviderMetadata(A)).toHaveLength(1)
      expect(getProviderMetadata(B)).toHaveLength(1)
      expect(getProviderMetadata(A)?.[0].token).toBe(IConfig)
      expect(getProviderMetadata(B)?.[0].token).toBe(IClient)
    })
  })
})
