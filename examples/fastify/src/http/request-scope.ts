import type { FastifyInstance } from 'fastify'
import type { DiademContainer } from '@devcraft-ts/diadem'
import { IRequestContext } from './request-context'

declare module 'fastify' {
  interface FastifyRequest {
    diScope: DiademContainer
  }
}

/**
 * One Diadem request scope per HTTP request:
 *
 * - `onRequest` creates the scope and seeds IRequestContext with the request
 *   id and the caller identity (here a header; in a real app, your auth layer).
 * - `onResponse` disposes the scope after the response is sent.
 * - `onRequestAbort` disposes it when the client disconnects early, so aborted
 *   requests don't leak scoped instances. Disposal is idempotent, so it is
 *   safe for both hooks to be registered.
 *
 * Scope disposal tears down scoped services only — application singletons
 * live until `container.dispose()` at shutdown.
 */
export function registerRequestScope(
  app: FastifyInstance,
  container: DiademContainer
): void {
  app.decorateRequest('diScope')

  app.addHook('onRequest', async (request, reply) => {
    const scope = container.createRequestScope()
    scope.resolve(IRequestContext).init({
      requestId: request.id,
      userId: firstHeader(request.headers['x-user-id'])
    })
    request.diScope = scope
    reply.header('x-request-id', request.id)
  })

  app.addHook('onResponse', async (request) => {
    await request.diScope?.dispose()
  })

  app.addHook('onRequestAbort', async (request) => {
    await request.diScope?.dispose()
  })
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}
