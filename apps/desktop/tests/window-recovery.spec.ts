import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowRecovery, type WindowFailure } from '../src/window-recovery.ts'

interface Harness {
  recovery: WindowRecovery
  load: ReturnType<typeof vi.fn<() => Promise<void>>>
  log: ReturnType<typeof vi.fn<(event: string, detail: string) => void>>
  prompt: ReturnType<typeof vi.fn<(failure: WindowFailure) => Promise<'reload' | 'quit'>>>
  quit: ReturnType<typeof vi.fn<() => void>>
}

function harness(overrides: { load?: () => Promise<void>; prompt?: () => Promise<'reload' | 'quit'> } = {}): Harness {
  const load = vi.fn(overrides.load ?? (() => Promise.resolve()))
  const log = vi.fn<(event: string, detail: string) => void>()
  const prompt = vi.fn(overrides.prompt ?? (() => Promise.resolve('quit' as const)))
  const quit = vi.fn<() => void>()
  const recovery = new WindowRecovery({
    now: Date.now,
    load,
    log,
    prompt,
    quit,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => { clearTimeout(timer) },
  })
  return { recovery, load, log, prompt, quit }
}

async function settle(): Promise<void> {
  await vi.waitFor(() => {})
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WindowRecovery', () => {
  it('reloads the renderer after one classified failure', async () => {
    const bench = harness()
    bench.recovery.report({ kind: 'renderer', detail: 'crashed (exit 1)' })
    await settle()
    expect(bench.load).toHaveBeenCalledTimes(1)
    expect(bench.log).toHaveBeenCalledWith('renderer-failure', 'crashed (exit 1)')
    expect(bench.prompt).not.toHaveBeenCalled()
  })

  it('coalesces a GPU and renderer report while one reload is in flight', async () => {
    let release = (): void => {}
    const pending = new Promise<undefined>((resolve) => { release = () => { resolve(undefined) } })
    const bench = harness({ load: async () => { await pending } })
    bench.recovery.report({ kind: 'gpu', detail: 'crashed' })
    bench.recovery.report({ kind: 'renderer', detail: 'crashed' })
    expect(bench.load).toHaveBeenCalledTimes(1)
    expect(bench.log).toHaveBeenCalledWith('recovery-coalesced', 'renderer: crashed')
    release()
    await settle()
    expect(bench.load).toHaveBeenCalledTimes(1)
  })

  it('prompts instead of entering an automatic crash loop', async () => {
    const bench = harness()
    bench.recovery.report({ kind: 'renderer', detail: 'first' })
    await settle()
    bench.recovery.report({ kind: 'renderer', detail: 'second' })
    await settle()
    bench.recovery.report({ kind: 'renderer', detail: 'third' })
    await settle()
    expect(bench.load).toHaveBeenCalledTimes(2)
    expect(bench.prompt).toHaveBeenCalledWith({ kind: 'renderer', detail: 'third' })
    expect(bench.quit).toHaveBeenCalledTimes(1)
  })

  it('retries a failed recovery load within the same bounded operation', async () => {
    let calls = 0
    const bench = harness({
      load: () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('scheme failed')) : Promise.resolve()
      },
    })
    bench.recovery.report({ kind: 'renderer', detail: 'oom' })
    await settle()
    expect(bench.load).toHaveBeenCalledTimes(2)
    expect(bench.log).toHaveBeenCalledWith('recovery-load-failed', 'scheme failed')
    expect(bench.prompt).not.toHaveBeenCalled()
  })

  it('forgets prior failures only after a stable loaded interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const bench = harness()
    bench.recovery.report({ kind: 'renderer', detail: 'first' })
    await Promise.resolve()
    await Promise.resolve()
    bench.recovery.report({ kind: 'renderer', detail: 'second' })
    await Promise.resolve()
    await Promise.resolve()
    bench.recovery.loaded()
    await vi.advanceTimersByTimeAsync(30_000)
    bench.recovery.report({ kind: 'renderer', detail: 'later' })
    await Promise.resolve()
    await Promise.resolve()
    expect(bench.load).toHaveBeenCalledTimes(3)
    expect(bench.prompt).not.toHaveBeenCalled()
    expect(bench.log).toHaveBeenCalledWith('renderer-stable', 'loaded for 30000ms')
  })

  it('suppresses recovery and cancels stability work after shutdown', async () => {
    vi.useFakeTimers()
    const bench = harness()
    bench.recovery.loaded()
    bench.recovery.stop()
    bench.recovery.report({ kind: 'renderer', detail: 'intentional teardown' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(bench.load).not.toHaveBeenCalled()
    expect(bench.log).toHaveBeenCalledWith('renderer-failure', 'intentional teardown')
    expect(bench.log).not.toHaveBeenCalledWith('renderer-stable', expect.anything())
  })
})
