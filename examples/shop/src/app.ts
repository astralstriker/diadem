import { singleton } from '@devcraft-ts/diadem'
import { IAuthService } from './domain/auth'
import { ICartService, IOrderService } from './domain/commerce'
import { ILogger } from './infrastructure/runtime'

/** The composition root: what your HTTP layer would resolve and call into. */
export abstract class IShopApp {
  abstract placeOrder(
    email: string,
    password: string,
    productIds: string[]
  ): string
}

@singleton(IShopApp)
export class ShopApp extends IShopApp {
  constructor(
    private readonly auth: IAuthService,
    private readonly orders: IOrderService,
    private readonly cart: ICartService,
    private readonly logger: ILogger
  ) {
    super()
  }

  placeOrder(email: string, password: string, productIds: string[]): string {
    if (!this.auth.login(email, password)) {
      throw new Error('unauthorized')
    }
    this.logger.info(`cart total preview: ${this.cart.total(productIds)}`)
    const order = this.orders.checkout('user_1', email, productIds)
    return order.id
  }
}
