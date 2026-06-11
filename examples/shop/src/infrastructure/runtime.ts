import { singleton } from '@devcraft-ts/diadem'

/** Application configuration. */
export abstract class IConfig {
  abstract get(key: string): string
}

@singleton(IConfig)
export class Config extends IConfig {
  private readonly values = new Map<string, string>(
    Object.entries(process.env).filter(([, v]) => v !== undefined) as [
      string,
      string
    ][]
  )
  get(key: string): string {
    return this.values.get(key) ?? ''
  }
}

/** A clock, so time-dependent code stays testable. */
export abstract class IClock {
  abstract now(): number
}

@singleton(IClock)
export class SystemClock extends IClock {
  now(): number {
    return Date.now()
  }
}

/** Structured logger. */
export abstract class ILogger {
  abstract info(message: string): void
  abstract error(message: string): void
}

@singleton(ILogger)
export class Logger extends ILogger {
  constructor(private readonly config: IConfig) {
    super()
  }
  private get level(): string {
    return this.config.get('LOG_LEVEL') || 'info'
  }
  info(message: string): void {
    if (this.level !== 'silent') console.log(`[info] ${message}`)
  }
  error(message: string): void {
    console.error(`[error] ${message}`)
  }
}