import fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance
} from 'fastify'
import type { DiademContainer } from '@devcraft-ts/diadem'
import { TaskNotFoundError } from './domain/task'
import { ILogger } from './infrastructure/logger'
import { registerRequestScope } from './http/request-scope'
import { registerHealthRoutes } from './routes/health'
import { registerTaskRoutes } from './routes/tasks'

/**
 * App factory: takes a ready container, returns a configured Fastify
 * instance without binding a port. server.ts uses it to listen; tests use it
 * with `app.inject()` and an overridden container — no sockets involved.
 */
export function buildApp(container: DiademContainer): FastifyInstance {
  const app = fastify({
    // Fastify logs through the container-owned pino root: one log pipeline.
    // (Typed as FastifyBaseLogger so the instance keeps the default generics.)
    loggerInstance: container.resolve(ILogger).root as FastifyBaseLogger,
    requestIdLogLabel: 'requestId'
  })

  registerRequestScope(app, container)
  registerHealthRoutes(app, container)
  registerTaskRoutes(app)

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof TaskNotFoundError) {
      return reply.code(404).send({
        error: 'not_found',
        message: error.message,
        requestId: request.id
      })
    }
    if (error.validation) {
      return reply.code(400).send({
        error: 'bad_request',
        message: error.message,
        requestId: request.id
      })
    }
    request.log.error({ err: error }, 'unhandled error')
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Something went wrong',
      requestId: request.id
    })
  })

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: 'not_found',
      message: `Route ${request.method} ${request.url} not found`,
      requestId: request.id
    })
  )

  return app
}
