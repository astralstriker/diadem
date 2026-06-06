import { singleton } from '@devcraft-ts/diadem'
import { IDatabase } from './database'
import { ILogger } from './infrastructure'

export interface User {
  id: string
  email: string
  passwordHash: string
}
export interface Product {
  id: string
  name: string
  priceCents: number
}
export interface Order {
  id: string
  userId: string
  total: number
}

export abstract class IUserRepository {
  abstract findByEmail(email: string): User | undefined
}

@singleton(IUserRepository)
export class UserRepository extends IUserRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly logger: ILogger
  ) {
    super()
  }
  findByEmail(email: string): User | undefined {
    this.logger.info(`lookup user ${email}`)
    return this.db.query<User>('select * from users where email = ?', [email])[0]
  }
}

export abstract class IProductRepository {
  abstract byId(id: string): Product | undefined
}

@singleton(IProductRepository)
export class ProductRepository extends IProductRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly logger: ILogger
  ) {
    super()
  }
  byId(id: string): Product | undefined {
    this.logger.info(`lookup product ${id}`)
    return this.db.query<Product>('select * from products where id = ?', [id])[0]
  }
}

export abstract class IOrderRepository {
  abstract save(order: Order): void
}

@singleton(IOrderRepository)
export class OrderRepository extends IOrderRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly logger: ILogger
  ) {
    super()
  }
  save(order: Order): void {
    this.logger.info(`save order ${order.id}`)
    this.db.query('insert into orders ...', [order.id])
  }
}
