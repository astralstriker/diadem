import { singleton } from '@devcraft-ts/diadem'
import { IConfig, ILogger } from './infrastructure'

/**
 * A third-party SDK client. It has no `@singleton` decorator, so diadem treats
 * it as an **external** dependency: it shows up greyed-out in the graph, and at
 * runtime you'd supply it yourself rather than have the container build it.
 */
export class StripeClient {
  charge(_amountCents: number, _token: string): { id: string } {
    return { id: 'ch_demo' }
  }
}

export abstract class IPaymentGateway {
  abstract charge(amountCents: number): string
}

@singleton(IPaymentGateway)
export class StripePaymentGateway extends IPaymentGateway {
  constructor(
    private readonly config: IConfig,
    private readonly logger: ILogger,
    private readonly stripe: StripeClient
  ) {
    super()
  }
  charge(amountCents: number): string {
    this.logger.info(`charging ${amountCents} via ${this.config.get('STRIPE_KEY')}`)
    return this.stripe.charge(amountCents, 'tok_demo').id
  }
}
