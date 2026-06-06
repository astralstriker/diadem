import { singleton } from '@devcraft-ts/diadem'
import { IConfig, ILogger } from './infrastructure'

/**
 * Analytics is **production-only** (`@singleton(IAnalytics, 'production')`).
 * In the graph's env filter it appears for `production` and disappears for
 * `development`. Services that depend on it do so optionally (see OrderService).
 */
export abstract class IAnalytics {
  abstract track(event: string, props: Record<string, unknown>): void
}

@singleton(IAnalytics, 'production')
export class SegmentAnalytics extends IAnalytics {
  constructor(
    private readonly config: IConfig,
    private readonly logger: ILogger
  ) {
    super()
  }
  track(event: string, _props: Record<string, unknown>): void {
    this.logger.info(`analytics(${this.config.get('SEGMENT_KEY')}): ${event}`)
  }
}
