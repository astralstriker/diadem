import { singleton } from '@devcraft-ts/diadem'
import { IConfig, ILogger } from './infrastructure'

/**
 * A third-party SDK client. It has no `@singleton` decorator and needs an API
 * key the container has no way to invent, so diadem can't `new` it directly.
 * Instead a `@provides` method in {@link ./providers.ts} binds it (pulling the
 * key from config). That turns an otherwise-external dependency into a fully
 * managed binding — see `IntegrationProviders.stripe`.
 */
export class StripeClient {
  constructor(private readonly apiKey: string) {}
  charge(_amountCents: number, _token: string): { id: string } {
    return { id: this.apiKey ? 'ch_live' : 'ch_test' }
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
