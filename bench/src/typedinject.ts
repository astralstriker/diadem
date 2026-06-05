import { createInjector, Scope } from 'typed-inject'
import type { Framework } from './types'

// typed-inject: no decorators, no reflection. Dependencies declared via a
// static `inject` tuple; the compiler type-checks the whole graph.

class Config {
  static inject = [] as const
  value() {
    return 1
  }
}
class Clock {
  static inject = [] as const
  value() {
    return 2
  }
}
class Logger {
  static inject = ['config'] as const
  constructor(private c: Config) {}
  value() {
    return 4 + this.c.value()
  }
}
class Metrics {
  static inject = ['clock'] as const
  constructor(private c: Clock) {}
  value() {
    return 8 + this.c.value()
  }
}
class Db {
  static inject = ['config', 'logger'] as const
  constructor(
    private c: Config,
    private l: Logger
  ) {}
  value() {
    return 16 + this.c.value() + this.l.value()
  }
}
class Cache {
  static inject = ['config', 'metrics'] as const
  constructor(
    private c: Config,
    private m: Metrics
  ) {}
  value() {
    return 32 + this.c.value() + this.m.value()
  }
}
class UserRepo {
  static inject = ['db', 'logger'] as const
  constructor(
    private d: Db,
    private l: Logger
  ) {}
  value() {
    return 64 + this.d.value() + this.l.value()
  }
}
class OrderRepo {
  static inject = ['db', 'cache'] as const
  constructor(
    private d: Db,
    private ca: Cache
  ) {}
  value() {
    return 128 + this.d.value() + this.ca.value()
  }
}
class UserService {
  static inject = ['userRepo', 'logger'] as const
  constructor(
    private r: UserRepo,
    private l: Logger
  ) {}
  value() {
    return 256 + this.r.value() + this.l.value()
  }
}
class OrderService {
  static inject = ['orderRepo', 'userService', 'metrics'] as const
  constructor(
    private r: OrderRepo,
    private u: UserService,
    private m: Metrics
  ) {}
  value() {
    return 512 + this.r.value() + this.u.value() + this.m.value()
  }
}
class App {
  static inject = ['userService', 'orderService', 'logger'] as const
  constructor(
    private u: UserService,
    private o: OrderService,
    private l: Logger
  ) {}
  value() {
    return 1024 + this.u.value() + this.o.value() + this.l.value()
  }
}

function buildInjector() {
  return createInjector()
    .provideClass('config', Config, Scope.Singleton)
    .provideClass('clock', Clock, Scope.Singleton)
    .provideClass('logger', Logger, Scope.Singleton)
    .provideClass('metrics', Metrics, Scope.Singleton)
    .provideClass('db', Db, Scope.Singleton)
    .provideClass('cache', Cache, Scope.Singleton)
    .provideClass('userRepo', UserRepo, Scope.Singleton)
    .provideClass('orderRepo', OrderRepo, Scope.Singleton)
    .provideClass('userService', UserService, Scope.Singleton)
    .provideClass('orderService', OrderService, Scope.Singleton)
    .provideClass('app', App, Scope.Singleton)
}

export const typedInject: Framework = {
  name: 'typed-inject',
  cold: () => buildInjector().resolve('app'),
  makeHot: () => {
    const injector = buildInjector()
    injector.resolve('app')
    return () => injector.resolve('app')
  }
}
