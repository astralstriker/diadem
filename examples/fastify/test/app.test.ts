import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { createContainerAsync, type Overrides } from '../src/generated/container'
import { IClock } from '../src/infrastructure/clock'

process.env.LOG_LEVEL = 'silent'

const FIXED_TIME = new Date('2026-01-01T12:00:00.000Z')

class FixedClock extends IClock {
  now(): Date {
    return FIXED_TIME
  }
}

/**
 * Each test gets a fresh container (fresh in-memory database) with the clock
 * replaced through the generated Overrides seam — no module mocking, no
 * network sockets (app.inject talks to the router directly).
 */
async function makeApp(
  t: { after: (fn: () => Promise<void>) => void },
  overrides: Overrides = {}
): Promise<FastifyInstance> {
  const container = await createContainerAsync({
    IClock: new FixedClock(),
    ...overrides
  })
  const app = buildApp(container)
  t.after(async () => {
    await app.close()
    await container.dispose()
  })
  return app
}

test('liveness and readiness report ok', async (t) => {
  const app = await makeApp(t)

  const live = await app.inject({ method: 'GET', url: '/health/live' })
  assert.equal(live.statusCode, 200)

  const ready = await app.inject({ method: 'GET', url: '/health/ready' })
  assert.equal(ready.statusCode, 200)
  assert.deepEqual(ready.json(), { status: 'ok' })
})

test('creates a task and reads it back', async (t) => {
  const app = await makeApp(t)

  const created = await app.inject({
    method: 'POST',
    url: '/tasks',
    payload: { title: '  Ship the example  ' }
  })
  assert.equal(created.statusCode, 201)
  const task = created.json()
  assert.equal(task.title, 'Ship the example')
  assert.equal(task.done, false)
  // The injected FixedClock produced the timestamps — proves the override
  // flowed through the generated container into the scoped TaskService.
  assert.equal(task.createdAt, FIXED_TIME.toISOString())

  const fetched = await app.inject({ method: 'GET', url: `/tasks/${task.id}` })
  assert.equal(fetched.statusCode, 200)
  assert.deepEqual(fetched.json(), task)
})

test('rejects an invalid create payload with 400', async (t) => {
  const app = await makeApp(t)

  const res = await app.inject({ method: 'POST', url: '/tasks', payload: {} })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'bad_request')
})

test('maps TaskNotFoundError to 404', async (t) => {
  const app = await makeApp(t)

  const res = await app.inject({ method: 'GET', url: '/tasks/missing' })
  assert.equal(res.statusCode, 404)
  const body = res.json()
  assert.equal(body.error, 'not_found')
  assert.ok(body.requestId)
})

test('updates and deletes a task', async (t) => {
  const app = await makeApp(t)

  const created = await app.inject({
    method: 'POST',
    url: '/tasks',
    payload: { title: 'Walk the dog' }
  })
  const { id } = created.json()

  const updated = await app.inject({
    method: 'PATCH',
    url: `/tasks/${id}`,
    payload: { done: true }
  })
  assert.equal(updated.statusCode, 200)
  assert.equal(updated.json().done, true)
  assert.equal(updated.json().title, 'Walk the dog')

  const deleted = await app.inject({ method: 'DELETE', url: `/tasks/${id}` })
  assert.equal(deleted.statusCode, 204)

  const gone = await app.inject({ method: 'GET', url: `/tasks/${id}` })
  assert.equal(gone.statusCode, 404)
})

test('every response carries a unique x-request-id', async (t) => {
  const app = await makeApp(t)

  const first = await app.inject({ method: 'GET', url: '/tasks' })
  const second = await app.inject({ method: 'GET', url: '/tasks' })
  assert.ok(first.headers['x-request-id'])
  assert.ok(second.headers['x-request-id'])
  assert.notEqual(first.headers['x-request-id'], second.headers['x-request-id'])
})

test('containers are isolated — no state bleeds between apps', async (t) => {
  const appA = await makeApp(t)
  const appB = await makeApp(t)

  await appA.inject({ method: 'POST', url: '/tasks', payload: { title: 'A only' } })

  const fromB = await appB.inject({ method: 'GET', url: '/tasks' })
  assert.deepEqual(fromB.json(), [])
})
