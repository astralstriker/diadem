/**
 * Pluggable logging for Diadem.
 *
 * A library must not write to stdout/stderr unless asked to. By default Diadem
 * uses a no-op logger and stays completely silent. Opt into diagnostics by
 * registering a logger (e.g. the built-in {@link consoleLogger}, or your own
 * pino/winston adapter):
 *
 * ```ts
 * import { setLogger, consoleLogger } from 'diadem'
 * setLogger(consoleLogger)
 * ```
 */

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** A logger that discards everything. The default. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

/** A logger that writes to the global `console`. Opt-in. */
export const consoleLogger: Logger = {
  debug: (...args) => {
    console.debug(...args)
  },
  info: (...args) => {
    console.info(...args)
  },
  warn: (...args) => {
    console.warn(...args)
  },
  error: (...args) => {
    console.error(...args)
  }
}

let currentLogger: Logger = noopLogger

/**
 * Set the active logger. Pass `null` to reset to the silent no-op logger.
 */
export function setLogger(logger: Logger | null): void {
  currentLogger = logger ?? noopLogger
}

/** Get the active logger. Internal call sites log through this. */
export function getLogger(): Logger {
  return currentLogger
}
