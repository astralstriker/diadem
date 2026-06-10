import { singleton } from '@devcraft-ts/diadem'
import { pino, type Logger as PinoInstance } from 'pino'
import { IAppConfig } from './config'

/**
 * Structured logger. The container owns the root pino instance and Fastify is
 * handed the same instance (`loggerInstance` in app.ts), so framework logs and
 * service logs flow through one pipeline with one configuration.
 */
export abstract class ILogger {
  /** Root pino instance — passed to Fastify so there is a single log pipeline. */
  abstract readonly root: PinoInstance
  abstract debug(message: string, context?: object): void
  abstract info(message: string, context?: object): void
  abstract warn(message: string, context?: object): void
  abstract error(message: string, context?: object): void
}

@singleton(ILogger)
export class PinoLogger extends ILogger {
  readonly root: PinoInstance

  constructor(config: IAppConfig) {
    super()
    this.root = pino({ level: config.logLevel })
  }

  debug(message: string, context: object = {}): void {
    this.root.debug(context, message)
  }

  info(message: string, context: object = {}): void {
    this.root.info(context, message)
  }

  warn(message: string, context: object = {}): void {
    this.root.warn(context, message)
  }

  error(message: string, context: object = {}): void {
    this.root.error(context, message)
  }
}
