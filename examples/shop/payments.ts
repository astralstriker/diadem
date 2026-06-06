import { singleton } from '@devcraft-ts/diadem'
import { IConfig, ILogger } from './infrastructure'

/**
 * A third-party SDK client with no `@singleton` decorator, so diadem treats it
 * as an **external** dependency (greyed-out in the graph — the container won't
 * build it). Because the container can't construct externals, depend on them
 * *optionally*: in this example the gateway falls back to a test charge when no
 * client was provided. (The idiomatic alternative is to wrap the SDK in a
 * `@singleton` adapter so it becomes a managed service.)
 */
export class StripeClient {
  charge(_amountCents: number, _token: string): { id: string } {
    return { id: 'ch_live' }
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
    private readonly stripe?: StripeClient
  ) {
    super()
  }
  charge(amountCents: number): string {
    this.logger.info(`charging ${amountCents} via ${this.config.get('STRIPE_KEY')}`)
    if (!this.stripe) {
      this.logger.info('no Stripe client provided — using a test charge')
      return 'ch_test'
    }
    return this.stripe.charge(amountCents, 'tok_demo').id
  }
}
