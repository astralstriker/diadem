import { lazySingleton } from '@devcraft-ts/diadem'
import { IConfig, ILogger } from './runtime'

/**
 * Database connection. Registered as a `lazySingleton` so the connection isn't
 * opened until something actually needs it.
 */
export abstract class IDatabase {
  abstract query<T>(sql: string, params?: unknown[]): T[]
}

@lazySingleton(IDatabase)
export class Database extends IDatabase {
  constructor(
    private readonly config: IConfig,
    private readonly logger: ILogger
  ) {
    super()
    this.logger.info(`connecting to ${this.config.get('DATABASE_URL')}`)
  }

  query<T>(sql: string, _params?: unknown[]): T[] {
    this.logger.info(`query: ${sql}`)
    return []
  }
}
