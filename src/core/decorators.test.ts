import { describe, expect, it } from 'vitest'
import {
  factory,
  getDIMetadata,
  getDIRegistrationStats,
  hasDIMetadata,
  isClassRegisteredForEnvironment,
  lazy,
  lazySingleton,
  singleton
} from './decorators'

abstract class IService {
  abstract run(): void
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
    expect(getDIMetadata(F)?.lifecycle).toBe('factory')
    expect(getDIMetadata(L)?.lifecycle).toBe('lazy')
    expect(getDIMetadata(LS)?.lifecycle).toBe('lazySingleton')
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
    const stats = getDIRegistrationStats([A, B])
    expect(stats.total).toBe(2)
    expect(stats.singletons).toBe(1)
    expect(stats.factories).toBe(1)
    expect(stats.environments).toContain('test')
  })
})
