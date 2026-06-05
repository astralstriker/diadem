import type { Framework } from './types'

// Hand-written wiring: the theoretical floor. No container, just `new`.

class Config {
  value() {
    return 1
  }
}
class Clock {
  value() {
    return 2
  }
}
class Logger {
  constructor(private c: Config) {}
  value() {
    return 4 + this.c.value()
  }
}
class Metrics {
  constructor(private c: Clock) {}
  value() {
    return 8 + this.c.value()
  }
}
class Db {
  constructor(
    private c: Config,
    private l: Logger
  ) {}
  value() {
    return 16 + this.c.value() + this.l.value()
  }
}
class Cache {
  constructor(
    private c: Config,
    private m: Metrics
  ) {}
  value() {
    return 32 + this.c.value() + this.m.value()
  }
}
class UserRepo {
  constructor(
    private d: Db,
    private l: Logger
  ) {}
  value() {
    return 64 + this.d.value() + this.l.value()
  }
}
class OrderRepo {
  constructor(
    private d: Db,
    private ca: Cache
  ) {}
  value() {
    return 128 + this.d.value() + this.ca.value()
  }
}
class UserService {
  constructor(
    private r: UserRepo,
    private l: Logger
  ) {}
  value() {
    return 256 + this.r.value() + this.l.value()
  }
}
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

function build(): App {
  const config = new Config()
  const clock = new Clock()
  const logger = new Logger(config)
  const metrics = new Metrics(clock)
  const db = new Db(config, logger)
  const cache = new Cache(config, metrics)
  const userRepo = new UserRepo(db, logger)
  const orderRepo = new OrderRepo(db, cache)
  const userService = new UserService(userRepo, logger)
  const orderService = new OrderService(orderRepo, userService, metrics)
  return new App(userService, orderService, logger)
}

export const vanilla: Framework = {
  name: 'vanilla (hand-written)',
  cold: () => build(),
  makeHot: () => {
    const root = build()
    return () => root
  }
}
