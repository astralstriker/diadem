import { scoped } from '@devcraft-ts/diadem'

/**
 * Per-request state, constructed once per Diadem request scope. Any scoped
 * service that injects this token sees the same instance within one HTTP
 * request, and a different instance in every other request.
 */
export abstract class IRequestContext {
  abstract readonly requestId: string
  abstract readonly userId: string | null
  abstract init(data: { requestId: string; userId: string | null }): void
}

@scoped(IRequestContext)
export class RequestContext extends IRequestContext {
  private data: { requestId: string; userId: string | null } | null = null

  get requestId(): string {
    return this.data?.requestId ?? 'unknown'
  }

  get userId(): string | null {
    return this.data?.userId ?? null
  }

  init(data: { requestId: string; userId: string | null }): void {
    if (this.data) {
      throw new Error('RequestContext is already initialized')
    }
    this.data = data
  }
}
