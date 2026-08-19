/**
 * Bounded recovery for the disposable Electron renderer. The composed Host
 * remains alive while this controller reloads only the window contents.
 * @module @deepseek-ai/dsh-desktop/window-recovery
 */

/** A renderer-side failure that can leave the desktop window blank. */
export interface WindowFailure {
  /** Electron subsystem that reported the failure. */
  kind: 'renderer' | 'gpu' | 'load'
  /** Human-readable local diagnostic detail. */
  detail: string
}

/** Recovery operations owned by the Electron entry. */
export interface WindowRecoveryOptions {
  /** Monotonic wall-clock milliseconds used for the rolling retry budget. */
  now: () => number
  /** Reload `dsh://app/index.html` into the existing window. */
  load: () => Promise<void>
  /** Record one lifecycle fact in the local desktop log. */
  log: (event: string, detail: string) => void
  /** Ask the user whether to retry after automatic recovery is exhausted. */
  prompt: (failure: WindowFailure) => Promise<'reload' | 'quit'>
  /** Quit the complete desktop application at the user's request. */
  quit: () => void
  /** Schedule a stable-load callback. */
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  /** Cancel a stable-load callback. */
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
}

/** Two failures in one minute indicate a deterministic crash loop. */
const MAX_AUTOMATIC_RELOADS = 2
const RETRY_WINDOW_MS = 60_000
/** A document must remain loaded before an earlier crash stops counting. */
const STABLE_LOAD_MS = 30_000

/**
 * Recover one BrowserWindow without restarting its Host.
 *
 * Failure notifications that arrive while a reload is in flight are
 * coalesced: a GPU crash commonly also terminates the renderer, and those two
 * reports describe one outage rather than two recovery attempts.
 */
export class WindowRecovery {
  private attempts: number[] = []
  private recovering = false
  private stopping = false
  private stableTimer: ReturnType<typeof setTimeout> | undefined

  /** @param options - Electron operations and testable time seams. */
  constructor(private readonly options: WindowRecoveryOptions) {}

  /**
   * Report an unexpected renderer-side failure and start bounded recovery.
   * @param failure - classified Electron failure.
   */
  report(failure: WindowFailure): void {
    this.options.log(`${failure.kind}-failure`, failure.detail)
    if (this.stopping) return
    if (this.recovering) {
      this.options.log('recovery-coalesced', `${failure.kind}: ${failure.detail}`)
      return
    }
    this.recovering = true
    void this.recover(failure).finally(() => { this.recovering = false })
  }

  /** Mark a completed top-level navigation as a candidate stable load. */
  loaded(): void {
    if (this.stopping) return
    if (this.stableTimer !== undefined) this.options.clearTimer(this.stableTimer)
    this.stableTimer = this.options.setTimer(() => {
      this.stableTimer = undefined
      this.attempts = []
      this.options.log('renderer-stable', `loaded for ${String(STABLE_LOAD_MS)}ms`)
    }, STABLE_LOAD_MS)
  }

  /** Suppress recovery after intentional window/application teardown. */
  stop(): void {
    this.stopping = true
    if (this.stableTimer !== undefined) {
      this.options.clearTimer(this.stableTimer)
      this.stableTimer = undefined
    }
  }

  /** Read stop state after an awaited external callback may have changed it. */
  private isStopped(): boolean {
    return this.stopping
  }

  /** Run automatic attempts, then defer the decision to the user. */
  private async recover(initial: WindowFailure): Promise<void> {
    let failure = initial
    while (!this.stopping) {
      const now = this.options.now()
      this.attempts = this.attempts.filter(time => now - time < RETRY_WINDOW_MS)
      if (this.attempts.length >= MAX_AUTOMATIC_RELOADS) {
        this.options.log('recovery-exhausted', failure.detail)
        const action = await this.options.prompt(failure)
        if (this.isStopped()) return
        if (action === 'quit') {
          this.options.quit()
          return
        }
        this.attempts = []
        this.options.log('recovery-user-retry', failure.detail)
      }

      this.attempts.push(this.options.now())
      this.options.log('recovery-reload', `${failure.kind}: ${failure.detail}`)
      try {
        await this.options.load()
        return
      } catch (error) {
        failure = { kind: 'load', detail: error instanceof Error ? error.message : String(error) }
        this.options.log('recovery-load-failed', failure.detail)
      }
    }
  }
}
