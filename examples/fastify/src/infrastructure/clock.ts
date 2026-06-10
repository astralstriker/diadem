import { singleton } from '@devcraft-ts/diadem'

/**
 * Injectable time source. Tests override this with a fixed clock so
 * timestamps in responses are deterministic (see test/app.test.ts).
 */
export abstract class IClock {
  abstract now(): Date
}

@singleton(IClock)
export class SystemClock extends IClock {
  now(): Date {
    return new Date()
  }
}
