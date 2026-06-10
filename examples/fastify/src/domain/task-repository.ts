import { singleton } from '@devcraft-ts/diadem'
import { IDatabase } from '../infrastructure/database'
import type { Task } from './task'

/**
 * Persistence boundary for tasks. The rest of the app depends on this token;
 * swapping the in-memory store for Postgres means writing one new
 * `@singleton(ITaskRepository)` class and regenerating the container.
 */
export abstract class ITaskRepository {
  abstract list(): Promise<Task[]>
  abstract get(id: string): Promise<Task | null>
  abstract save(task: Task): Promise<void>
  abstract delete(id: string): Promise<boolean>
}

@singleton(ITaskRepository)
export class InMemoryTaskRepository extends ITaskRepository {
  constructor(private readonly db: IDatabase) {
    super()
  }

  private get tasks(): Map<string, Task> {
    return this.db.collection<Task>('tasks')
  }

  async list(): Promise<Task[]> {
    return [...this.tasks.values()]
  }

  async get(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null
  }

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, task)
  }

  async delete(id: string): Promise<boolean> {
    return this.tasks.delete(id)
  }
}
