import { createContainerAsync } from './generated/container'
import { IAppConfig } from './infrastructure/config'
import { buildApp } from './app'

// Composition root. The only place that knows about the generated container;
// everything else receives dependencies.
const container = await createContainerAsync()
const config = container.resolve(IAppConfig)
const app = buildApp(container)

// Graceful shutdown: stop accepting connections, let in-flight requests
// finish (their scopes dispose via the onResponse hook), then tear down
// application singletons — the database closes last-in-first-out.
let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
    await container.dispose()
    process.exit(0)
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed')
    process.exit(1)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: config.port, host: config.host })
} catch (error) {
  app.log.error({ err: error }, 'failed to start')
  await container.dispose()
  process.exit(1)
}
