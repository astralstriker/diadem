import { asyncSingleton, type Disposable } from '@devcraft-ts/diadem'
import { ILogger } from './logger'

/**
 * Database connection. In-memory here so the example runs with zero external
 * infrastructure, but it follows the full lifecycle of a real pool:
 *
 * - `@asyncSingleton` + `async onInit()` → the generated container awaits the
 *   connection before the app starts (`createContainerAsync`).
 * - `Disposable` → `container.dispose()` closes it on graceful shutdown,
 *   after in-flight requests have drained.
 * - `/health/ready` calls `ping()` so the readiness probe reflects it.
 */
export abstract class IDatabase {
  abstract collection<T>(name: string): Map<string, T>
  abstract ping(): Promise<boolean>
}

@asyncSingleton(IDatabase)
export class InMemoryDatabase extends IDatabase implements Disposable {
  private connected = false
  private readonly collections = new Map<string, Map<string, unknown>>()

  constructor(private readonly logger: ILogger) {
    super()
  }

  /** Awaited by the generated container — stands in for `pool.connect()`. */
  async onInit(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10))
    this.connected = true
    this.logger.info('database connected')
  }

  collection<T>(name: string): Map<string, T> {
    if (!this.connected) {
      throw new Error('Database is not connected')
    }
    let store = this.collections.get(name)
    if (!store) {
      store = new Map()
      this.collections.set(name, store)
    }
    return store as Map<string, T>
  }

  async ping(): Promise<boolean> {
    return this.connected
  }

  async dispose(): Promise<void> {
    this.connected = false
    this.collections.clear()
    this.logger.info('database connection closed')
  }
}
