export interface Task {
  id: string
  title: string
  done: boolean
  createdAt: string
  updatedAt: string
}

/** Domain error — the HTTP error handler maps it to a 404 (see app.ts). */
export class TaskNotFoundError extends Error {
  constructor(readonly taskId: string) {
    super(`Task ${taskId} not found`)
    this.name = 'TaskNotFoundError'
  }
}
