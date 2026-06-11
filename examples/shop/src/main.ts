/**
 * Composition root for the shop example.
 *
 * Workflow:
 *   1. npx diadem build --cwd examples/shop
 *   2. run this file
 *
 * Or visualize the graph without building anything:
 *   npx diadem graph --cwd examples/shop --scan-dir src --out graph.html
 */
import { setLogger, consoleLogger } from '@devcraft-ts/diadem'
import { createContainer } from './generated/service-manifest'
import { IShopApp } from './app'

async function main(): Promise<void> {
  setLogger(consoleLogger) // opt into diadem's own diagnostics

  const container = createContainer()

  const app = container.resolve(IShopApp)
  const orderId = app.placeOrder('ada@example.com', 'hunter2', ['p1', 'p2'])
  console.log('placed order:', orderId)

  await container.dispose()
}

void main()
