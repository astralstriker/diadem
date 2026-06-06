/**
 * Composition root for the shop example.
 *
 * Workflow:
 *   1. npx diadem build            # generates ./generated/service-manifest.ts
 *   2. run this file
 *
 * Or visualize the graph without building anything:
 *   npx diadem graph --cwd examples/shop --scan-dir . --out graph.html
 */
import { DiademContainer, configureManifest, setLogger, consoleLogger } from '@devcraft-ts/diadem'
import * as manifest from './generated/service-manifest'
import { IShopApp } from './app'

async function main(): Promise<void> {
  setLogger(consoleLogger) // opt into diadem's own diagnostics
  configureManifest(manifest)

  const env = process.env.NODE_ENV ?? 'development'
  const container = new DiademContainer()
  await container.autoRegisterDiscovered(env)
  container.setReady()

  const app = container.resolve(IShopApp)
  const orderId = app.placeOrder('ada@example.com', 'hunter2', ['p1', 'p2'])
  console.log('placed order:', orderId)

  await container.dispose()
}

void main()
