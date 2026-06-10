import type { FastifyInstance } from 'fastify'
import { ITaskService } from '../domain/task-service'

const taskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    done: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' }
  },
  required: ['id', 'title', 'done', 'createdAt', 'updatedAt'],
  additionalProperties: false
} as const

const idParamsSchema = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 1 } },
  required: ['id']
} as const

interface IdParams {
  id: string
}

interface CreateBody {
  title: string
}

interface UpdateBody {
  title?: string
  done?: boolean
}

/**
 * Task CRUD. Handlers stay thin: validate at the edge with JSON schema,
 * resolve the scoped ITaskService from the request's DI scope, delegate.
 * Domain errors surface through the central error handler in app.ts.
 */
export function registerTaskRoutes(app: FastifyInstance): void {
  app.get(
    '/tasks',
    {
      schema: {
        response: { 200: { type: 'array', items: taskSchema } }
      }
    },
    async (request) => request.diScope.resolve(ITaskService).list()
  )

  app.post<{ Body: CreateBody }>(
    '/tasks',
    {
      schema: {
        body: {
          type: 'object',
          properties: { title: { type: 'string', minLength: 1, maxLength: 200 } },
          required: ['title'],
          additionalProperties: false
        },
        response: { 201: taskSchema }
      }
    },
    async (request, reply) => {
      const task = await request.diScope
        .resolve(ITaskService)
        .create({ title: request.body.title })
      return reply.code(201).send(task)
    }
  )

  app.get<{ Params: IdParams }>(
    '/tasks/:id',
    {
      schema: {
        params: idParamsSchema,
        response: { 200: taskSchema }
      }
    },
    async (request) => request.diScope.resolve(ITaskService).get(request.params.id)
  )

  app.patch<{ Params: IdParams; Body: UpdateBody }>(
    '/tasks/:id',
    {
      schema: {
        params: idParamsSchema,
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            done: { type: 'boolean' }
          },
          additionalProperties: false
        },
        response: { 200: taskSchema }
      }
    },
    async (request) =>
      request.diScope.resolve(ITaskService).update(request.params.id, request.body)
  )

  app.delete<{ Params: IdParams }>(
    '/tasks/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      await request.diScope.resolve(ITaskService).remove(request.params.id)
      return reply.code(204).send()
    }
  )
}
