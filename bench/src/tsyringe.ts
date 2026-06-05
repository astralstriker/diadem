import { container, injectable } from 'tsyringe'
import type { Framework } from './types'

// tsyringe reads constructor param types from reflect-metadata at runtime.

@injectable()
class Config {
  value() {
    return 1
  }
}
@injectable()
class Clock {
  value() {
    return 2
  }
}
@injectable()
class Logger {
  constructor(private c: Config) {}
  value() {
    return 4 + this.c.value()
  }
}
@injectable()
class Metrics {
  constructor(private c: Clock) {}
  value() {
    return 8 + this.c.value()
  }
}
@injectable()
class Db {
  constructor(
    private c: Config,
    private l: Logger
  ) {}
  value() {
    return 16 + this.c.value() + this.l.value()
  }
}
@injectable()
class Cache {
  constructor(
    private c: Config,
    private m: Metrics
  ) {}
  value() {
    return 32 + this.c.value() + this.m.value()
  }
}
@injectable()
class UserRepo {
  constructor(
    private d: Db,
    private l: Logger
  ) {}
  value() {
    return 64 + this.d.value() + this.l.value()
  }
}
@injectable()
class OrderRepo {
  constructor(
    private d: Db,
    private ca: Cache
  ) {}
  value() {
    return 128 + this.d.value() + this.ca.value()
  }
}
@injectable()
class UserService {
  constructor(
    private r: UserRepo,
    private l: Logger
  ) {}
  value() {
    return 256 + this.r.value() + this.l.value()
  }
}
@injectable()
class OrderService {
  constructor(
    private r: OrderRepo,
    private u: UserService,
    private m: Metrics
  ) {}
  value() {
    return 512 + this.r.value() + this.u.value() + this.m.value()
  }
}
@injectable()
class App {
  constructor(
    private u: UserService,
    private o: OrderService,
    private l: Logger
  ) {}
  value() {
    return 1024 + this.u.value() + this.o.value() + this.l.value()
  }
}

const ALL: any[] = [
  Config, Clock, Logger, Metrics, Db, Cache,
  UserRepo, OrderRepo, UserService, OrderService, App
]

function build() {
  // Fresh child container so singletons are constructed from scratch.
  const c = container.createChildContainer()
  for (const Cls of ALL) {
    c.registerSingleton(Cls)
  }
  return c.resolve<App>(App)
}

export const tsyringe: Framework = {
  name: 'tsyringe',
  cold: () => build(),
  makeHot: () => {
    const c = container.createChildContainer()
    for (const Cls of ALL) {
      c.registerSingleton(Cls)
    }
    c.resolve<App>(App)
    return () => c.resolve<App>(App)
  }
}
