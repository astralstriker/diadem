import { singleton } from '@devcraft-ts/diadem'

export abstract class IConfig {
  abstract value(): number
}
@singleton(IConfig)
export class Config extends IConfig {
  value() {
    return 1
  }
}

export abstract class IClock {
  abstract value(): number
}
@singleton(IClock)
export class Clock extends IClock {
  value() {
    return 2
  }
}

export abstract class ILogger {
  abstract value(): number
}
@singleton(ILogger)
export class Logger extends ILogger {
  constructor(private c: IConfig) {
    super()
  }
  value() {
    return 4 + this.c.value()
  }
}

export abstract class IMetrics {
  abstract value(): number
}
@singleton(IMetrics)
export class Metrics extends IMetrics {
  constructor(private c: IClock) {
    super()
  }
  value() {
    return 8 + this.c.value()
  }
}

export abstract class IDb {
  abstract value(): number
}
@singleton(IDb)
export class Db extends IDb {
  constructor(
    private c: IConfig,
    private l: ILogger
  ) {
    super()
  }
  value() {
    return 16 + this.c.value() + this.l.value()
  }
}

export abstract class ICache {
  abstract value(): number
}
@singleton(ICache)
export class Cache extends ICache {
  constructor(
    private c: IConfig,
    private m: IMetrics
  ) {
    super()
  }
  value() {
    return 32 + this.c.value() + this.m.value()
  }
}

export abstract class IUserRepo {
  abstract value(): number
}
@singleton(IUserRepo)
export class UserRepo extends IUserRepo {
  constructor(
    private d: IDb,
    private l: ILogger
  ) {
    super()
  }
  value() {
    return 64 + this.d.value() + this.l.value()
  }
}

export abstract class IOrderRepo {
  abstract value(): number
}
@singleton(IOrderRepo)
export class OrderRepo extends IOrderRepo {
  constructor(
    private d: IDb,
    private ca: ICache
  ) {
    super()
  }
  value() {
    return 128 + this.d.value() + this.ca.value()
  }
}

export abstract class IUserService {
  abstract value(): number
}
@singleton(IUserService)
export class UserService extends IUserService {
  constructor(
    private r: IUserRepo,
    private l: ILogger
  ) {
    super()
  }
  value() {
    return 256 + this.r.value() + this.l.value()
  }
}

export abstract class IOrderService {
  abstract value(): number
}
@singleton(IOrderService)
export class OrderService extends IOrderService {
  constructor(
    private r: IOrderRepo,
    private u: IUserService,
    private m: IMetrics
  ) {
    super()
  }
  value() {
    return 512 + this.r.value() + this.u.value() + this.m.value()
  }
}

export abstract class IApp {
  abstract value(): number
}
@singleton(IApp)
export class App extends IApp {
  constructor(
    private u: IUserService,
    private o: IOrderService,
    private l: ILogger
  ) {
    super()
  }
  value() {
    return 1024 + this.u.value() + this.o.value() + this.l.value()
  }
}
