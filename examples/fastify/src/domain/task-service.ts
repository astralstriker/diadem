import { randomUUID } from 'node:crypto'
import { scoped } from '@devcraft-ts/diadem'
import { IClock } from '../infrastructure/clock'
import { ILogger } from '../infrastructure/logger'
import { IMetrics } from '../infrastructure/metrics'
import { IRequestContext } from '../http/request-context'
import { TaskNotFoundError, type Task } from './task'
import { ITaskRepository } from './task-repository'

export interface CreateTaskInput {
  title: string
}

export interface UpdateTaskInput {
  title?: string
  done?: boolean
}

/**
 * Application service for tasks. Scoped: each HTTP request gets its own
 * instance wired to that request's IRequestContext, while the repository,
 * clock, logger and metrics are the shared application singletons.
 */
export abstract class ITaskService {
  abstract list(): Promise<Task[]>
  abstract get(id: string): Promise<Task>
  abstract create(input: CreateTaskInput): Promise<Task>
  abstract update(id: string, input: UpdateTaskInput): Promise<Task>
  abstract remove(id: string): Promise<void>
}

@scoped(ITaskService)
export class TaskService extends ITaskService {
  constructor(
    private readonly repository: ITaskRepository,
    private readonly context: IRequestContext,
    private readonly logger: ILogger,
    private readonly clock: IClock,
    private readonly metrics: IMetrics
  ) {
    super()
  }

  async list(): Promise<Task[]> {
    return this.repository.list()
  }

  async get(id: string): Promise<Task> {
    const task = await this.repository.get(id)
    if (!task) {
      throw new TaskNotFoundError(id)
    }
    return task
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const now = this.clock.now().toISOString()
    const task: Task = {
      id: randomUUID(),
      title: input.title.trim(),
      done: false,
      createdAt: now,
      updatedAt: now
    }
    await this.repository.save(task)
    this.metrics.increment('tasks.created')
    this.logger.info('task created', {
      requestId: this.context.requestId,
      userId: this.context.userId,
      taskId: task.id
    })
    return task
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const existing = await this.get(id)
    const updated: Task = {
      ...existing,
      title: input.title?.trim() ?? existing.title,
      done: input.done ?? existing.done,
      updatedAt: this.clock.now().toISOString()
    }
    await this.repository.save(updated)
    this.metrics.increment('tasks.updated')
    this.logger.info('task updated', {
      requestId: this.context.requestId,
      userId: this.context.userId,
      taskId: id
    })
    return updated
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.repository.delete(id)
    if (!deleted) {
      throw new TaskNotFoundError(id)
    }
    this.metrics.increment('tasks.deleted')
    this.logger.info('task deleted', {
      requestId: this.context.requestId,
      userId: this.context.userId,
      taskId: id
    })
  }
}
