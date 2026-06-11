import { provider, provides } from '@devcraft-ts/diadem'
import { IConfig } from './runtime'
import { StripeClient } from './payments'

/**
 * A **provider**: its `@provides` methods bind tokens to the values they return.
 * Use a provider for anything the container can't build with `new T(...deps)` —
 * third-party SDK clients, config-derived values, or instances that need a
 * factory function. Method parameters are injected like constructor deps.
 *
 * Provider bindings only run in compiled wiring, so build the example with:
 *
 *   diadem build --cwd examples/shop
 *
 * (Manifest mode is runtime-interpreted and can't call provider methods.)
 */
@provider()
export class IntegrationProviders {
  /** Bind {@link StripeClient} by constructing it from the configured API key. */
  @provides(StripeClient)
  stripe(config: IConfig): StripeClient {
    return new StripeClient(config.get('STRIPE_KEY'))
  }
}
