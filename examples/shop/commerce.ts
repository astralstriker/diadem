import { singleton } from '@devcraft-ts/diadem'
import { IAnalytics } from './analytics'
import { IClock, ILogger } from './infrastructure'
import { INotificationService } from './messaging'
import { IPaymentGateway } from './payments'
import { IOrderRepository, IProductRepository, type Order } from './repositories'

export abstract class ICartService {
  abstract total(productIds: string[]): number
}

@singleton(ICartService)
export class CartService extends ICartService {
  constructor(
    private readonly products: IProductRepository,
    private readonly logger: ILogger
  ) {
    super()
  }
  total(productIds: string[]): number {
    this.logger.info(`pricing cart of ${productIds.length} items`)
    return productIds.reduce(
      (sum, id) => sum + (this.products.byId(id)?.priceCents ?? 0),
      0
    )
  }
}

export abstract class IOrderService {
  abstract checkout(userId: string, email: string, productIds: string[]): Order
}

@singleton(IOrderService)
export class OrderService extends IOrderService {
  constructor(
    private readonly orders: IOrderRepository,
    private readonly cart: ICartService,
    private readonly payments: IPaymentGateway,
    private readonly notifications: INotificationService,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    // Optional: analytics only exists in production. In development this is
    // undefined, and the graph shows a dashed edge.
    private readonly analytics?: IAnalytics
  ) {
    super()
  }

  checkout(userId: string, email: string, productIds: string[]): Order {
    const total = this.cart.total(productIds)
    this.payments.charge(total)
    const order: Order = { id: `ord_${this.clock.now()}`, userId, total }
    this.orders.save(order)
    this.notifications.orderConfirmed(email, order.id)
    this.analytics?.track('order_placed', { userId, total })
    this.logger.info(`checkout complete: ${order.id}`)
    return order
  }
}
