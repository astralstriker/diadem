import { singleton } from '@devcraft-ts/diadem'
import { ILogger } from './logger'

/**
 * Metrics sink with one implementation per environment. The environment is
 * baked in at build time — `diadem build --target-env development` wires
 * InMemoryMetrics, `--target-env production` wires StatsdMetrics, with zero
 * runtime branching in the generated container.
 */
export abstract class IMetrics {
  abstract increment(name: string, value?: number): void
  abstract timing(name: string, ms: number): void
}

@singleton(IMetrics, 'development')
export class InMemoryMetrics extends IMetrics {
  readonly counters = new Map<string, number>()
  readonly timings = new Map<string, number[]>()

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value)
  }

  timing(name: string, ms: number): void {
    const samples = this.timings.get(name) ?? []
    samples.push(ms)
    this.timings.set(name, samples)
  }
}

@singleton(IMetrics, 'production')
export class StatsdMetrics extends IMetrics {
  constructor(private readonly logger: ILogger) {
    super()
  }

  // Stand-in for a real StatsD/OTel client — replace the bodies with your
  // metrics SDK; the rest of the app only sees the IMetrics token.
  increment(name: string, value = 1): void {
    this.logger.debug('metric.increment', { name, value })
  }

  timing(name: string, ms: number): void {
    this.logger.debug('metric.timing', { name, ms })
  }
}
