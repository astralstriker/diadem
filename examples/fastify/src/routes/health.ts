import type { FastifyInstance } from 'fastify'
import type { DiademContainer } from '@devcraft-ts/diadem'
import { IDatabase } from '../infrastructure/database'

/**
 * Liveness and readiness probes. Liveness only proves the process responds;
 * readiness asks the database, so a lost connection flips the pod out of the
 * load balancer without killing in-flight work.
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  container: DiademContainer
): void {
  app.get('/health/live', async () => ({ status: 'ok' }))

  app.get('/health/ready', async (_request, reply) => {
    const ready = await container.resolve(IDatabase).ping()
    if (!ready) {
      return reply.code(503).send({ status: 'unavailable' })
    }
    return { status: 'ok' }
  })
}
