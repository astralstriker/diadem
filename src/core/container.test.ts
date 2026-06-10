import { describe, expect, it } from 'vitest'
import { DiademContainer } from './container'

abstract class IGreeter {
  abstract greet(): string
}

class Greeter extends IGreeter {
  greet(): string {
    return 'hi'
  }
}

abstract class ICounter {
  abstract next(): number
}

describe('DiademContainer', () => {
  it('registers and resolves a direct value', () => {
    const c = new DiademContainer()
    const greeter = new Greeter()
    c.register(IGreeter, greeter)
    expect(c.resolve(IGreeter)).toBe(greeter)
  })

  it('caches singletons (one instance per container)', () => {
    const c = new DiademContainer()
    c.registerSingleton(IGreeter, () => new Greeter())
    expect(c.resolve(IGreeter)).toBe(c.resolve(IGreeter))
  })

  it('creates a fresh instance per resolve for factories', () => {
    const c = new DiademContainer()
    c.registerFactory(IGreeter, () => new Greeter())
    expect(c.resolve(IGreeter)).not.toBe(c.resolve(IGreeter))
  })

  it('resolves all multi-bindings in registration order', () => {
    class LoudGreeter extends IGreeter {
      greet(): string {
        return 'HI'
      }
    }

    const c = new DiademContainer()
    const quiet = new Greeter()
    const loud = new LoudGreeter()
    c.registerMulti(IGreeter, quiet)
    c.registerMulti(IGreeter, loud)

    expect(c.resolveAll(IGreeter)).toEqual([quiet, loud])
    expect(c.resolveAll(ICounter)).toEqual([])
    expect(c.has(IGreeter)).toBe(true)
  })

  it('throws a helpful error for an unregistered token', () => {
    const c = new DiademContainer()
    expect(() => c.resolve(IGreeter)).toThrowError(/Dependency not found: IGreeter/)
  })

  it('reports registration via has() and getRegisteredTokens()', () => {
    const c = new DiademContainer()
    c.register(IGreeter, new Greeter())
    expect(c.has(IGreeter)).toBe(true)
    expect(c.has(ICounter)).toBe(false)
    expect(c.getRegisteredTokens()).toContain(IGreeter)
  })

  it('tracks readiness', () => {
    const c = new DiademContainer()
    expect(c.isReady()).toBe(false)
    c.setReady()
    expect(c.isReady()).toBe(true)
  })

  it('clears all registrations', () => {
    const c = new DiademContainer()
    c.register(IGreeter, new Greeter())
    c.setReady()
    c.clear()
    expect(c.has(IGreeter)).toBe(false)
    expect(c.isReady()).toBe(false)
  })

  it('child containers inherit parent registrations', () => {
    const parent = new DiademContainer()
    const greeter = new Greeter()
    parent.register(IGreeter, greeter)
    const child = parent.createChild()
    expect(child.resolve(IGreeter)).toBe(greeter)
  })

  it('caches scoped services per request scope', () => {
    const parent = new DiademContainer()
    let made = 0
    parent.registerScoped(ICounter, () => ({
      next: () => ++made
    }))

    const requestA = parent.createRequestScope()
    const requestB = parent.createRequestScope()

    expect(requestA.resolve(ICounter)).toBe(requestA.resolve(ICounter))
    expect(requestB.resolve(ICounter)).toBe(requestB.resolve(ICounter))
    expect(requestA.resolve(ICounter)).not.toBe(requestB.resolve(ICounter))
  })

  it('does not inherit scoped instances already resolved by the parent', () => {
    const parent = new DiademContainer()
    parent.registerScoped(ICounter, () => ({ next: () => 1 }))

    const rootScoped = parent.resolve(ICounter)
    const request = parent.createRequestScope()

    expect(request.resolve(ICounter)).not.toBe(rootScoped)
  })

  it('resolves scoped dependencies from the active request scope', () => {
    abstract class IUsesCounter {
      abstract counter: ICounter
    }

    const parent = new DiademContainer()
    parent.registerScoped(ICounter, () => ({ next: () => 1 }))
    parent.registerScoped(IUsesCounter, (scope) => ({
      counter: scope.resolve(ICounter)
    }))

    const request = parent.createRequestScope()
    expect(request.resolve(IUsesCounter).counter).toBe(request.resolve(ICounter))
  })

  it('reports diagnostics counts', () => {
    const c = new DiademContainer()
    c.register(IGreeter, new Greeter())
    c.registerSingleton(ICounter, () => ({ next: () => 1 }))
    c.registerScoped(IGreeter, () => new Greeter())
    c.registerMulti(ICounter, { next: () => 2 })
    const d = c.getDiagnostics()
    expect(d.dependencies).toBe(1)
    expect(d.singletons).toBe(1)
    expect(d.factories).toBe(0)
    expect(d.scopedFactories).toBe(1)
    expect(d.multiBindings).toBe(1)
    expect(d.asyncFactories).toBe(0)
  })
})

abstract class IAsyncThing {
  abstract value(): number
}

describe('DiademContainer async resolution', () => {
  it('awaits an async factory on every resolveAsync', async () => {
    const c = new DiademContainer()
    let made = 0
    c.registerAsyncFactory(IAsyncThing, async () => {
      made++
      return { value: () => made }
    })
    const a = await c.resolveAsync(IAsyncThing)
    const b = await c.resolveAsync(IAsyncThing)
    expect(a).not.toBe(b)
    expect(made).toBe(2)
  })

  it('caches an async singleton (factory runs once)', async () => {
    const c = new DiademContainer()
    let calls = 0
    c.registerAsyncSingleton(IAsyncThing, async () => {
      calls++
      return { value: () => 42 }
    })
    const a = await c.resolveAsync(IAsyncThing)
    const b = await c.resolveAsync(IAsyncThing)
    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  it('resolveAsync also serves synchronously-registered tokens', async () => {
    const c = new DiademContainer()
    const greeter = new Greeter()
    c.register(IGreeter, greeter)
    await expect(c.resolveAsync(IGreeter)).resolves.toBe(greeter)
  })

  it('sync resolve() throws for an async-only token', () => {
    const c = new DiademContainer()
    c.registerAsyncFactory(IAsyncThing, async () => ({ value: () => 1 }))
    expect(() => c.resolve(IAsyncThing)).toThrowError(/resolveAsync/)
  })

  it('counts async factories and reports them via has()', () => {
    const c = new DiademContainer()
    c.registerAsyncFactory(IAsyncThing, async () => ({ value: () => 1 }))
    expect(c.has(IAsyncThing)).toBe(true)
    expect(c.getDiagnostics().asyncFactories).toBe(1)
  })
})

describe('DiademContainer disposal', () => {
  it('disposes Disposable singletons and runs disposers in reverse order', async () => {
    const c = new DiademContainer()
    const order: string[] = []

    c.registerSingleton(IGreeter, () => ({
      greet: () => 'hi',
      dispose: () => {
        order.push('singleton')
      }
    }))
    c.onDispose(() => {
      order.push('callback')
    })

    await c.dispose()
    // reverse registration order: callback registered last → runs first
    expect(order).toEqual(['callback', 'singleton'])
    expect(c.isDisposed()).toBe(true)
    expect(c.has(IGreeter)).toBe(false)
  })

  it('is idempotent', async () => {
    const c = new DiademContainer()
    let count = 0
    c.onDispose(() => {
      count++
    })
    await c.dispose()
    await c.dispose()
    expect(count).toBe(1)
  })

  it('awaits async disposers', async () => {
    const c = new DiademContainer()
    let done = false
    c.onDispose(async () => {
      await Promise.resolve()
      done = true
    })
    await c.dispose()
    expect(done).toBe(true)
  })

  it('does not dispose parent-owned instances when a child is disposed', async () => {
    const parent = new DiademContainer()
    let disposed = false
    parent.registerSingleton(IGreeter, () => ({
      greet: () => 'hi',
      dispose: () => {
        disposed = true
      }
    }))

    const child = parent.createChild()
    await child.dispose()

    expect(disposed).toBe(false)
    // parent still serves the shared instance
    expect(parent.resolve(IGreeter).greet()).toBe('hi')
  })
})
