/**
 * Frame-wide transient feedback for text-bearing command outcomes. The
 * durable command row remains the replay surface; this local toast covers the
 * blank-session posture where Chat intentionally renders no command rows.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'

/** One locally submitted command outcome currently announced by the frame. */
export interface CommandOutcomeNotice {
  /** Per-announcement identity; repeated text restarts the toast lifecycle. */
  seq: number
  /** Result severity selects the optional warning icon. */
  kind: CommandResult['kind']
  /** Human-facing result text returned by the Host command. */
  text: string
}

/** Headless state owner for the frame-wide command-result toast. */
export class CommandOutcomeController {
  /** Latest text-bearing result, or null before and after an announcement. */
  readonly state: SnapshotStore<CommandOutcomeNotice | null> =
    createSnapshotStore<CommandOutcomeNotice | null>(null)
  private seq = 0

  /**
   * Announce one result when it carries user-facing text.
   * @param result - matched Host command result.
   */
  show(result: CommandResult): void {
    if (result.text === undefined || result.text.length === 0) return
    this.seq += 1
    this.state.set({ seq: this.seq, kind: result.kind, text: result.text })
  }

  /**
   * Clear one completed toast without clearing a newer replacement.
   * @param seq - identity captured by the rendered toast.
   */
  dismiss(seq: number): void {
    if (this.state.getSnapshot()?.seq === seq) this.state.set(null)
  }

  /** Clear the announcement when the owning plugin unloads. */
  dispose(): void {
    this.state.set(null)
  }
}

/** Injected face of the frame-wide command outcome entry. */
export interface CommandOutcomeToastInjected {
  /** Controller supplying the latest local command outcome. */
  outcomes: CommandOutcomeController
}

/** Render the latest command outcome as a transient frame-wide toast. */
export function CommandOutcomeToast({ outcomes }: CommandOutcomeToastInjected): ReactNode {
  const notice = useSyncExternalStore(
    listener => outcomes.state.subscribe(listener),
    () => outcomes.state.getSnapshot(),
  )
  if (notice === null) return null
  return (
    <Toast
      key={notice.seq}
      text={notice.text}
      {...notice.kind === 'error' ? { icon: <IconWarningOutline16 size={16} /> } : {}}
      onDone={() => { outcomes.dismiss(notice.seq) }}
    />
  )
}
