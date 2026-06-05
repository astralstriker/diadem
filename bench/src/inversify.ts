import { Container, inject, injectable } from 'inversify'
import type { Framework } from './types'

// inversify: @injectable + explicit @inject(identifier), runtime resolution.

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
  constructor(@inject(Config) private c: Config) {}
  value() {
    return 4 + this.c.value()
  }
}
@injectable()
class Metrics {
  constructor(@inject(Clock) private c: Clock) {}
  value() {
    return 8 + this.c.value()
  }
}
@injectable()
class Db {
  constructor(
    @inject(Config) private c: Config,
    @inject(Logger) private l: Logger
  ) {}
  value() {
    return 16 + this.c.value() + this.l.value()
  }
}
@injectable()
class Cache {
  constructor(
    @inject(Config) private c: Config,
    @inject(Metrics) private m: Metrics
  ) {}
  value() {
    return 32 + this.c.value() + this.m.value()
  }
}
@injectable()
class UserRepo {
  constructor(
    @inject(Db) private d: Db,
    @inject(Logger) private l: Logger
  ) {}
  value() {
    return 64 + this.d.value() + this.l.value()
  }
}
@injectable()
class OrderRepo {
  constructor(
    @inject(Db) private d: Db,
    @inject(Cache) private ca: Cache
  ) {}
  value() {
    return 128 + this.d.value() + this.ca.value()
  }
}
@injectable()
class UserService {
  constructor(
    @inject(UserRepo) private r: UserRepo,
    @inject(Logger) private l: Logger
  ) {}
  value() {
    return 256 + this.r.value() + this.l.value()
  }
}
@injectable()
class OrderService {
  constructor(
    @inject(OrderRepo) private r: OrderRepo,
    @inject(UserService) private u: UserService,
    @inject(Metrics) private m: Metrics
  ) {}
  value() {
    return 512 + this.r.value() + this.u.value() + this.m.value()
  }
}
@injectable()
class App {
  constructor(
    @inject(UserService) private u: UserService,
    @inject(OrderService) private o: OrderService,
    @inject(Logger) private l: Logger
  ) {}
  value() {
    return 1024 + this.u.value() + this.o.value() + this.l.value()
  }
}

const ALL: any[] = [
  Config, Clock, Logger, Metrics, Db, Cache,
  UserRepo, OrderRepo, UserService, OrderService, App
]

function makeContainer(): Container {
  const c = new Container()
  for (const Cls of ALL) {
    c.bind(Cls).toSelf().inSingletonScope()
  }
  return c
}

export const inversify: Framework = {
  name: 'inversify',
  cold: () => makeContainer().get(App),
  makeHot: () => {
    const c = makeContainer()
    c.get(App)
    return () => c.get(App)
  }
}
