/**
 * Shell root: boot loading page → (boot settled) → real UI in one switch.
 * Pure kernel component with zero plugin dependencies — before settled it may
 * only rely on itself (the fail-loud presentation must not depend on the
 * system whose failure it reports; the status/signal stores are kernel-own,
 * shell self-sufficiency rule); the real UI is produced by the
 * app-shell entry once every entry is active. A failed boot keeps the
 * loading page, lists the per-entry fiber states and the sweep report (fail
 * loud, no partial UI).
 */
import { Component, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { KernelSignal, LoaderStatus } from './loader-status.ts'
import css from './AppRoot.module.css'

/** AppRoot props: settled signal, fiber-state projection feed, boot failure report, deferred real-UI factory. */
export interface AppRootProps {
  /** True once the boot chain settled (loader quiesced + all entries ACTIVE); the boot closure flips it. */
  settled: KernelSignal<boolean>
  /** Per-entry fiber-state projection store (drives loading/failed rendering). */
  status: KernelSignal<LoaderStatus>
  /** Boot failure report (the settle rejection message); undefined while loading or after success. */
  error: KernelSignal<string | undefined>
  /** Builds the real UI; called only after settled. */
  renderApp: () => ReactNode
}

/** Top-level settled-UI failure state. */
interface AppFailureState {
  error?: string
}

/** Shell-owned last-resort boundary for failures above the per-slot boundaries. */
class AppFailureBoundary extends Component<{ children: ReactNode }, AppFailureState> {
  override state: AppFailureState = {}

  static getDerivedStateFromError(error: unknown): AppFailureState {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('web app render failed', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children
    return (
      <div className={css.boot}>
        <div className={css.card}>
          <div className={css.wordmark}>HARNESS</div>
          <div className={css.failed}>
            <div className={css.failedTitle}>The interface stopped unexpectedly</div>
            <div className={css.failedItem}>{this.state.error}</div>
            <button className={css.reload} type="button" onClick={() => { globalThis.location.reload() }}>Reload UI</button>
          </div>
        </div>
      </div>
    )
  }
}

/** Invoke the deferred app renderer below the last-resort error boundary. */
function SettledApp(props: Pick<AppRootProps, 'renderApp'>): ReactNode {
  return <>{props.renderApp()}</>
}

/** Boot gate: loading page until the boot settles; failures stay here. */
export function AppRoot(props: AppRootProps) {
  const settled = useSyncExternalStore(props.settled.subscribe, props.settled.getSnapshot)
  const status = useSyncExternalStore(props.status.subscribe, props.status.getSnapshot)
  const error = useSyncExternalStore(props.error.subscribe, props.error.getSnapshot)
  const failed = Object.entries(status).filter(([, s]) => s === 'failed')

  if (settled) {
    return (
      <AppFailureBoundary>
        <SettledApp renderApp={props.renderApp} />
      </AppFailureBoundary>
    )
  }

  const loud = error !== undefined || failed.length > 0

  return (
    <div className={css.boot}>
      <div className={css.card}>
        <div className={css.wordmark}>HARNESS</div>
        {!loud
          ? (
            <>
              <div className={css.spinner} />
              <div className={css.hint}>Loading plugins…</div>
            </>
          )
          : (
            <div className={css.failed}>
              <div className={css.failedTitle}>Failed to load plugins</div>
              {failed.map(([id]) => <div key={id} className={css.failedItem}>{id}</div>)}
              {error !== undefined && <div className={css.failedItem}>{error}</div>}
            </div>
          )}
      </div>
    </div>
  )
}
