# Fastify + Diadem — a production-shaped service

A small but complete task API showing how Diadem wires a real Fastify service:
layered architecture, async startup, per-request DI scopes, environment-baked
implementations, graceful shutdown, and a socket-free test suite that swaps
services through the generated `Overrides` seam.

```bash
npm install
npm run dev          # generates the container, starts with file watching
curl -s -X POST localhost:3000/tasks -H 'content-type: application/json' -d '{"title":"Try diadem"}'
curl -s localhost:3000/tasks
npm test             # node:test + app.inject(), no ports opened
```

## Layout

```
src/
  infrastructure/    config, clock, pino logger, database, metrics
  domain/            task model + repository + service (no HTTP imports)
  http/              request context (@scoped) + request-scope hooks
  routes/            thin handlers with JSON-schema validation
  app.ts             app factory: container in, configured Fastify out
  server.ts          composition root: container, listen, graceful shutdown
  generated/         container emitted by `diadem build` (do not edit)
test/app.test.ts     integration tests via app.inject()
```

## What each piece demonstrates

**Async startup** — `InMemoryDatabase` is an `@asyncSingleton` with
`async onInit()`. The generator therefore emits `createContainerAsync()`,
and the server awaits the database connection before it starts listening.

**Request scope** — `registerRequestScope` (src/http/request-scope.ts)
creates one Diadem scope per HTTP request in `onRequest`, seeds the
`@scoped` `IRequestContext` with the request id and caller identity, and
disposes the scope in `onResponse` (plus `onRequestAbort` for clients that
disconnect early). `TaskService` is also `@scoped`: each request gets its own
instance holding that request's context, while the repository, clock, logger
and metrics stay application singletons.

**One log pipeline** — the container owns the pino root (`PinoLogger`);
`buildApp` hands the same instance to Fastify via `loggerInstance`, so
framework request logs and service logs share configuration and the
`requestId` label.

**Environment baked at build time** — `IMetrics` has two implementations:
`@singleton(IMetrics, 'development')` (in-memory) and
`@singleton(IMetrics, 'production')` (your StatsD/OTel client). The build
picks one with zero runtime branching:

```bash
npm run build:di        # diadem build --target-env development
npm run build:di:prod   # diadem build --target-env production
```

**Graceful shutdown** — on SIGINT/SIGTERM, `server.ts` closes Fastify
(in-flight requests finish and their scopes dispose), then calls
`container.dispose()`, which tears down `Disposable` singletons in reverse
construction order — the database closes last.

**Domain errors at the edge** — `TaskService` throws `TaskNotFoundError`;
the central error handler in `app.ts` maps it to a 404 with a `requestId`,
keeps schema violations as 400s, and never leaks internals on 500s.

## Testing through the Overrides seam

The generated container exposes every singleton as an optional override —
no module mocking, no monkey patching:

```ts
const container = await createContainerAsync({ IClock: new FixedClock() })
const app = buildApp(container)
const res = await app.inject({ method: 'POST', url: '/tasks', payload: { title: 'x' } })
```

Each test builds a fresh container (fresh in-memory database), so tests are
isolated by construction — see the last test in `test/app.test.ts`, which
proves no state bleeds between two app instances.

## Probes

- `GET /health/live` — process responds.
- `GET /health/ready` — asks the database (`ping()`); returns 503 when the
  connection is down, so the pod leaves the load balancer without being killed.
