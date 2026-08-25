/**
 * Green accent row slot store: a mirror of the accent settings snapshot. The
 * plugin's apply-world change listener is the only writer; the row component
 * reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_ACCENT, type GreenAccentId } from '../accent.ts'

/** Store state mirrored from the accent settings snapshot. */
export interface GreenAccentState {
  /** Persisted accent (selection state reads this, never the live layer). */
  accent: GreenAccentId
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type GreenAccentActions = {
  sync: (draft: GreenAccentState, accent: GreenAccentId, revision: number) => void
}

/**
 * Declares the Green Accent row state and write surface.
 * @returns the store handle.
 */
export function createGreenAccentStore(): EngineStoreHandle<GreenAccentState, GreenAccentActions> {
  return defineStore({
    init: (): GreenAccentState => ({ accent: DEFAULT_ACCENT, revision: -1 }),
    actions: {
      sync: (d, accent: GreenAccentId, revision: number) => {
        if (revision <= d.revision) return
        d.accent = accent
        d.revision = revision
      },
    },
  })
}
