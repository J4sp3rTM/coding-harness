// @vitest-environment jsdom
/** GreenAccentRow behavior: two cubes, selection follows the persisted
 * accent, clicks drive setAccent. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { GreenAccentRow } from '../src/client/GreenAccentRow.tsx'
import type { GreenAccentRowComponentProps } from '../src/client/GreenAccentRow.tsx'
import { createGreenAccentStore } from '../src/client/settings-store.ts'
import type { GreenAccentId } from '../src/accent.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'accent.title': 'Theme Accent',
  'accent.default': 'Default (Blue)',
  'accent.green': 'Green (Logo)',
}

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(accent: GreenAccentId = 'default') {
  const store = createGreenAccentStore().create()
  store.actions.sync(accent, 0)
  const setAccent = vi.fn()
  const props: GreenAccentRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setAccent,
  }
  render(<GreenAccentRow {...props} />)
  return { store, setAccent }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('GreenAccentRow', () => {
  it('renders the title and two cubes with the accent cube selected', () => {
    mount('green')
    expect(screen.getByText('Theme Accent')).toBeDefined()
    expect(pressed(/Green/)).toBe('true')
    expect(pressed(/Default/)).toBe('false')
  })

  it('click drives setAccent; selection follows the store mirror, not the click echo', () => {
    const b = mount('default')
    fireEvent.click(screen.getByRole('button', { name: /Green/ }))
    expect(b.setAccent).toHaveBeenCalledWith('green')
    expect(pressed(/Default/)).toBe('true')
    act(() => { b.store.actions.sync('green', 1) })
    expect(pressed(/Green/)).toBe('true')
    expect(pressed(/Default/)).toBe('false')
  })
})
