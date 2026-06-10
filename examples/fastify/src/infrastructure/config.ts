import { singleton } from '@devcraft-ts/diadem'

export type AppEnv = 'development' | 'production' | 'test'

/**
 * Typed, validated application configuration. Reading `process.env` happens
 * exactly once, here — every other service depends on this token instead of
 * touching the environment directly.
 */
export abstract class IAppConfig {
  abstract readonly env: AppEnv
  abstract readonly host: string
  abstract readonly port: number
  abstract readonly logLevel: string
}

@singleton(IAppConfig)
export class EnvConfig extends IAppConfig {
  readonly env: AppEnv
  readonly host: string
  readonly port: number
  readonly logLevel: string

  constructor() {
    super()
    const env = process.env.NODE_ENV
    this.env =
      env === 'production' || env === 'test' ? env : 'development'
    this.host = process.env.HOST ?? '0.0.0.0'
    this.port = Number(process.env.PORT ?? 3000)
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      throw new Error(`Invalid PORT: ${process.env.PORT}`)
    }
    this.logLevel =
      process.env.LOG_LEVEL ?? (this.env === 'production' ? 'info' : 'debug')
  }
}
