import { singleton } from '@devcraft-ts/diadem'
import { IConfig, ILogger } from './runtime'

export abstract class IEmailService {
  abstract send(to: string, subject: string, body: string): void
}

@singleton(IEmailService)
export class EmailService extends IEmailService {
  constructor(
    private readonly config: IConfig,
    private readonly logger: ILogger
  ) {
    super()
  }
  send(to: string, subject: string, _body: string): void {
    this.logger.info(`email via ${this.config.get('SMTP_HOST')} → ${to}: ${subject}`)
  }
}

export abstract class INotificationService {
  abstract orderConfirmed(email: string, orderId: string): void
}

@singleton(INotificationService)
export class NotificationService extends INotificationService {
  constructor(
    private readonly email: IEmailService,
    private readonly logger: ILogger
  ) {
    super()
  }
  orderConfirmed(email: string, orderId: string): void {
    this.logger.info(`notify ${email} about ${orderId}`)
    this.email.send(email, 'Order confirmed', `Your order ${orderId} is on its way.`)
  }
}
