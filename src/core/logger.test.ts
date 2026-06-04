import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLogger, setLogger, type Logger } from './logger'

function recordingLogger(): { logger: Logger; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    logger: {
      debug: (...a) => calls.push(`debug:${a.join(' ')}`),
      info: (...a) => calls.push(`info:${a.join(' ')}`),
      warn: (...a) => calls.push(`warn:${a.join(' ')}`),
      error: (...a) => calls.push(`error:${a.join(' ')}`)
    }
  }
}

describe('logger', () => {
  afterEach(() => {
    setLogger(null)
  })

  it('is silent (no-op) by default', () => {
    setLogger(null)
    // Should not throw and should not touch console.
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    getLogger().info('hello')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('routes through a registered logger', () => {
    const { logger, calls } = recordingLogger()
    setLogger(logger)
    getLogger().warn('careful')
    getLogger().error('boom')
    expect(calls).toEqual(['warn:careful', 'error:boom'])
  })

  it('setLogger(null) restores the silent logger', () => {
    const { logger, calls } = recordingLogger()
    setLogger(logger)
    setLogger(null)
    getLogger().info('ignored')
    expect(calls).toHaveLength(0)
  })
})
